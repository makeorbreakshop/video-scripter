import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { llmFormatClassificationService } from '@/lib/llm-format-classification-service';
import fs from 'fs/promises';
import path from 'path';

// Configuration
const CONFIG = {
  CHUNK_SIZE: 500,              // Videos per chunk
  CHUNK_DELAY_MS: 2000,         // Delay between chunks (2 seconds)
  MAX_RETRIES: 3,               // Retry failed batches
  RETRY_DELAY_MS: 5000,         // Delay before retry (5 seconds)
  PROGRESS_LOG_INTERVAL: 1000,  // Log progress every N videos
};

// Progress file path - use temp directory for better reliability
const PROGRESS_FILE = path.join('/tmp', 'classification-progress.json');

// Global state for the running process
let isRunning = false;
let shouldStop = false;
let currentProgress = {
  processed: 0,
  total: 0,
  failed: 0,
  startTime: 0,
  currentChunk: 0,
  totalChunks: 0,
};

// Save progress to file
async function saveProgress() {
  try {
    const data = {
      isRunning,
      shouldStop,
      currentProgress,
      lastUpdated: Date.now()
    };
    await fs.writeFile(PROGRESS_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Progress saved: ${currentProgress.processed}/${currentProgress.total} videos`);
  } catch (error) {
    console.error('❌ Error saving progress:', error);
  }
}

// Load progress from file
async function loadProgress() {
  try {
    const data = await fs.readFile(PROGRESS_FILE, 'utf-8');
    const saved = JSON.parse(data);
    
    // Check if the saved progress is still valid (not older than 5 minutes)
    if (saved.lastUpdated && Date.now() - saved.lastUpdated < 5 * 60 * 1000) {
      isRunning = saved.isRunning;
      shouldStop = saved.shouldStop;
      currentProgress = saved.currentProgress;
      return true;
    }
  } catch (error) {
    // File doesn't exist or is invalid, that's ok
  }
  return false;
}

// Initialize by loading any saved progress
loadProgress();

export async function POST(request: Request) {
  const supabase = getSupabase();
  try {
    const { action, totalLimit } = await request.json();
    
    if (action === 'stop') {
      shouldStop = true;
      await saveProgress();
      return NextResponse.json({ message: 'Stop signal sent' });
    }
    
    if (action === 'resume') {
      // Try to resume from saved progress
      const hasProgress = await loadProgress();
      if (!hasProgress || !currentProgress.total) {
        return NextResponse.json({ 
          error: 'No saved progress to resume from',
        }, { status: 400 });
      }
      
      if (isRunning) {
        return NextResponse.json({ 
          error: 'Classification already running',
          progress: currentProgress 
        }, { status: 400 });
      }
      
      // Resume the classification
      isRunning = true;
      shouldStop = false;
      console.log(`\n🔄 [Auto Classification] Resuming classification from chunk ${currentProgress.currentChunk}...`);
      
      processAllVideos(currentProgress.total).catch(error => {
        console.error('❌ Auto classification error:', error);
      }).finally(() => {
        isRunning = false;
        saveProgress();
      });
      
      return NextResponse.json({
        message: 'Classification resumed',
        resumedFrom: {
          chunk: currentProgress.currentChunk,
          processed: currentProgress.processed,
          total: currentProgress.total
        }
      });
    }
    
    if (isRunning) {
      return NextResponse.json({ 
        error: 'Classification already running',
        progress: currentProgress 
      }, { status: 400 });
    }
    
    // Start the classification process
    isRunning = true;
    shouldStop = false;
    
    console.log(`\n🚀 [Auto Classification] Starting automated classification run...`);
    
    // Get total count of unclassified videos
    const { count } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('format_type', null)
      .not('channel_id', 'is', null);
      
    const totalVideos = Math.min(count || 0, totalLimit || count || 0);
    const totalChunks = Math.ceil(totalVideos / CONFIG.CHUNK_SIZE);
    
    console.log(`📊 Total videos to classify: ${totalVideos.toLocaleString()}`);
    console.log(`📦 Will process in ${totalChunks} chunks of ${CONFIG.CHUNK_SIZE} videos`);
    
    // Initialize progress
    currentProgress = {
      processed: 0,
      total: totalVideos,
      failed: 0,
      startTime: Date.now(),
      currentChunk: 0,
      totalChunks,
    };
    
    // Save initial progress
    await saveProgress();
    
    // Process in background
    processAllVideos(totalVideos).catch(error => {
      console.error('❌ Auto classification error:', error);
    }).finally(() => {
      isRunning = false;
      saveProgress();
    });
    
    return NextResponse.json({
      message: 'Classification started',
      totalVideos,
      totalChunks,
      estimatedTimeMinutes: Math.round(totalVideos / 3.5 / 60), // Based on 3.5 videos/sec
    });
    
  } catch (error) {
    console.error('Error starting classification:', error);
    isRunning = false;
    return NextResponse.json(
      { error: 'Failed to start classification' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Try to load saved progress if we don't have it in memory
  if (!isRunning && !currentProgress.total) {
    await loadProgress();
  }
  
  return NextResponse.json({
    isRunning,
    progress: currentProgress,
    estimatedTimeRemaining: isRunning ? calculateTimeRemaining() : null,
  });
}

async function processAllVideos(totalVideos: number) {
  let processedTotal = currentProgress.processed || 0;
  let startChunk = currentProgress.currentChunk || 0;
  
  // If resuming, adjust the start point
  if (processedTotal > 0) {
    console.log(`📌 Resuming from chunk ${startChunk + 1}, ${processedTotal} videos already processed`);
  }
  
  for (let chunkIndex = startChunk; chunkIndex < currentProgress.totalChunks; chunkIndex++) {
    if (shouldStop) {
      console.log('⏹️  Classification stopped by user');
      break;
    }
    
    currentProgress.currentChunk = chunkIndex + 1;
    const offset = chunkIndex * CONFIG.CHUNK_SIZE;
    
    console.log(`\n📦 Processing chunk ${chunkIndex + 1}/${currentProgress.totalChunks}`);
    
    // Get next chunk of videos
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('format_type', null)
      .not('channel_id', 'is', null)
      .limit(CONFIG.CHUNK_SIZE)
      .order('created_at', { ascending: true }); // Process oldest first
      
    if (error || !videos || videos.length === 0) {
      console.log('No more videos to process');
      break;
    }
    
    // Process chunk with retry logic
    let retries = 0;
    let chunkProcessed = false;
    
    while (!chunkProcessed && retries < CONFIG.MAX_RETRIES) {
      try {
        const result = await llmFormatClassificationService.classifyBatch(
          videos.map(v => ({
            id: v.id,
            title: v.title,
            channel: v.channel_name,
            description: v.description
          }))
        );
        
        // Store classifications
        await llmFormatClassificationService.storeClassifications(result.classifications);
        
        processedTotal += result.classifications.length;
        currentProgress.processed = processedTotal;
        
        console.log(`✅ Chunk ${chunkIndex + 1} complete: ${result.classifications.length} videos classified`);
        console.log(`💰 Cost so far: $${(processedTotal * 0.000042).toFixed(2)}`);
        
        // Save progress after each chunk
        await saveProgress();
        
        // Log progress at intervals
        if (processedTotal % CONFIG.PROGRESS_LOG_INTERVAL === 0 || processedTotal === totalVideos) {
          const elapsed = (Date.now() - currentProgress.startTime) / 1000;
          const rate = processedTotal / elapsed;
          console.log(`📊 Progress: ${processedTotal.toLocaleString()}/${totalVideos.toLocaleString()} (${Math.round(processedTotal/totalVideos*100)}%) - ${rate.toFixed(1)} videos/sec`);
        }
        
        chunkProcessed = true;
        
      } catch (error: any) {
        retries++;
        console.error(`❌ Chunk ${chunkIndex + 1} failed (attempt ${retries}/${CONFIG.MAX_RETRIES}):`, error.message);
        
        if (retries < CONFIG.MAX_RETRIES) {
          console.log(`⏳ Retrying in ${CONFIG.RETRY_DELAY_MS/1000} seconds...`);
          await delay(CONFIG.RETRY_DELAY_MS);
        } else {
          currentProgress.failed += videos.length;
          console.error(`❌ Chunk ${chunkIndex + 1} failed after ${CONFIG.MAX_RETRIES} retries, skipping...`);
        }
      }
    }
    
    // Delay between chunks to avoid overwhelming the API
    if (chunkIndex < currentProgress.totalChunks - 1 && !shouldStop) {
      console.log(`⏳ Waiting ${CONFIG.CHUNK_DELAY_MS/1000}s before next chunk...`);
      await delay(CONFIG.CHUNK_DELAY_MS);
    }
  }
  
  // Final summary
  const totalTime = (Date.now() - currentProgress.startTime) / 1000;
  console.log(`\n🎉 Classification run complete!`);
  console.log(`📊 Final stats:`);
  console.log(`   - Total processed: ${currentProgress.processed.toLocaleString()}`);
  console.log(`   - Failed: ${currentProgress.failed.toLocaleString()}`);
  console.log(`   - Total time: ${formatTime(totalTime)}`);
  console.log(`   - Average rate: ${(currentProgress.processed / totalTime).toFixed(1)} videos/sec`);
  console.log(`   - Total cost: $${(currentProgress.processed * 0.000042).toFixed(2)}`);
}

function calculateTimeRemaining(): string {
  if (currentProgress.processed === 0) return 'Calculating...';
  
  const elapsed = (Date.now() - currentProgress.startTime) / 1000;
  const rate = currentProgress.processed / elapsed;
  const remaining = (currentProgress.total - currentProgress.processed) / rate;
  
  return formatTime(remaining);
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}