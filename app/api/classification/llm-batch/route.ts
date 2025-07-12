import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { llmFormatClassificationService } from '@/lib/llm-format-classification-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { batchSize = 100 } = await request.json();
    
    console.log(`\n🎯 [LLM Classification] Starting batch classification for ${batchSize} videos...`);
    
    // Get unclassified videos (only those with valid channel_id)
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
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
    const result = await llmFormatClassificationService.classifyBatch(
      videos.map(v => ({
        id: v.id,
        title: v.title,
        channel: v.channel_name,
        description: v.description
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