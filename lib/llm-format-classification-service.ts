import { openai } from './openai-client.ts';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.ts';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const VideoFormat = {
  TUTORIAL: 'tutorial',
  LISTICLE: 'listicle',
  EXPLAINER: 'explainer',
  CASE_STUDY: 'case_study',
  NEWS_ANALYSIS: 'news_analysis',
  PERSONAL_STORY: 'personal_story',
  PRODUCT_FOCUS: 'product_focus',
  LIVE_STREAM: 'live_stream',
  SHORTS: 'shorts',
  VLOG: 'vlog',
  COMPILATION: 'compilation',
  UPDATE: 'update'
} as const;

export type VideoFormat = typeof VideoFormat[keyof typeof VideoFormat];

export interface FormatClassification {
  videoId: string;
  format: VideoFormat;
  confidence: number;
  reasoning: string;
}

interface BatchClassificationResult {
  classifications: FormatClassification[];
  totalTokens: number;
  processingTimeMs: number;
}

export class LLMFormatClassificationService {
  private readonly BATCH_SIZE = 15; // Optimal batch size to avoid JSON truncation
  private readonly MAX_PARALLEL_BATCHES = 20; // Maximum parallel API calls
  
  /**
   * Classify multiple videos in batches using LLM
   */
  async classifyBatch(
    videos: Array<{
      id: string;
      title: string;
      channel?: string;
      description?: string;
    }>
  ): Promise<BatchClassificationResult> {
    const startTime = Date.now();
    const allClassifications: FormatClassification[] = [];
    let totalTokens = 0;

    // Create all batch promises upfront for maximum parallelism
    const totalBatches = Math.ceil(videos.length / this.BATCH_SIZE);
    console.log(`   📦 Processing ${videos.length} videos in ${totalBatches} batches...`);
    
    const batchPromises = [];
    const batchStatuses: Map<number, string> = new Map();
    
    for (let i = 0; i < videos.length; i += this.BATCH_SIZE) {
      const batch = videos.slice(i, i + this.BATCH_SIZE);
      const batchNumber = Math.floor(i / this.BATCH_SIZE) + 1;
      
      batchPromises.push(
        this.classifyBatchWithLLM(batch)
          .then(result => {
            batchStatuses.set(batchNumber, `✓ ${result.tokens.toLocaleString()} tokens`);
            return { batchNumber, result, success: true };
          })
          .catch(error => {
            batchStatuses.set(batchNumber, `❌ ${error.message}`);
            return { 
              batchNumber, 
              result: { classifications: [], tokens: 0 }, 
              success: false 
            };
          })
      );
    }
    
    // Process all batches with controlled concurrency
    const results = [];
    for (let i = 0; i < batchPromises.length; i += this.MAX_PARALLEL_BATCHES) {
      const chunk = batchPromises.slice(i, i + this.MAX_PARALLEL_BATCHES);
      const chunkResults = await Promise.all(chunk);
      results.push(...chunkResults);
      
      // Log progress every chunk
      const completed = Math.min(i + this.MAX_PARALLEL_BATCHES, batchPromises.length);
      console.log(`   📊 Progress: ${completed}/${totalBatches} batches (${Math.round(completed/totalBatches*100)}%)`);
    }
    
    // Process results and log summary
    let successCount = 0;
    let failedCount = 0;
    results.forEach(({ result, success }) => {
      if (success) {
        allClassifications.push(...result.classifications);
        totalTokens += result.tokens;
        successCount++;
      } else {
        failedCount++;
      }
    });
    
    console.log(`   ✅ Batch processing complete: ${successCount} succeeded, ${failedCount} failed`);

    return {
      classifications: allClassifications,
      totalTokens,
      processingTimeMs: Date.now() - startTime
    };
  }

  /**
   * Classify a batch of up to 10 videos using LLM
   */
  private async classifyBatchWithLLM(
    videos: Array<{
      id: string;
      title: string;
      channel?: string;
      description?: string;
    }>
  ): Promise<{ classifications: FormatClassification[], tokens: number }> {
    const prompt = this.buildBatchPrompt(videos);
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert at classifying YouTube educational videos into specific formats.

You MUST use ONLY these exact format values (no variations or other formats):
- tutorial: Step-by-step how-to guides
- listicle: Top N lists, tips, tricks, rankings
- explainer: Conceptual explanations, "what is" content
- case_study: Personal experiences, experiments, results
- news_analysis: Current events, updates, reactions
- personal_story: Personal journeys, life experiences
- product_focus: Reviews, comparisons, unboxings
- live_stream: Live broadcasts, streaming content, real-time interactions
- shorts: YouTube Shorts, TikTok-style content, videos under 60 seconds
- vlog: Video logs, day-in-life content, behind-the-scenes
- compilation: Best-of videos, highlights, multi-clip content, mashups
- update: Channel updates, project progress, announcements, community posts

IMPORTANT: Only use the exact format strings listed above. Do not create new formats like "podcast", "gameplay", "trailer", "event_coverage", etc. If a video doesn't fit well, choose the closest match from the 12 formats above.

Analyze the videos and return a JSON array with format classifications.`
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2000 // Increased to handle larger batches
      });

      let result;
      try {
        result = JSON.parse(response.choices[0].message.content!);
      } catch (parseError) {
        console.error('   ❌ JSON parse error, retrying with smaller batch...');
        console.error('   Raw response:', response.choices[0].message.content?.substring(0, 200) + '...');
        throw parseError;
      }
      const tokens = response.usage?.total_tokens || 0;

      // Map the results back to our format
      const classifications: FormatClassification[] = result.videos.map((v: any) => {
        // Normalize format value
        let format = v.format.trim().toLowerCase();
        
        // Map common variations to correct values
        if (format === 'live stream' || format === 'livestream') format = 'live_stream';
        if (format === 'case study' || format === 'casestudy') format = 'case_study';
        if (format === 'news analysis' || format === 'newsanalysis') format = 'news_analysis';
        if (format === 'personal story' || format === 'personalstory') format = 'personal_story';
        if (format === 'product focus' || format === 'productfocus') format = 'product_focus';
        
        // Validate format is in allowed list
        const validFormats = Object.values(VideoFormat);
        if (!validFormats.includes(format)) {
          console.error(`   ⚠️ Invalid format '${v.format}' for video ${v.id}, defaulting to 'explainer'`);
          format = VideoFormat.EXPLAINER;
        }
        
        return {
          videoId: v.id,
          format: format as VideoFormat,
          confidence: v.confidence,
          reasoning: v.reasoning
        };
      });

      return { classifications, tokens };
    } catch (error) {
      console.error('LLM classification error:', error);
      // Fallback to simple heuristics if LLM fails
      return {
        classifications: videos.map(v => this.fallbackClassification(v)),
        tokens: 0
      };
    }
  }

  /**
   * Build prompt for batch classification
   */
  private buildBatchPrompt(videos: Array<{ id: string; title: string; channel?: string; description?: string }>): string {
    const videoList = videos.map(v => ({
      id: v.id,
      title: v.title,
      channel: v.channel || 'Unknown',
      description: v.description ? v.description.substring(0, 200) : 'No description'
    }));

    return `Classify these YouTube educational videos into the correct format.

Return a JSON object with this structure:
{
  "videos": [
    {
      "id": "video_id",
      "format": "format_type",
      "confidence": 0.85,
      "reasoning": "Brief explanation"
    }
  ]
}

Videos to classify:
${JSON.stringify(videoList, null, 2)}`;
  }

  /**
   * Simple fallback classification based on title keywords
   */
  private fallbackClassification(video: { id: string; title: string }): FormatClassification {
    const title = video.title.toLowerCase();
    
    // Simple keyword matching
    if (title.includes('how to') || title.includes('tutorial')) {
      return { videoId: video.id, format: VideoFormat.TUTORIAL, confidence: 0.7, reasoning: 'Title contains tutorial keywords' };
    } else if (title.match(/\d+\s+(tips|ways|things|reasons)/)) {
      return { videoId: video.id, format: VideoFormat.LISTICLE, confidence: 0.7, reasoning: 'Title contains listicle pattern' };
    } else if (title.includes('what is') || title.includes('explained')) {
      return { videoId: video.id, format: VideoFormat.EXPLAINER, confidence: 0.7, reasoning: 'Title contains explainer keywords' };
    } else if (title.includes('review') || title.includes('vs')) {
      return { videoId: video.id, format: VideoFormat.PRODUCT_FOCUS, confidence: 0.7, reasoning: 'Title contains product keywords' };
    } else if (title.includes('my') || title.includes('i ')) {
      return { videoId: video.id, format: VideoFormat.PERSONAL_STORY, confidence: 0.6, reasoning: 'Title contains personal pronouns' };
    } else {
      return { videoId: video.id, format: VideoFormat.EXPLAINER, confidence: 0.5, reasoning: 'Default classification' };
    }
  }

  /**
   * Store classifications in the database
   */
  async storeClassifications(classifications: FormatClassification[]): Promise<void> {
    const updates = classifications.map(c => ({
      id: c.videoId,
      format_type: c.format,
      format_confidence: c.confidence,
      format_primary: c.format, // Using format_primary instead of video_format
      classification_llm_used: true,
      classification_timestamp: new Date().toISOString()
    }));

    // Update videos in batches (use update, not upsert)
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      // Update each video individually to avoid issues with missing required fields
      let successCount = 0;
      for (const update of batch) {
        const { error } = await supabase
          .from('videos')
          .update({
            format_type: update.format_type,
            format_confidence: update.format_confidence,
            format_primary: update.format_primary,
            classification_llm_used: update.classification_llm_used,
            classification_timestamp: update.classification_timestamp
          })
          .eq('id', update.id);
          
        if (error) {
          console.error('   ❌ Error storing classification for video', update.id, ':', error.message);
          console.error('      Attempted format_type:', update.format_type);
          console.error('      Attempted format_primary:', update.format_primary);
          // Continue with other videos even if one fails
        } else {
          successCount++;
        }
      }
      console.log(`   💾 Stored batch ${Math.floor(i / batchSize) + 1}: ${successCount}/${batch.length} videos updated`);
    }
  }

  /**
   * Get classification statistics
   */
  async getStatistics(): Promise<{
    totalClassified: number;
    formatDistribution: Record<VideoFormat, number>;
    averageConfidence: number;
  }> {
    // Get total count
    const { count: totalCount, error: countError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('format_type', 'is', null);

    if (countError) throw countError;

    // Get format distribution and average confidence using raw SQL for efficiency
    const { data, error } = await supabase.rpc('get_format_statistics');

    if (error) {
      // Fallback to regular query if RPC doesn't exist
      console.log('RPC not available, using regular query with pagination');
      
      const distribution: Record<VideoFormat, number> = {
        [VideoFormat.TUTORIAL]: 0,
        [VideoFormat.LISTICLE]: 0,
        [VideoFormat.EXPLAINER]: 0,
        [VideoFormat.CASE_STUDY]: 0,
        [VideoFormat.NEWS_ANALYSIS]: 0,
        [VideoFormat.PERSONAL_STORY]: 0,
        [VideoFormat.PRODUCT_FOCUS]: 0,
        [VideoFormat.LIVE_STREAM]: 0,
        [VideoFormat.SHORTS]: 0,
        [VideoFormat.VLOG]: 0,
        [VideoFormat.COMPILATION]: 0,
        [VideoFormat.UPDATE]: 0
      };

      // Fetch in batches to handle large datasets
      let offset = 0;
      const batchSize = 1000;
      let totalConfidence = 0;
      let totalRows = 0;

      while (offset < (totalCount || 0)) {
        const { data: batch, error: batchError } = await supabase
          .from('videos')
          .select('format_type, format_confidence')
          .not('format_type', 'is', null)
          .range(offset, offset + batchSize - 1);

        if (batchError) throw batchError;

        batch?.forEach(video => {
          if (video.format_type) {
            distribution[video.format_type as VideoFormat]++;
            totalConfidence += video.format_confidence || 0;
            totalRows++;
          }
        });

        offset += batchSize;
      }

      return {
        totalClassified: totalCount || 0,
        formatDistribution: distribution,
        averageConfidence: totalRows > 0 ? totalConfidence / totalRows : 0
      };
    }

    // Use RPC results if available
    const formatDist: Record<VideoFormat, number> = {
      [VideoFormat.TUTORIAL]: 0,
      [VideoFormat.LISTICLE]: 0,
      [VideoFormat.EXPLAINER]: 0,
      [VideoFormat.CASE_STUDY]: 0,
      [VideoFormat.NEWS_ANALYSIS]: 0,
      [VideoFormat.PERSONAL_STORY]: 0,
      [VideoFormat.PRODUCT_FOCUS]: 0,
      [VideoFormat.LIVE_STREAM]: 0,
      [VideoFormat.SHORTS]: 0,
      [VideoFormat.VLOG]: 0,
      [VideoFormat.COMPILATION]: 0,
      [VideoFormat.UPDATE]: 0
    };

    data?.forEach((row: any) => {
      if (row.format_type && formatDist.hasOwnProperty(row.format_type)) {
        formatDist[row.format_type as VideoFormat] = row.count;
      }
    });

    const avgConfidence = data?.find((row: any) => row.avg_confidence)?.avg_confidence || 0;

    return {
      totalClassified: totalCount || 0,
      formatDistribution: formatDist,
      averageConfidence: avgConfidence
    };
  }
}

// Export singleton instance
export const llmFormatClassificationService = new LLMFormatClassificationService();