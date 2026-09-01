// Nightly new-video ingest: check all tracked channels' RSS feeds and import
// new videos (metadata + snapshot only; no embeddings/classification/summaries).
// Usage: npx tsx scripts/run-daily-ingest.ts [maxChannels]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const maxChannels = parseInt(process.argv[2] || '0', 10); // 0 = all

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fetchAll(table: string, column: string): Promise<string[]> {
  const ids: string[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, 'is', null)
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    ids.push(...data.map((r: any) => r[column]));
    if (data.length < page) break;
  }
  return ids;
}

const competitor = await fetchAll('competitor_youtube_channels', 'youtube_channel_id');
const discovered = await fetchAll('discovered_channels', 'channel_id');
let channelIds = [...new Set([...competitor, ...discovered])];
console.log(`Channels: ${competitor.length} competitor + ${discovered.length} discovered = ${channelIds.length} unique`);
if (maxChannels > 0) {
  channelIds = channelIds.slice(0, maxChannels);
  console.log(`Limiting to first ${channelIds.length} channels`);
}

const rssFeedUrls = channelIds.map(
  (id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`
);

const { VideoImportService } = await import('../lib/unified-video-import');
const service = new VideoImportService();
const result = await service.processVideos({
  source: 'rss',
  rssFeedUrls,
  options: {
    skipEmbeddings: true,
    skipTitleEmbeddings: true,
    skipThumbnailEmbeddings: true,
    skipClassification: true,
    skipSummaries: true,
    skipExports: true,
  },
});

console.log('Ingest result:', JSON.stringify({
  success: result.success,
  message: result.message,
  videosProcessed: result.videosProcessed,
}, null, 2));
process.exit(result.success ? 0 : 1);
