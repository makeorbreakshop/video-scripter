// One-shot view tracking run, bypassing the jobs-table poller.
// Usage: npx tsx scripts/run-view-tracking-once.ts [maxApiCalls]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const maxApiCalls = parseInt(process.argv[2] || '2000', 10);

const { ViewTrackingService } = await import('../lib/view-tracking-service');
const service = new ViewTrackingService();
await service.trackDailyViews(maxApiCalls);
console.log('Run complete');
process.exit(0);
