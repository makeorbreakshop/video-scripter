// One-time gap backfill: for channels whose RSS feed was saturated today
// (>=10 new videos), walk the uploads playlist back until we reach videos we
// already have, then import the missing ones (metadata only).
// Usage: npx tsx scripts/run-gap-backfill.ts [minNewToday] [maxPagesPerChannel]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const minNewToday = parseInt(process.argv[2] || '10', 10);
const maxPages = parseInt(process.argv[3] || '12', 10); // 12 pages = 600 videos/channel cap
const API_KEY = process.env.YOUTUBE_API_KEY!;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let quotaUsed = 0;

// 1. Find saturated channels from today's RSS import
// Channel list is computed server-side (see scripts/run-gap-backfill.sh) and
// passed via a file to avoid PostgREST statement timeouts on the big table.
import fs from 'fs';
const channelsFile = process.env.BACKFILL_CHANNELS_FILE;
if (!channelsFile || !fs.existsSync(channelsFile)) {
  console.error('Set BACKFILL_CHANNELS_FILE to a file with one channel_id per line');
  process.exit(1);
}
const channels = fs.readFileSync(channelsFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
console.log(`Saturated channels (>=${minNewToday} new today): ${channels.length}`);

async function knownIds(ids: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('videos').select('id').in('id', ids.slice(i, i + 200));
    data?.forEach((r) => known.add(r.id));
  }
  return known;
}

const allMissing: string[] = [];
let done = 0;
for (const ch of channels) {
  const playlist = 'UU' + ch.slice(2); // uploads playlist derives from channel id
  let pageToken = '';
  const missing: string[] = [];
  for (let page = 0; page < maxPages; page++) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${playlist}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}&key=${API_KEY}`;
    const res = await fetch(url);
    quotaUsed++;
    if (!res.ok) { console.error(`  ${ch}: playlist fetch failed ${res.status}`); break; }
    const json: any = await res.json();
    const ids: string[] = (json.items || []).map((i: any) => i.contentDetails.videoId);
    if (ids.length === 0) break;
    const known = await knownIds(ids);
    const fresh = ids.filter((id) => !known.has(id));
    missing.push(...fresh);
    // stop when we've reached territory we already have (page mostly known)
    if (fresh.length === 0 || known.size >= ids.length - 2) break;
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  allMissing.push(...missing);
  done++;
  if (done % 25 === 0 || missing.length > 0)
    console.log(`[${done}/${channels.length}] ${ch}: ${missing.length} missing (quota ${quotaUsed})`);
}

console.log(`\nTotal missing videos to import: ${allMissing.length}; playlist quota used: ${quotaUsed}`);

if (allMissing.length > 0) {
  const { VideoImportService } = await import('../lib/unified-video-import');
  const service = new VideoImportService();
  for (let i = 0; i < allMissing.length; i += 500) {
    const batch = allMissing.slice(i, i + 500);
    console.log(`Importing batch ${i / 500 + 1}/${Math.ceil(allMissing.length / 500)} (${batch.length} videos)...`);
    const result = await service.processVideos({
      source: 'competitor',
      videoIds: batch,
      options: {
        skipEmbeddings: true,
        skipTitleEmbeddings: true,
        skipThumbnailEmbeddings: true,
        skipClassification: true,
        skipSummaries: true,
        skipExports: true,
        enrichChannels: false,
      },
    });
    console.log(`  -> ${result.videosProcessed} processed (success=${result.success})`);
  }
}
console.log('Backfill complete');
process.exit(0);
