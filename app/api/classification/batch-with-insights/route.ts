import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { videoClassificationService } from '@/lib/video-classification-service';
import { pineconeService } from '@/lib/pinecone-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { batchSize = 100, useLLMThreshold = 0.6 } = await request.json();
    
    // Reset statistics for this batch
    videoClassificationService.resetStatistics();
    
    // Get unclassified videos
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('classified_at', null)
      .limit(batchSize);
      
    if (error) throw error;
    if (!videos || videos.length === 0) {
      return NextResponse.json({ 
        message: 'No unclassified videos found',
        processed: 0 
      });
    }
    
    // Initialize services
    await videoClassificationService.topicService.loadClusters();
    await pineconeService.initializeIndex();
    
    // Get embeddings
    const videoIds = videos.map(v => v.id);
    const pc = new (await import('@pinecone-database/pinecone')).Pinecone({
      apiKey: process.env.PINECONE_API_KEY!
    });
    const index = pc.index(process.env.PINECONE_INDEX_NAME!);
    const response = await index.fetch(videoIds);
    
    // Prepare videos with embeddings
    const videosWithEmbeddings = videos
      .map(video => {
        const record = response.records[video.id];
        if (!record || !record.values) return null;
        
        return {
          id: video.id,
          title: video.title,
          titleEmbedding: record.values,
          channel: video.channel_name,
          description: video.description
        };
      })
      .filter(v => v !== null);
    
    // Classify batch
    const classifications = await videoClassificationService.classifyBatch(
      videosWithEmbeddings,
      { batchSize: 50, logLowConfidence: true, useLLMThreshold }
    );
    
    // Store classifications
    await videoClassificationService.storeClassifications(classifications);
    
    // Get batch insights
    const stats = videoClassificationService.getStatistics();
    
    // Analyze what we learned from this batch
    const { data: batchFeedback } = await supabase
      .from('format_detection_feedback')
      .select('*')
      .in('video_id', videoIds)
      .eq('llm_was_used', true);
    
    // Find disagreements
    const disagreements = batchFeedback?.filter(f => 
      f.keyword_format !== f.llm_format
    ) || [];
    
    // Count patterns
    const correctionPatterns: Record<string, number> = {};
    disagreements.forEach(d => {
      const pattern = `${d.keyword_format} → ${d.llm_format}`;
      correctionPatterns[pattern] = (correctionPatterns[pattern] || 0) + 1;
    });
    
    // Get channel insights
    const channelPatterns: Record<string, Record<string, number>> = {};
    classifications.forEach(c => {
      const video = videos.find(v => v.id === c.videoId);
      if (video?.channel_name) {
        if (!channelPatterns[video.channel_name]) {
          channelPatterns[video.channel_name] = {};
        }
        channelPatterns[video.channel_name][c.format.type] = 
          (channelPatterns[video.channel_name][c.format.type] || 0) + 1;
      }
    });
    
    // Find new keyword opportunities
    const keywordOpportunities: string[] = [];
    disagreements.forEach(d => {
      if (d.llm_reasoning && d.keyword_confidence < 0.5) {
        // Extract potential keywords from titles that confused the system
        const titleWords = d.video_title.toLowerCase().split(/\s+/);
        titleWords.forEach(word => {
          if (word.length > 4 && !keywordOpportunities.includes(word)) {
            keywordOpportunities.push(word);
          }
        });
      }
    });
    
    return NextResponse.json({
      summary: {
        processed: classifications.length,
        llmUsed: stats.llmCallCount,
        llmUsageRate: ((stats.llmCallCount / classifications.length) * 100).toFixed(1),
        lowConfidence: stats.lowConfidenceCount,
        averageTopicConfidence: classifications.reduce((sum, c) => sum + c.topic.confidence, 0) / classifications.length,
        averageFormatConfidence: classifications.reduce((sum, c) => sum + c.format.confidence, 0) / classifications.length
      },
      learnings: {
        totalCorrections: disagreements.length,
        correctionRate: ((disagreements.length / stats.llmCallCount) * 100).toFixed(1),
        topCorrections: Object.entries(correctionPatterns)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([pattern, count]) => ({ pattern, count })),
        channelInsights: Object.entries(channelPatterns)
          .map(([channel, formats]) => ({
            channel,
            dominantFormat: Object.entries(formats)
              .sort((a, b) => b[1] - a[1])[0]?.[0],
            videoCount: Object.values(formats).reduce((sum, count) => sum + count, 0)
          }))
          .filter(c => c.videoCount >= 3),
        potentialKeywords: keywordOpportunities.slice(0, 10)
      },
      examples: disagreements.slice(0, 5).map(d => ({
        title: d.video_title,
        keywordThought: d.keyword_format,
        keywordConfidence: d.keyword_confidence,
        llmDecided: d.llm_format,
        llmConfidence: d.llm_confidence,
        reasoning: d.llm_reasoning
      }))
    });
    
  } catch (error) {
    console.error('Batch classification error:', error);
    return NextResponse.json(
      { error: 'Failed to process batch' },
      { status: 500 }
    );
  }
}