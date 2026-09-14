import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { llmFormatClassificationService } from '@/lib/llm-format-classification-service';
import { videoTextFor } from '@/lib/app/video-text';
import { hydrateDescriptions } from '@/lib/app/video-text-routes';

export async function POST(request: Request) {
  const supabase = getSupabase();
  try {
    const { batchSize = 100 } = await request.json();
    
    console.log(`\n🎯 [LLM Classification] Starting batch classification for ${batchSize} videos...`);
    
    // Get unclassified videos (only those with valid channel_id)
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name')
      .is('format_type', null)
      .not('channel_id', 'is', null)
      .limit(batchSize);
      
    if (error) throw error;
    if (!videos || videos.length === 0) {
      console.log('❌ No unclassified videos found');
      return NextResponse.json({ 
        message: 'No unclassified videos found',
        processed: 0 
      });
    }
    
    console.log(`📊 Found ${videos.length} videos to classify`);
    // The description is no longer a column of `videos`; hydrate it from the side table for
    // exactly the ids this batch selected.
    // (the supabase-js generated types resolve these columns to `unknown`; the shape is fixed
    // by the select list above.)
    const rows = videos as unknown as Array<{ id: string; title: string; channel_name: string }>;
    const withText = hydrateDescriptions(rows, await videoTextFor(rows.map(v => v.id)));
    const result = await llmFormatClassificationService.classifyBatch(
      withText.map(v => ({
        id: v.id,
        title: v.title,
        channel: v.channel_name,
        description: v.description ?? undefined
      }))
    );
    
    // Store classifications
    console.log(`\n💾 Storing classifications in database...`);
    await llmFormatClassificationService.storeClassifications(result.classifications);
    
    // Get statistics
    const stats = await llmFormatClassificationService.getStatistics();
    
    // Calculate format distribution for this batch
    const batchDistribution: Record<string, number> = {};
    result.classifications.forEach(c => {
      batchDistribution[c.format] = (batchDistribution[c.format] || 0) + 1;
    });
    
    console.log(`\n✅ Batch classification complete!`);
    console.log(`📊 Results:`);
    console.log(`   - Videos processed: ${result.classifications.length}`);
    console.log(`   - Total tokens used: ${result.totalTokens.toLocaleString()}`);
    console.log(`   - Processing time: ${(result.processingTimeMs / 1000).toFixed(1)}s`);
    console.log(`   - Avg confidence: ${(result.classifications.reduce((sum, c) => sum + c.confidence, 0) / result.classifications.length * 100).toFixed(1)}%`);
    console.log(`   - Cost estimate: $${(result.totalTokens * 0.00000025).toFixed(4)}`);
    console.log(`\n📈 Format distribution:`);
    Object.entries(batchDistribution).forEach(([format, count]) => {
      console.log(`   - ${format}: ${count} videos (${(count / result.classifications.length * 100).toFixed(1)}%)`);
    });
    
    return NextResponse.json({
      summary: {
        processed: result.classifications.length,
        totalTokens: result.totalTokens,
        processingTimeMs: result.processingTimeMs,
        averageConfidence: result.classifications.reduce((sum, c) => sum + c.confidence, 0) / result.classifications.length,
        tokensPerVideo: Math.round(result.totalTokens / result.classifications.length)
      },
      batchResults: {
        formatDistribution: batchDistribution,
        examples: result.classifications.slice(0, 5).map(c => ({
          title: videos.find(v => v.id === c.videoId)?.title,
          format: c.format,
          confidence: c.confidence,
          reasoning: c.reasoning
        }))
      },
      overallStats: stats
    });
    
  } catch (error) {
    console.error('LLM batch classification error:', error);
    return NextResponse.json(
      { error: 'Failed to process batch' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const supabase = getSupabase();
  try {
    // Get current statistics
    const stats = await llmFormatClassificationService.getStatistics();
    
    // Get recent classifications
    const { data: recent, error } = await supabase
      .from('videos')
      .select('id, title, format_type, format_confidence, format_primary, classification_timestamp')
      .not('format_type', 'is', null)
      .order('classification_timestamp', { ascending: false })
      .limit(20);
      
    if (error) throw error;
    
    return NextResponse.json({
      stats,
      recentClassifications: recent
    });
    
  } catch (error) {
    console.error('Error fetching classification stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}