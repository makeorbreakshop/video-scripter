/**
 * Pattern Discovery Worker
 * Background job to discover patterns from video performance data
 */

import { PatternDiscoveryService } from '../lib/pattern-discovery-service.ts';
import { supabase } from '../lib/supabase.ts';

class PatternDiscoveryWorker {
  constructor() {
    this.discoveryService = new PatternDiscoveryService();
    this.isRunning = false;
    this.discoveryInterval = 24 * 60 * 60 * 1000; // 24 hours
  }

  async start() {
    console.log('🔍 Pattern Discovery Worker starting...');
    this.isRunning = true;
    
    // Run initial discovery
    await this.runDiscovery();
    
    // Schedule periodic discovery
    this.scheduleDiscovery();
    
    console.log('✅ Pattern Discovery Worker started');
  }

  async stop() {
    console.log('⏹️ Pattern Discovery Worker stopping...');
    this.isRunning = false;
    
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
    
    console.log('✅ Pattern Discovery Worker stopped');
  }

  scheduleDiscovery() {
    this.discoveryTimer = setInterval(async () => {
      if (this.isRunning) {
        await this.runDiscovery();
      }
    }, this.discoveryInterval);
  }

  async runDiscovery() {
    console.log('🔍 Starting pattern discovery run...');
    
    try {
      // Get all topic clusters to analyze
      const topicClusters = await this.getTopicClusters();
      console.log(`📊 Found ${topicClusters.length} topic clusters to analyze`);

      let totalPatternsDiscovered = 0;
      
      // Discover patterns for each cluster
      for (const cluster of topicClusters) {
        console.log(`🔬 Analyzing cluster: ${cluster.name}`);
        
        const context = {
          topic_cluster_id: cluster.id,
          min_performance: 2.0,
          min_confidence: 0.8,
          min_videos: 30
        };

        try {
          const patterns = await this.discoveryService.discoverPatternsInCluster(context);
          
          if (patterns.length > 0) {
            await this.discoveryService.storePatterns(patterns);
            totalPatternsDiscovered += patterns.length;
            console.log(`✅ Discovered ${patterns.length} patterns for cluster: ${cluster.name}`);
          } else {
            console.log(`⚠️ No patterns found for cluster: ${cluster.name}`);
          }
          
        } catch (error) {
          console.error(`❌ Error analyzing cluster ${cluster.name}:`, error);
        }
      }

      // Also run discovery without cluster constraints for general patterns
      console.log('🔬 Analyzing general patterns...');
      const generalContext = {
        min_performance: 2.5,
        min_confidence: 0.8,
        min_videos: 50
      };

      try {
        const generalPatterns = await this.discoveryService.discoverPatternsInCluster(generalContext);
        
        if (generalPatterns.length > 0) {
          await this.discoveryService.storePatterns(generalPatterns);
          totalPatternsDiscovered += generalPatterns.length;
          console.log(`✅ Discovered ${generalPatterns.length} general patterns`);
        }
      } catch (error) {
        console.error('❌ Error analyzing general patterns:', error);
      }

      console.log(`🎉 Pattern discovery run complete! Total patterns discovered: ${totalPatternsDiscovered}`);
      
      // Update discovery statistics
      await this.updateDiscoveryStats(totalPatternsDiscovered);
      
    } catch (error) {
      console.error('❌ Error in pattern discovery run:', error);
    }
  }

  async getTopicClusters() {
    try {
      // Get unique topic clusters from videos
      const { data: clusters, error } = await supabase
        .from('videos')
        .select('topic_cluster_id')
        .not('topic_cluster_id', 'is', null)
        .group('topic_cluster_id');

      if (error) {
        console.error('Error fetching topic clusters:', error);
        return [];
      }

      // Get cluster stats
      const clustersWithStats = await Promise.all(
        (clusters || []).map(async (cluster) => {
          const { data: videos, error: videoError } = await supabase
            .from('videos')
            .select('id, view_count, rolling_baseline_views')
            .eq('topic_cluster_id', cluster.topic_cluster_id)
            .not('rolling_baseline_views', 'is', null);

          if (videoError) {
            console.error(`Error fetching videos for cluster ${cluster.topic_cluster_id}:`, videoError);
            return { name: cluster.topic_cluster_id, id: cluster.topic_cluster_id, video_count: 0, avg_performance: 0 };
          }

          const videoCount = videos?.length || 0;
          const avgPerformance = videos?.reduce((sum, video) => {
            const baseline = video.rolling_baseline_views || 1;
            return sum + (video.view_count / baseline);
          }, 0) / videoCount || 0;

          return {
            name: cluster.topic_cluster_id,
            id: cluster.topic_cluster_id,
            video_count: videoCount,
            avg_performance: avgPerformance
          };
        })
      );

      // Filter clusters with enough videos
      return clustersWithStats.filter(cluster => cluster.video_count >= 30);
      
    } catch (error) {
      console.error('Error getting topic clusters:', error);
      return [];
    }
  }

  async updateDiscoveryStats(patternsDiscovered) {
    try {
      const stats = {
        last_run: new Date().toISOString(),
        patterns_discovered: patternsDiscovered,
        status: 'completed'
      };

      // You could store this in a dedicated stats table
      console.log('📊 Discovery stats:', stats);
      
    } catch (error) {
      console.error('Error updating discovery stats:', error);
    }
  }

  async getDiscoveryStatus() {
    try {
      // Get pattern counts by type
      const { data: patternCounts, error } = await supabase
        .from('patterns')
        .select('pattern_type')
        .then(({ data, error }) => {
          if (error) return { data: [], error };
          
          const counts = {};
          data?.forEach(pattern => {
            counts[pattern.pattern_type] = (counts[pattern.pattern_type] || 0) + 1;
          });
          
          return { data: counts, error: null };
        });

      if (error) {
        console.error('Error getting pattern counts:', error);
        return { total_patterns: 0, pattern_types: {} };
      }

      const totalPatterns = Object.values(patternCounts.data || {}).reduce((sum, count) => sum + count, 0);

      return {
        total_patterns: totalPatterns,
        pattern_types: patternCounts.data || {},
        last_run: new Date().toISOString(),
        status: this.isRunning ? 'running' : 'stopped'
      };

    } catch (error) {
      console.error('Error getting discovery status:', error);
      return { total_patterns: 0, pattern_types: {}, status: 'error' };
    }
  }
}

// Export for use in other modules
export { PatternDiscoveryWorker };

// If running directly, start the worker
if (import.meta.url === `file://${process.argv[1]}`) {
  const worker = new PatternDiscoveryWorker();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await worker.stop();
    process.exit(0);
  });

  // Start the worker
  worker.start().catch(error => {
    console.error('Failed to start pattern discovery worker:', error);
    process.exit(1);
  });
}