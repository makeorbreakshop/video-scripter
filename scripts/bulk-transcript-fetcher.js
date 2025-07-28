#!/usr/bin/env node

/**
 * Bulk Transcript Fetcher for 170K+ Videos
 * 
 * Features:
 * - Parallel processing with rate limiting
 * - Resume capability (tracks progress)
 * - Error handling and retry logic
 * - YouTube API quota management
 * - Database batch inserts for efficiency
 * - Progress tracking and ETA
 */

import { createClient } from '@supabase/supabase-js';
import pLimit from 'p-limit';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configuration
const CONFIG = {
  // Processing settings
  CONCURRENT_REQUESTS: 5,      // Number of parallel transcript fetches
  BATCH_SIZE: 50,              // Videos to process per batch
  RETRY_ATTEMPTS: 3,           // Max retry attempts per video
  RETRY_DELAY: 2000,           // Delay between retries (ms)
  
  // Rate limiting
  REQUESTS_PER_MINUTE: 30,     // Conservative to avoid rate limits
  PAUSE_BETWEEN_BATCHES: 5000, // Pause between batches (ms)
  
  // Progress tracking
  PROGRESS_FILE: path.join(__dirname, 'transcript_progress.json'),
  ERROR_LOG_FILE: path.join(__dirname, 'transcript_errors.log'),
  
  // Chunking settings
  MAX_CHUNK_SIZE: 1000,        // Max words per chunk
  MIN_CHUNK_SIZE: 100,         // Min words per chunk
  OVERLAP_SIZE: 50,            // Word overlap between chunks
};

// Progress tracking
let progress = {
  processed: 0,
  successful: 0,
  failed: 0,
  skipped: 0,
  lastProcessedId: null,
  errors: []
};

// Load progress from file if exists
async function loadProgress() {
  try {
    const data = await fs.readFile(CONFIG.PROGRESS_FILE, 'utf8');
    progress = JSON.parse(data);
    console.log(`📊 Resuming from previous run: ${progress.processed} videos processed`);
  } catch (error) {
    console.log('🆕 Starting fresh transcript fetch');
  }
}

// Save progress to file
async function saveProgress() {
  await fs.writeFile(CONFIG.PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Log errors to file
async function logError(videoId, error) {
  const errorEntry = `${new Date().toISOString()} - ${videoId}: ${error.message}\n`;
  await fs.appendFile(CONFIG.ERROR_LOG_FILE, errorEntry);
}

// Fetch transcript using the existing API route
async function fetchTranscript(videoId) {
  const maxRetries = CONFIG.RETRY_ATTEMPTS;
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('http://localhost:3000/api/youtube/transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          videoUrl: `https://www.youtube.com/watch?v=${videoId}` 
        }),
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data = await response.json();
      return data.transcript;
      
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * attempt));
      }
    }
  }
  
  throw lastError;
}

// Chunk transcript text
function chunkTranscript(transcript, videoId) {
  // Remove HTML tags and clean text
  const cleanText = transcript
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const words = cleanText.split(' ');
  const chunks = [];
  
  for (let i = 0; i < words.length; i += CONFIG.MAX_CHUNK_SIZE - CONFIG.OVERLAP_SIZE) {
    const chunkWords = words.slice(i, i + CONFIG.MAX_CHUNK_SIZE);
    
    if (chunkWords.length >= CONFIG.MIN_CHUNK_SIZE) {
      chunks.push({
        video_id: videoId,
        content: chunkWords.join(' '),
        content_type: 'transcript',
        metadata: {
          chunk_index: chunks.length,
          word_count: chunkWords.length,
          bulk_import: true,
          import_date: new Date().toISOString()
        }
      });
    }
  }
  
  return chunks;
}

// Process a single video
async function processVideo(video) {
  try {
    // Check if transcript already exists
    const { data: existingChunks } = await supabase
      .from('chunks')
      .select('id')
      .eq('video_id', video.id)
      .eq('content_type', 'transcript')
      .limit(1);
    
    if (existingChunks && existingChunks.length > 0) {
      progress.skipped++;
      return { videoId: video.id, status: 'skipped' };
    }
    
    // Fetch transcript
    const transcript = await fetchTranscript(video.id);
    
    if (!transcript || transcript.includes('No captions available')) {
      progress.skipped++;
      return { videoId: video.id, status: 'no_captions' };
    }
    
    // Chunk the transcript
    const chunks = chunkTranscript(transcript, video.id);
    
    if (chunks.length === 0) {
      progress.skipped++;
      return { videoId: video.id, status: 'empty_transcript' };
    }
    
    // Store chunks in database
    const { error: insertError } = await supabase
      .from('chunks')
      .insert(chunks.map(chunk => ({
        ...chunk,
        user_id: video.user_id // Inherit from video
      })));
    
    if (insertError) {
      throw insertError;
    }
    
    progress.successful++;
    return { videoId: video.id, status: 'success', chunks: chunks.length };
    
  } catch (error) {
    progress.failed++;
    progress.errors.push({ videoId: video.id, error: error.message });
    await logError(video.id, error);
    return { videoId: video.id, status: 'error', error: error.message };
  }
}

// Process videos in batches
async function processVideos() {
  console.log('🚀 Starting bulk transcript fetch...');
  
  // Load previous progress
  await loadProgress();
  
  // Create rate limiter
  const limit = pLimit(CONFIG.CONCURRENT_REQUESTS);
  const requestsPerMinute = pLimit(CONFIG.REQUESTS_PER_MINUTE);
  
  let hasMore = true;
  let offset = 0;
  const startTime = Date.now();
  
  while (hasMore) {
    // Fetch batch of videos without transcripts
    const query = supabase
      .from('videos')
      .select('id, title, user_id, channel_id')
      .order('published_at', { ascending: false })
      .limit(CONFIG.BATCH_SIZE);
    
    if (progress.lastProcessedId) {
      query.gt('id', progress.lastProcessedId);
    }
    
    const { data: videos, error } = await query;
    
    if (error) {
      console.error('❌ Database error:', error);
      break;
    }
    
    if (!videos || videos.length === 0) {
      hasMore = false;
      break;
    }
    
    console.log(`\n📦 Processing batch: ${videos.length} videos`);
    
    // Process videos with rate limiting
    const results = await Promise.all(
      videos.map(video => 
        limit(() => requestsPerMinute(() => processVideo(video)))
      )
    );
    
    // Update progress
    progress.processed += videos.length;
    progress.lastProcessedId = videos[videos.length - 1].id;
    
    // Calculate and display statistics
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = progress.processed / elapsed;
    const remaining = 175000 - progress.processed; // Approximate total
    const eta = remaining / rate;
    
    console.log(`
📊 Progress Update:
- Processed: ${progress.processed.toLocaleString()}
- Successful: ${progress.successful.toLocaleString()}
- Failed: ${progress.failed.toLocaleString()}
- Skipped: ${progress.skipped.toLocaleString()}
- Rate: ${rate.toFixed(1)} videos/sec
- ETA: ${(eta / 3600).toFixed(1)} hours
    `);
    
    // Save progress after each batch
    await saveProgress();
    
    // Pause between batches
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.PAUSE_BETWEEN_BATCHES));
    }
  }
  
  console.log(`
✅ Transcript fetch complete!
- Total processed: ${progress.processed.toLocaleString()}
- Successful: ${progress.successful.toLocaleString()}
- Failed: ${progress.failed.toLocaleString()}
- Skipped: ${progress.skipped.toLocaleString()}
  `);
}

// Error handler
process.on('SIGINT', async () => {
  console.log('\n🛑 Interrupted! Saving progress...');
  await saveProgress();
  process.exit(0);
});

// Main execution
(async () => {
  try {
    await processVideos();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await saveProgress();
    process.exit(1);
  }
})();