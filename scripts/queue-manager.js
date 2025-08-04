#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class QueueManager {
  async addJob(videoId, source, priority = 1, metadata = {}) {
    try {
      const { data, error } = await supabase
        .from('video_processing_jobs')
        .insert({
          video_id: videoId,
          source: source,
          priority: priority,
          metadata: metadata
        })
        .select();

      if (error) throw error;
      
      console.log(`✅ Added job: ${videoId} (${source}) - ID: ${data[0].id.slice(0, 8)}`);
      return data[0];
    } catch (error) {
      console.error('❌ Error adding job:', error);
      return null;
    }
  }

  async getStats() {
    try {
      const { data, error } = await supabase.rpc('get_queue_stats');
      if (error) throw error;
      
      const stats = data[0];
      console.log('📊 Queue Statistics:');
      console.log(`   Pending: ${stats.pending_jobs}`);
      console.log(`   Processing: ${stats.processing_jobs}`);
      console.log(`   Completed: ${stats.completed_jobs}`);
      console.log(`   Failed: ${stats.failed_jobs}`);
      console.log(`   Total: ${stats.total_jobs}`);
      
      return stats;
    } catch (error) {
      console.error('❌ Error getting stats:', error);
      return null;
    }
  }

  async getRecentJobs(limit = 10) {
    try {
      const { data, error } = await supabase
        .from('video_processing_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      
      console.log(`📋 Recent ${limit} jobs:`);
      data.forEach(job => {
        const duration = job.completed_at 
          ? Math.round((new Date(job.completed_at) - new Date(job.started_at || job.created_at)) / 1000)
          : null;
        
        console.log(`   ${job.id.slice(0, 8)} | ${job.status.padEnd(10)} | ${job.source.padEnd(12)} | ${job.video_id} ${duration ? `(${duration}s)` : ''}`);
      });
      
      return data;
    } catch (error) {
      console.error('❌ Error getting recent jobs:', error);
      return null;
    }
  }

  async clearCompleted() {
    try {
      const { data, error } = await supabase
        .from('video_processing_jobs')
        .delete()
        .eq('status', 'completed')
        .select();

      if (error) throw error;
      
      console.log(`🗑️  Cleared ${data.length} completed jobs`);
      return data.length;
    } catch (error) {
      console.error('❌ Error clearing completed jobs:', error);
      return 0;
    }
  }

  async retryFailed() {
    try {
      const { data, error } = await supabase
        .from('video_processing_jobs')
        .update({ 
          status: 'pending', 
          retry_count: 0, 
          error_message: null,
          worker_id: null,
          started_at: null,
          completed_at: null
        })
        .eq('status', 'failed')
        .select();

      if (error) throw error;
      
      console.log(`🔄 Reset ${data.length} failed jobs to pending`);
      return data.length;
    } catch (error) {
      console.error('❌ Error retrying failed jobs:', error);
      return 0;
    }
  }
}

// CLI interface
async function main() {
  const manager = new QueueManager();
  const command = process.argv[2];
  
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables');
    process.exit(1);
  }

  switch (command) {
    case 'stats':
      await manager.getStats();
      break;
      
    case 'jobs':
      const limit = parseInt(process.argv[3]) || 10;
      await manager.getRecentJobs(limit);
      break;
      
    case 'add':
      const videoId = process.argv[3];
      const source = process.argv[4] || 'manual';
      const priority = parseInt(process.argv[5]) || 1;
      
      if (!videoId) {
        console.error('❌ Usage: node queue-manager.js add <videoId> [source] [priority]');
        process.exit(1);
      }
      
      await manager.addJob(videoId, source, priority);
      break;
      
    case 'clear':
      await manager.clearCompleted();
      break;
      
    case 'retry':
      await manager.retryFailed();
      break;
      
    default:
      console.log('📋 Queue Manager Commands:');
      console.log('   stats                           - Show queue statistics');
      console.log('   jobs [limit]                    - Show recent jobs (default: 10)');
      console.log('   add <videoId> [source] [priority] - Add job to queue');
      console.log('   clear                           - Clear completed jobs');
      console.log('   retry                           - Retry failed jobs');
      console.log('');
      console.log('Examples:');
      console.log('   node queue-manager.js stats');
      console.log('   node queue-manager.js add dQw4w9WgXcQ competitor 5');
      console.log('   node queue-manager.js jobs 20');
      break;
  }
}

main().catch(error => {
  console.error('❌ Queue manager error:', error);
  process.exit(1);
});