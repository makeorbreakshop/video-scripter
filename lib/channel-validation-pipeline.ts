// Channel Validation Pipeline
// Scores and validates discovered channels for import eligibility

import { supabase } from './supabase-client';

export interface ValidationScore {
  networkCentrality: number;    // 0-1: How many sources discovered this channel
  contentRelevance: number;     // 0-1: Title pattern matching score
  engagementQuality: number;    // 0-1: Views-to-subscriber ratio
  uploadConsistency: number;    // 0-1: Regular posting schedule estimate
  overallScore: number;         // 0-5: Weighted combination
}

export interface ChannelValidationResult {
  channelId: string;
  channelTitle: string;
  currentStatus: string;
  scores: ValidationScore;
  recommendation: 'approve' | 'review' | 'reject';
  reasonCodes: string[];
  metadata: any;
}

export interface TitlePattern {
  pattern: string;
  multiplier: number;
  category: string;
  examples: string[];
}

export class ChannelValidationPipeline {
  
  // High-performing title patterns from clustering analysis
  private titlePatterns: TitlePattern[] = [
    {
      pattern: /\bI tested\b/i,
      multiplier: 1.68,
      category: 'testing',
      examples: ['I Tested Every', 'I Tested The']
    },
    {
      pattern: /\$[\d,]+\s*(vs|versus)\s*\$[\d,]+/i,
      multiplier: 1.94,
      category: 'price_comparison',
      examples: ['$50 vs $5000', '$100 versus $1000']
    },
    {
      pattern: /\b(worst|best)\b.*\b(purchases?|buys?|investments?)\b/i,
      multiplier: 1.52,
      category: 'purchase_advice',
      examples: ['Worst Purchases', 'Best Investment']
    },
    {
      pattern: /\b(shocking|surprised?|unexpected)\b/i,
      multiplier: 1.41,
      category: 'surprise',
      examples: ['Shocking Results', 'Surprised Me']
    },
    {
      pattern: /\bwhy\s+.*\s+(wrong|lying|fake)\b/i,
      multiplier: 1.37,
      category: 'controversy',
      examples: ['Why Everyone Is Wrong', 'Why Experts Are Lying']
    },
    {
      pattern: /\bhidden\s+(truth|secret|cost|problem)\b/i,
      multiplier: 1.33,
      category: 'revelation',
      examples: ['Hidden Truth About', 'Hidden Cost Of']
    },
    {
      pattern: /\b\d+\s+(star|stars)\s+vs\s+\d+\s+(star|stars)\b/i,
      multiplier: 1.29,
      category: 'rating_comparison',
      examples: ['1 Star vs 5 Star', '2 Stars vs 4 Stars']
    }
  ];

  /**
   * Validates all pending discovered channels
   */
  async validatePendingChannels(): Promise<ChannelValidationResult[]> {
    const { data: pendingChannels, error } = await supabase
      .from('subscription_discovery')
      .select('*')
      .eq('validation_status', 'pending')
      .order('discovery_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch pending channels: ${error.message}`);
    }

    if (!pendingChannels || pendingChannels.length === 0) {
      console.log('No pending channels to validate');
      return [];
    }

    console.log(`🔍 Validating ${pendingChannels.length} pending channels`);

    const results: ChannelValidationResult[] = [];

    for (const channel of pendingChannels) {
      try {
        const result = await this.validateChannel(channel);
        results.push(result);

        // Update the database with validation results
        await this.updateChannelValidation(channel.id, result);

      } catch (error) {
        console.error(`Error validating channel ${channel.discovered_channel_id}:`, error);
        results.push({
          channelId: channel.discovered_channel_id,
          channelTitle: channel.channel_metadata?.title || 'Unknown',
          currentStatus: 'error',
          scores: {
            networkCentrality: 0,
            contentRelevance: 0,
            engagementQuality: 0,
            uploadConsistency: 0,
            overallScore: 0
          },
          recommendation: 'reject',
          reasonCodes: ['validation_error'],
          metadata: channel.channel_metadata
        });
      }
    }

    return results;
  }

  /**
   * Validates a single channel and calculates scoring
   */
  async validateChannel(channelData: any): Promise<ChannelValidationResult> {
    const channelId = channelData.discovered_channel_id;
    const metadata = channelData.channel_metadata || {};

    // Calculate individual scores
    const networkCentrality = await this.calculateNetworkCentrality(channelId);
    const contentRelevance = await this.calculateContentRelevance(channelId, metadata);
    const engagementQuality = this.calculateEngagementQuality(metadata);
    const uploadConsistency = this.calculateUploadConsistency(metadata);

    // Calculate weighted overall score (0-5 scale)
    const overallScore = this.calculateOverallScore({
      networkCentrality,
      contentRelevance,
      engagementQuality,
      uploadConsistency
    });

    const scores: ValidationScore = {
      networkCentrality,
      contentRelevance,
      engagementQuality,
      uploadConsistency,
      overallScore
    };

    // Determine recommendation and reason codes
    const { recommendation, reasonCodes } = this.generateRecommendation(scores, metadata);

    return {
      channelId,
      channelTitle: metadata.title || 'Unknown Channel',
      currentStatus: 'validated',
      scores,
      recommendation,
      reasonCodes,
      metadata
    };
  }

  /**
   * Calculates network centrality score (0-1)
   * Based on how many different source channels discovered this channel
   */
  private async calculateNetworkCentrality(channelId: string): Promise<number> {
    try {
      const { data: discoveries, error } = await supabase
        .from('subscription_discovery')
        .select('source_channel_id')
        .eq('discovered_channel_id', channelId);

      if (error) {
        console.warn(`Error calculating network centrality for ${channelId}:`, error);
        return 0;
      }

      const uniqueSources = new Set(discoveries?.map(d => d.source_channel_id) || []).size;
      
      // Score based on number of sources (max score at 5+ sources)
      return Math.min(uniqueSources / 5, 1);
    } catch (error) {
      console.warn(`Error in network centrality calculation:`, error);
      return 0;
    }
  }

  /**
   * Calculates content relevance score (0-1)
   * Based on title pattern matching against high-performing patterns
   */
  private async calculateContentRelevance(channelId: string, metadata: any): Promise<number> {
    try {
      // Get recent video titles for this channel if available
      const { data: videos } = await supabase
        .from('videos')
        .select('title')
        .eq('channel_id', channelId)
        .order('published_at', { ascending: false })
        .limit(20);

      const titles = videos?.map(v => v.title) || [];
      
      // If no videos in our DB, use channel title and description
      if (titles.length === 0) {
        const channelTitle = metadata.title || '';
        const channelDescription = metadata.description || '';
        titles.push(channelTitle, channelDescription);
      }

      let totalScore = 0;
      let matchCount = 0;

      for (const title of titles) {
        if (!title) continue;

        for (const pattern of this.titlePatterns) {
          if (pattern.pattern.test(title)) {
            totalScore += pattern.multiplier;
            matchCount++;
          }
        }
      }

      if (matchCount === 0) return 0;

      // Normalize score to 0-1 range (assuming max multiplier of 2.0)
      const averageScore = totalScore / matchCount;
      return Math.min(averageScore / 2.0, 1);

    } catch (error) {
      console.warn(`Error calculating content relevance:`, error);
      return 0;
    }
  }

  /**
   * Calculates engagement quality score (0-1)
   * Based on views-to-subscriber ratio and overall engagement
   */
  private calculateEngagementQuality(metadata: any): number {
    try {
      const subscriberCount = metadata.subscriberCount || 0;
      const viewCount = metadata.viewCount || 0;
      const videoCount = metadata.videoCount || 1;

      if (subscriberCount === 0 || viewCount === 0) return 0;

      // Calculate average views per video
      const avgViewsPerVideo = viewCount / videoCount;
      
      // Calculate views-to-subscriber ratio
      const viewsToSubsRatio = avgViewsPerVideo / subscriberCount;

      // Good engagement: 0.1+ views per subscriber per video
      // Excellent engagement: 1.0+ views per subscriber per video
      const engagementScore = Math.min(viewsToSubsRatio / 1.0, 1);

      return Math.max(0, engagementScore);
    } catch (error) {
      console.warn(`Error calculating engagement quality:`, error);
      return 0;
    }
  }

  /**
   * Calculates upload consistency score (0-1)
   * Estimates posting frequency based on channel age and video count
   */
  private calculateUploadConsistency(metadata: any): number {
    try {
      const publishedAt = metadata.publishedAt;
      const videoCount = metadata.videoCount || 0;

      if (!publishedAt || videoCount === 0) return 0;

      const channelAge = Date.now() - new Date(publishedAt).getTime();
      const channelAgeMonths = channelAge / (1000 * 60 * 60 * 24 * 30);

      if (channelAgeMonths === 0) return 0;

      // Calculate videos per month
      const videosPerMonth = videoCount / channelAgeMonths;

      // Good consistency: 4+ videos per month (1 per week)
      // Excellent consistency: 8+ videos per month (2 per week)
      const consistencyScore = Math.min(videosPerMonth / 8, 1);

      return Math.max(0, consistencyScore);
    } catch (error) {
      console.warn(`Error calculating upload consistency:`, error);
      return 0;
    }
  }

  /**
   * Calculates weighted overall score (0-5 scale)
   */
  private calculateOverallScore(scores: Omit<ValidationScore, 'overallScore'>): number {
    const weights = {
      networkCentrality: 0.3,    // 30% - How connected they are
      contentRelevance: 0.4,     // 40% - Most important: content alignment
      engagementQuality: 0.2,    // 20% - Audience engagement
      uploadConsistency: 0.1     // 10% - Posting frequency
    };

    const weightedSum = 
      scores.networkCentrality * weights.networkCentrality +
      scores.contentRelevance * weights.contentRelevance +
      scores.engagementQuality * weights.engagementQuality +
      scores.uploadConsistency * weights.uploadConsistency;

    // Convert to 0-5 scale
    return weightedSum * 5;
  }

  /**
   * Generates recommendation and reason codes
   */
  private generateRecommendation(
    scores: ValidationScore, 
    metadata: any
  ): { recommendation: 'approve' | 'review' | 'reject'; reasonCodes: string[] } {
    const reasonCodes: string[] = [];
    
    // Auto-approve criteria (score >= 4.0)
    if (scores.overallScore >= 4.0) {
      reasonCodes.push('high_overall_score');
      return { recommendation: 'approve', reasonCodes };
    }

    // Auto-reject criteria
    if (scores.overallScore < 1.5) {
      reasonCodes.push('low_overall_score');
      return { recommendation: 'reject', reasonCodes };
    }

    // Check individual score thresholds for approval
    if (scores.overallScore >= 3.0) {
      if (scores.networkCentrality >= 0.6) {
        reasonCodes.push('high_network_centrality');
      }
      if (scores.contentRelevance >= 0.7) {
        reasonCodes.push('high_content_relevance');
      }
      if (scores.engagementQuality >= 0.5) {
        reasonCodes.push('good_engagement');
      }
      
      // If we have good scores in multiple areas, approve
      if (reasonCodes.length >= 2) {
        return { recommendation: 'approve', reasonCodes };
      }
    }

    // Check for specific rejection criteria
    const subscriberCount = metadata.subscriberCount || 0;
    const videoCount = metadata.videoCount || 0;

    if (subscriberCount < 1000) {
      reasonCodes.push('insufficient_subscribers');
    }
    if (videoCount < 10) {
      reasonCodes.push('insufficient_videos');
    }
    if (scores.contentRelevance < 0.2) {
      reasonCodes.push('low_content_relevance');
    }

    // If too many rejection criteria, reject
    if (reasonCodes.length >= 2) {
      return { recommendation: 'reject', reasonCodes };
    }

    // Otherwise, needs manual review
    reasonCodes.push('manual_review_needed');
    return { recommendation: 'review', reasonCodes };
  }

  /**
   * Updates channel validation in database
   */
  private async updateChannelValidation(
    discoveryId: number,
    result: ChannelValidationResult
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('subscription_discovery')
        .update({
          validation_status: result.recommendation === 'approve' ? 'approved' : 
                           result.recommendation === 'reject' ? 'rejected' : 'pending',
          relevance_score: result.scores.overallScore,
          channel_metadata: {
            ...result.metadata,
            validation_scores: result.scores,
            validation_reasons: result.reasonCodes,
            validated_at: new Date().toISOString()
          }
        })
        .eq('id', discoveryId);

      if (error) {
        throw new Error(`Failed to update validation: ${error.message}`);
      }

      console.log(`✅ Updated validation for ${result.channelTitle}: ${result.recommendation} (${result.scores.overallScore.toFixed(2)})`);
    } catch (error) {
      console.error('Error updating channel validation:', error);
    }
  }

  /**
   * Gets validation statistics
   */
  async getValidationStats(): Promise<{
    pending: number;
    approved: number;
    rejected: number;
    needsReview: number;
    averageScore: number;
  }> {
    try {
      const { data: stats } = await supabase
        .from('subscription_discovery')
        .select('validation_status, relevance_score');

      if (!stats) {
        return { pending: 0, approved: 0, rejected: 0, needsReview: 0, averageScore: 0 };
      }

      const pending = stats.filter(s => s.validation_status === 'pending').length;
      const approved = stats.filter(s => s.validation_status === 'approved').length;
      const rejected = stats.filter(s => s.validation_status === 'rejected').length;
      const needsReview = stats.filter(s => 
        s.validation_status === 'pending' && s.relevance_score !== null
      ).length;

      const scores = stats.filter(s => s.relevance_score !== null).map(s => s.relevance_score);
      const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

      return { pending, approved, rejected, needsReview, averageScore };
    } catch (error) {
      console.error('Error getting validation stats:', error);
      return { pending: 0, approved: 0, rejected: 0, needsReview: 0, averageScore: 0 };
    }
  }

  /**
   * Gets channels ready for manual review
   */
  async getChannelsForReview(limit: number = 50): Promise<ChannelValidationResult[]> {
    const { data: channels, error } = await supabase
      .from('subscription_discovery')
      .select('*')
      .eq('validation_status', 'pending')
      .not('relevance_score', 'is', null)
      .gte('relevance_score', 1.5)
      .lt('relevance_score', 4.0)
      .order('relevance_score', { ascending: false })
      .limit(limit);

    if (error || !channels) {
      console.error('Error fetching channels for review:', error);
      return [];
    }

    return channels.map(channel => ({
      channelId: channel.discovered_channel_id,
      channelTitle: channel.channel_metadata?.title || 'Unknown',
      currentStatus: channel.validation_status,
      scores: channel.channel_metadata?.validation_scores || {
        networkCentrality: 0,
        contentRelevance: 0,
        engagementQuality: 0,
        uploadConsistency: 0,
        overallScore: channel.relevance_score || 0
      },
      recommendation: 'review',
      reasonCodes: channel.channel_metadata?.validation_reasons || [],
      metadata: channel.channel_metadata
    }));
  }
}

// Singleton instance
export const channelValidationPipeline = new ChannelValidationPipeline();