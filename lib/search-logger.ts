import fs from 'fs';
import path from 'path';

interface SearchLogEntry {
  timestamp: string;
  concept: string;
  expandedQueries: string[];
  expandedQueriesByThread?: any[]; // New: thread-organized queries
  searchResults: {
    videoId: string;
    title: string;
    channelName: string;
    similarityScore: number;
    performanceRatio?: number;
    viewCount?: number;
    foundVia?: { // New: attribution data
      thread: string;
      query: string;
      threadPurpose: string;
    };
  }[];
  performanceDistribution: {
    superstar: number;
    strong: number;
    above_avg: number;
    normal: number;
  };
  claudePrompt?: string; // Made optional for multi-thread
  claudePrompts?: Record<string, string>; // New: prompts by thread
  discoveredPatterns: any[];
  threadAnalysis?: any[]; // New: analysis breakdown by thread
  processingSteps: any[];
  costs: any;
  totalProcessingTime: number;
}

export class SearchLogger {
  private logsDir: string;

  constructor() {
    this.logsDir = path.join(process.cwd(), 'search-logs');
    // Ensure directory exists
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  async logSearch(data: SearchLogEntry): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedConcept = data.concept.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
    const filename = `search-log-${timestamp}-${sanitizedConcept}.json`;
    const filepath = path.join(this.logsDir, filename);

    // Add analysis to the log
    const logWithAnalysis = {
      ...data,
      analysis: this.analyzeSearchResults(data)
    };

    try {
      await fs.promises.writeFile(filepath, JSON.stringify(logWithAnalysis, null, 2));
      console.log(`📝 Search log saved: ${filename}`);
      return filepath;
    } catch (error) {
      console.error('Error saving search log:', error);
      throw error;
    }
  }

  private analyzeSearchResults(data: SearchLogEntry) {
    const { searchResults, concept } = data;
    
    // Analyze topic relevance
    const conceptKeywords = concept.toLowerCase().split(' ');
    const relevantVideos = searchResults.filter(video => {
      const title = video.title.toLowerCase();
      return conceptKeywords.some(keyword => title.includes(keyword));
    });

    // Analyze channel distribution
    const channelCounts = searchResults.reduce((acc, video) => {
      acc[video.channelName] = (acc[video.channelName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Analyze performance distribution
    const performanceAnalysis = {
      averagePerformance: searchResults.reduce((sum, v) => sum + (v.performanceRatio || 0), 0) / searchResults.length,
      highPerformers: searchResults.filter(v => (v.performanceRatio || 0) >= 3).length,
      superStars: searchResults.filter(v => (v.performanceRatio || 0) >= 10).length
    };

    // Analyze similarity scores
    const similarityAnalysis = {
      averageSimilarity: searchResults.reduce((sum, v) => sum + v.similarityScore, 0) / searchResults.length,
      highSimilarity: searchResults.filter(v => v.similarityScore >= 0.7).length,
      lowSimilarity: searchResults.filter(v => v.similarityScore < 0.5).length
    };

    // Content analysis - check for topic drift
    const topicAnalysis = this.analyzeTopicRelevance(searchResults, concept);

    // Multi-thread analysis (if available)
    const threadAnalysis = this.analyzeThreadContribution(searchResults, data.expandedQueriesByThread);

    return {
      totalVideos: searchResults.length,
      relevantVideos: relevantVideos.length,
      relevancePercentage: (relevantVideos.length / searchResults.length) * 100,
      topChannels: Object.entries(channelCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([channel, count]) => ({ channel, count })),
      performanceAnalysis,
      similarityAnalysis,
      topicAnalysis,
      threadAnalysis,
      potentialIssues: this.identifyIssues(searchResults, concept, relevantVideos)
    };
  }

  private analyzeTopicRelevance(searchResults: any[], concept: string) {
    const conceptWords = concept.toLowerCase().split(' ');
    const topics = new Map<string, number>();
    
    searchResults.forEach(video => {
      const title = video.title.toLowerCase();
      const words = title.split(' ');
      
      // Count significant words (longer than 3 characters)
      words.forEach(word => {
        if (word.length > 3 && !['this', 'that', 'with', 'from', 'they', 'were', 'been', 'have', 'your', 'what', 'when', 'where', 'will', 'more', 'best', 'good', 'great'].includes(word)) {
          topics.set(word, (topics.get(word) || 0) + 1);
        }
      });
    });

    // Get top topics
    const topTopics = Array.from(topics.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 20)
      .map(([topic, count]) => ({ topic, count, percentage: (count / searchResults.length) * 100 }));

    return {
      topTopics,
      conceptWordsFound: conceptWords.filter(word => topics.has(word)),
      unexpectedTopics: topTopics.filter(({ topic, count }) => 
        !conceptWords.includes(topic) && count > searchResults.length * 0.1
      )
    };
  }

  private identifyIssues(searchResults: any[], concept: string, relevantVideos: any[]) {
    const issues = [];
    
    // Check for low relevance
    const relevancePercentage = (relevantVideos.length / searchResults.length) * 100;
    if (relevancePercentage < 50) {
      issues.push({
        type: 'LOW_RELEVANCE',
        message: `Only ${relevancePercentage.toFixed(1)}% of results are relevant to "${concept}"`,
        severity: 'high'
      });
    }

    // Check for topic drift
    const conceptWords = concept.toLowerCase().split(' ');
    const unexpectedVideos = searchResults.filter(video => {
      const title = video.title.toLowerCase();
      return !conceptWords.some(keyword => title.includes(keyword));
    });

    if (unexpectedVideos.length > searchResults.length * 0.3) {
      issues.push({
        type: 'TOPIC_DRIFT',
        message: `${unexpectedVideos.length} videos don't match concept keywords`,
        severity: 'medium',
        examples: unexpectedVideos.slice(0, 5).map(v => v.title)
      });
    }

    // Check for low performance
    const highPerformers = searchResults.filter(v => (v.performanceRatio || 0) >= 3);
    if (highPerformers.length < 5) {
      issues.push({
        type: 'LOW_PERFORMANCE',
        message: `Only ${highPerformers.length} high-performing videos found`,
        severity: 'medium'
      });
    }

    return issues;
  }

  private analyzeThreadContribution(searchResults: any[], expandedQueriesByThread?: any[]) {
    if (!expandedQueriesByThread || !searchResults.some(r => r.foundVia)) {
      return null; // No multi-thread data available
    }

    // Group results by thread
    const threadGroups = searchResults.reduce((acc, video) => {
      if (video.foundVia) {
        const thread = video.foundVia.thread;
        if (!acc[thread]) {
          acc[thread] = {
            videos: [],
            queries: new Set<string>(),
            purpose: video.foundVia.threadPurpose
          };
        }
        acc[thread].videos.push(video);
        acc[thread].queries.add(video.foundVia.query);
      }
      return acc;
    }, {} as Record<string, any>);

    // Analyze each thread's contribution
    const threadStats = Object.entries(threadGroups).map(([thread, data]) => {
      const videos = data.videos;
      const avgPerformance = videos.reduce((sum: number, v: any) => sum + (v.performanceRatio || 0), 0) / videos.length;
      const avgSimilarity = videos.reduce((sum: number, v: any) => sum + v.similarityScore, 0) / videos.length;
      
      return {
        thread,
        purpose: data.purpose,
        videoCount: videos.length,
        queryCount: data.queries.size,
        avgPerformance,
        avgSimilarity,
        superstarCount: videos.filter((v: any) => (v.performanceRatio || 0) >= 10).length,
        strongCount: videos.filter((v: any) => (v.performanceRatio || 0) >= 3 && (v.performanceRatio || 0) < 10).length
      };
    });

    // Calculate thread effectiveness
    const totalVideos = searchResults.length;
    const threadEffectiveness = threadStats.map(stats => ({
      ...stats,
      coverage: (stats.videoCount / totalVideos) * 100,
      qualityScore: stats.avgPerformance * stats.avgSimilarity
    }));

    return {
      threadCount: threadStats.length,
      threadStats: threadEffectiveness,
      bestPerformingThread: threadEffectiveness.sort((a, b) => b.qualityScore - a.qualityScore)[0]?.thread,
      mostProductiveThread: threadEffectiveness.sort((a, b) => b.videoCount - a.videoCount)[0]?.thread
    };
  }
}

export const searchLogger = new SearchLogger();