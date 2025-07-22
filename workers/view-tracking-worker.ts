import { ViewTrackingService } from '../lib/view-tracking-service';
import cron from 'node-cron';

const viewTrackingService = new ViewTrackingService();

// Configuration
const MAX_API_CALLS = 2000; // 100,000 videos with batch API
const RUN_TIME = '0 3 * * *'; // 3 AM every day (after YouTube quota reset at midnight PT)

console.log('View Tracking Worker started');
console.log(`Scheduled to run daily at 3 AM PT (will track up to ${MAX_API_CALLS * 50} videos)`);

// Schedule daily execution
cron.schedule(RUN_TIME, async () => {
  console.log('Starting scheduled view tracking run...');
  
  try {
    // Log start time
    const startTime = new Date();
    console.log(`View tracking started at ${startTime.toISOString()}`);
    
    // Run the tracking
    await viewTrackingService.trackDailyViews(MAX_API_CALLS);
    
    // Log completion
    const endTime = new Date();
    const duration = (endTime.getTime() - startTime.getTime()) / 1000 / 60; // minutes
    console.log(`View tracking completed at ${endTime.toISOString()}`);
    console.log(`Total duration: ${duration.toFixed(2)} minutes`);
    
    // Get and log statistics
    const stats = await viewTrackingService.getTrackingStats();
    if (stats) {
      console.log('Tracking statistics:', stats);
    }
  } catch (error) {
    console.error('View tracking failed:', error);
    // Could add error notification here (Slack, email, etc.)
  }
});

// Also allow manual execution via command line argument
if (process.argv.includes('--run-now')) {
  console.log('Manual execution requested...');
  viewTrackingService.trackDailyViews(MAX_API_CALLS)
    .then(() => {
      console.log('Manual execution completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Manual execution failed:', error);
      process.exit(1);
    });
}

// Initialize priorities on first run (one-time setup)
if (process.argv.includes('--initialize')) {
  console.log('Initializing tracking priorities for all videos...');
  viewTrackingService.initializeTrackingPriorities()
    .then(() => {
      console.log('Initialization completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Initialization failed:', error);
      process.exit(1);
    });
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});