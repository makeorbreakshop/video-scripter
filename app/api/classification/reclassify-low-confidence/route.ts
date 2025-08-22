import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { llmFormatClassificationService } from '@/lib/llm-format-classification-service';

// State management
let isRunning = false;
let shouldStop = false;
let currentProgress = {
  processed: 0,
  total: 0,
  failed: 0,
  startTime: Date.now(),
  currentChunk: 0,
  totalChunks: 0
};

export async function GET() {
  return NextResponse.json({
    isRunning,
    progress: isRunning ? currentProgress : null,
    estimatedTimeRemaining: isRunning ? calculateTimeRemaining() : null
  });
}

export async function POST(request: Request) {
  const { action, confidenceThreshold = 0.8 } = await request.json();
  
  if (action === 'stop') {
    shouldStop = true;
    return NextResponse.json({ message: 'Stop signal sent' });
  }
  
  if (isRunning) {
    return NextResponse.json(
      { error: 'Reclassification already in progress' },
      { status: 400 }
    );
  }
  
  isRunning = true;
  shouldStop = false;
  
  // Start the reclassification process
  processReclassification(confidenceThreshold)
    .catch(console.error)
    .finally(() => {
      isRunning = false;
    });
  
  return NextResponse.json({ 
    message: 'Reclassification started',
    confidenceThreshold 
  });
}

async function processReclassification(confidenceThreshold: number) {
  const supabase = getSupabase();
  console.log(`Starting reclassification for videos with confidence < ${confidenceThreshold}`);
  
  // Get count of low-confidence videos
  const { count, error: countError } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .lt('format_confidence', confidenceThreshold)
    .not('format_type', 'is', null)
    .not('channel_id', 'is', null);
    
  if (countError) {
    console.error('Error counting videos:', countError);
    return;
  }
  
  const totalVideos = count || 0;
  currentProgress = {
    processed: 0,
    total: totalVideos,
    failed: 0,
    startTime: Date.now(),
    currentChunk: 0,
    totalChunks: Math.ceil(totalVideos / 500)
  };
  
  console.log(`Found ${totalVideos} videos with confidence < ${confidenceThreshold}`);
  
  const chunkSize = 500;
  
  for (let offset = 0; offset < totalVideos && !shouldStop; offset += chunkSize) {
    currentProgress.currentChunk = Math.floor(offset / chunkSize) + 1;
    
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, format_type, format_confidence')
      .lt('format_confidence', confidenceThreshold)
      .not('format_type', 'is', null)
      .not('channel_id', 'is', null)
      .order('format_confidence', { ascending: true }) // Start with lowest confidence
      .range(offset, offset + chunkSize - 1);
      
    if (error) {
      console.error('Error fetching videos:', error);
      continue;
    }
    
    if (!videos || videos.length === 0) continue;
    
    console.log(`\n🔄 Processing chunk ${currentProgress.currentChunk}/${currentProgress.totalChunks} (${videos.length} videos)`);
    console.log(`📊 Lowest confidence videos: ${videos.slice(0, 5).map(v => `${v.format_type} (${v.format_confidence?.toFixed(2)})`).join(', ')}`);
    
    try {
      // Use the SAME fast parallel processing as main classification!
      const result = await llmFormatClassificationService.classifyBatch(
        videos.map(v => ({
          id: v.id,
          title: v.title || '',
          channel: v.channel_name || undefined
        }))
      );
      
      // Store classifications
      await llmFormatClassificationService.storeClassifications(result.classifications);
      
      currentProgress.processed += videos.length;
      
      // Log improvements
      const improvements = result.classifications.filter((c, idx) => {
        const original = videos[idx];
        return c.format !== original.format_type || c.confidence > (original.format_confidence || 0);
      });
      
      console.log(`✨ ${improvements.length}/${videos.length} videos improved`);
      console.log(`⚡ Processing speed: ${(videos.length / (result.processingTimeMs / 1000)).toFixed(1)} videos/second`);
      console.log(`💰 Tokens used: ${result.totalTokens.toLocaleString()}`);
      
    } catch (error) {
      console.error('Chunk processing error:', error);
      currentProgress.failed += videos.length;
    }
    
    // Brief delay between chunks (not batches!)
    if (offset + chunkSize < totalVideos && !shouldStop) {
      console.log(`⏸️  Pausing 2 seconds before next chunk...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  const duration = Date.now() - currentProgress.startTime;
  console.log(`\n✅ Reclassification complete!`);
  console.log(`   Processed: ${currentProgress.processed}`);
  console.log(`   Failed: ${currentProgress.failed}`);
  console.log(`   Duration: ${formatDuration(duration)}`);
  console.log(`   Average speed: ${(currentProgress.processed / (duration / 1000)).toFixed(1)} videos/second`);
}

function calculateTimeRemaining(): string | null {
  const { processed, total, startTime } = currentProgress;
  if (processed === 0) return null;
  
  const elapsed = Date.now() - startTime;
  const rate = processed / (elapsed / 1000);
  const remaining = total - processed;
  const secondsRemaining = remaining / rate;
  
  return formatDuration(secondsRemaining * 1000);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}