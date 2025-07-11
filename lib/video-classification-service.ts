import { topicDetectionService, TopicDetectionService } from './topic-detection-service.ts';
import { formatDetectionService, FormatDetectionService, VideoFormat, FormatDetectionResult } from './format-detection-service.ts';
import { openai } from './openai-client.ts'; // Updated import
import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface VideoClassification {
  videoId: string;
  topic: {
    domain: string;
    niche: string;
    microTopic: string;
    clusterId: number;
    confidence: number;
  };
  format: {
    type: VideoFormat;
    confidence: number;
    llmUsed: boolean;
  };
  metadata: {
    classifiedAt: string;
    processingTimeMs: number;
    llmTokensUsed?: number;
  };
}

interface ClassificationOptions {
  useLLMThreshold?: number;
  batchSize?: number;
  logLowConfidence?: boolean;
}

export class VideoClassificationService {
  public topicService: TopicDetectionService;
  public formatService: FormatDetectionService;
  private llmCallCount: number = 0;
  private lowConfidenceLog: any[] = [];

  constructor(
    topicService: TopicDetectionService = topicDetectionService,
    formatService: FormatDetectionService = formatDetectionService
  ) {
    this.topicService = topicService;
    this.formatService = formatService;
  }

  /**
   * Classify a single video
   */
  async classifyVideo(
    videoId: string,
    title: string,
    titleEmbedding: number[],
    channel?: string,
    description?: string,
    options: ClassificationOptions = {}
  ): Promise<VideoClassification> {
    const startTime = Date.now();
    const { useLLMThreshold = 0.6, logLowConfidence = true } = options;

    // Topic detection
    const topicAssignment = await this.topicService.assignTopic(titleEmbedding);

    // Format detection
    let formatResult = this.formatService.detectFormat(title, channel, description);
    let llmUsed = false;
    let llmTokensUsed = 0;
    let llmReasoning: string | undefined;

    // Store original keyword results for learning
    const keywordFormat = formatResult.format;
    const keywordConfidence = formatResult.confidence;
    const keywordMatches = {
      strong: [...formatResult.scores[0].matchedKeywords.strong],
      medium: [...formatResult.scores[0].matchedKeywords.medium],
      weak: [...formatResult.scores[0].matchedKeywords.weak]
    };

    // Use LLM if confidence is low or explicitly required
    if (formatResult.requiresLLM || formatResult.confidence < useLLMThreshold) {
      const llmResult = await this.classifyFormatWithLLM(
        title,
        formatResult,
        channel,
        description
      );
      formatResult.format = llmResult.format;
      formatResult.confidence = llmResult.confidence;
      llmUsed = true;
      llmTokensUsed = llmResult.tokensUsed;
      llmReasoning = llmResult.reasoning;
      this.llmCallCount++;
      
      // Track the learning opportunity
      await this.trackFormatDetection(
        videoId,
        title,
        channel,
        keywordFormat,
        keywordConfidence,
        keywordMatches,
        llmResult.format,
        llmResult.confidence,
        llmReasoning,
        true
      );
    } else {
      // Also track successful keyword detections
      await this.trackFormatDetection(
        videoId,
        title,
        channel,
        keywordFormat,
        keywordConfidence,
        keywordMatches,
        null,
        null,
        null,
        false
      );
    }

    // Log low confidence cases
    if (logLowConfidence && (formatResult.confidence < 0.7 || topicAssignment.confidence < 0.7)) {
      this.lowConfidenceLog.push({
        videoId,
        title,
        topicConfidence: topicAssignment.confidence,
        formatConfidence: formatResult.confidence,
        topic: `${topicAssignment.domain} > ${topicAssignment.niche} > ${topicAssignment.microTopic}`,
        format: formatResult.format,
        timestamp: new Date().toISOString()
      });
    }

    const classification: VideoClassification = {
      videoId,
      topic: {
        domain: topicAssignment.domain,
        niche: topicAssignment.niche,
        microTopic: topicAssignment.microTopic,
        clusterId: topicAssignment.clusterId,
        confidence: topicAssignment.confidence
      },
      format: {
        type: formatResult.format,
        confidence: formatResult.confidence,
        llmUsed
      },
      metadata: {
        classifiedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
        llmTokensUsed: llmUsed ? llmTokensUsed : undefined
      }
    };

    return classification;
  }

  /**
   * Use LLM to classify format when keyword detection is uncertain
   */
  private async classifyFormatWithLLM(
    title: string,
    keywordResult: FormatDetectionResult,
    channel?: string,
    description?: string
  ): Promise<{ format: VideoFormat; confidence: number; tokensUsed: number; reasoning?: string }> {
    const topFormats = keywordResult.scores.slice(0, 3);
    
    const prompt = `Classify this YouTube video into one of these formats based on its title and metadata:

Formats:
- tutorial: How-to content, step-by-step guides, instructional videos
- listicle: Numbered lists, rankings, "top X" videos
- explainer: Educational content explaining concepts, "what is" videos
- case_study: Real examples, success/failure stories, experiments with results
- news_analysis: Current events, breaking news, reactions to announcements
- personal_story: Personal experiences, life stories, vlogs
- product_focus: Reviews, unboxings, comparisons, buying guides

Video Details:
Title: "${title}"
${channel ? `Channel: ${channel}` : ''}
${description ? `Description preview: ${description.substring(0, 200)}...` : ''}

Keyword Detection Results:
${topFormats.map(f => `- ${f.format}: score ${f.score} (matched: ${
  [...f.matchedKeywords.strong, ...f.matchedKeywords.medium].join(', ')
})`).join('\n')}

Based on the title and any available context, which format best describes this video? Consider the keyword matches but make your own assessment.

Respond with JSON: { "format": "format_name", "confidence": 0.0-1.0, "reasoning": "brief explanation" }`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 150,
        response_format: { type: 'json_object' }
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      // Log LLM decision for analysis
      console.log(`LLM Format Classification: ${title} -> ${result.format} (${result.confidence})`);
      
      return {
        format: result.format as VideoFormat,
        confidence: result.confidence || 0.8,
        tokensUsed: response.usage?.total_tokens || 0,
        reasoning: result.reasoning
      };
    } catch (error) {
      console.error('LLM classification error:', error);
      // Fall back to keyword detection result
      return {
        format: keywordResult.format,
        confidence: keywordResult.confidence,
        tokensUsed: 0,
        reasoning: undefined
      };
    }
  }

  /**
   * Classify multiple videos in batch
   */
  async classifyBatch(
    videos: Array<{
      id: string;
      title: string;
      titleEmbedding: number[];
      channel?: string;
      description?: string;
    }>,
    options: ClassificationOptions = {}
  ): Promise<VideoClassification[]> {
    const { batchSize = 10 } = options;
    const results: VideoClassification[] = [];

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(video => 
          this.classifyVideo(
            video.id,
            video.title,
            video.titleEmbedding,
            video.channel,
            video.description,
            options
          )
        )
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Store classification results in database
   */
  async storeClassifications(classifications: VideoClassification[]): Promise<void> {
    // Update each video's classification fields individually
    for (const classification of classifications) {
      const { error } = await supabase
        .from('videos')
        .update({
          topic_domain: classification.topic.domain,
          topic_niche: classification.topic.niche,
          topic_micro: classification.topic.microTopic,
          topic_cluster_id: classification.topic.clusterId,
          topic_confidence: classification.topic.confidence,
          format_type: classification.format.type,
          format_confidence: classification.format.confidence,
          format_llm_used: classification.format.llmUsed,
          classified_at: classification.metadata.classifiedAt
        })
        .eq('id', classification.videoId);

      if (error) {
        console.error(`Error storing classification for video ${classification.videoId}:`, error);
        // Continue with other videos even if one fails
      }
    }
  }

  /**
   * Get classification statistics
   */
  getStatistics(): {
    llmCallCount: number;
    lowConfidenceCount: number;
    averageConfidence: {
      topic: number;
      format: number;
    };
  } {
    const topicConfidences = this.lowConfidenceLog.map(l => l.topicConfidence);
    const formatConfidences = this.lowConfidenceLog.map(l => l.formatConfidence);

    return {
      llmCallCount: this.llmCallCount,
      lowConfidenceCount: this.lowConfidenceLog.length,
      averageConfidence: {
        topic: topicConfidences.length > 0 
          ? topicConfidences.reduce((a, b) => a + b, 0) / topicConfidences.length 
          : 0,
        format: formatConfidences.length > 0
          ? formatConfidences.reduce((a, b) => a + b, 0) / formatConfidences.length
          : 0
      }
    };
  }

  /**
   * Export low confidence cases for analysis
   */
  exportLowConfidenceCases(): any[] {
    return [...this.lowConfidenceLog];
  }

  /**
   * Reset statistics and logs
   */
  resetStatistics(): void {
    this.llmCallCount = 0;
    this.lowConfidenceLog = [];
  }

  /**
   * Track format detection for learning
   */
  private async trackFormatDetection(
    videoId: string,
    title: string,
    channel: string | undefined,
    keywordFormat: string,
    keywordConfidence: number,
    keywordMatches: any,
    llmFormat: string | null,
    llmConfidence: number | null,
    llmReasoning: string | undefined,
    llmWasUsed: boolean
  ): Promise<void> {
    try {
      await supabase
        .from('format_detection_feedback')
        .insert({
          video_id: videoId,
          video_title: title,
          channel_name: channel,
          keyword_format: keywordFormat,
          keyword_confidence: keywordConfidence,
          keyword_matches: keywordMatches,
          llm_format: llmFormat,
          llm_confidence: llmConfidence,
          llm_reasoning: llmReasoning,
          final_format: llmWasUsed ? llmFormat : keywordFormat,
          final_confidence: llmWasUsed ? llmConfidence : keywordConfidence,
          llm_was_used: llmWasUsed
        });
    } catch (error) {
      // Don't fail classification if tracking fails
      console.error('Failed to track format detection:', error);
    }
  }
}

// Export singleton instance
export const videoClassificationService = new VideoClassificationService();