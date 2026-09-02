// Pull owner-only YouTube Analytics (per-video per-day views, average view duration,
// subscribers gained, ...) for every connected channel into daily_analytics.
// One Analytics API call per batch of videos, sized so videos x days stays under the API's
// 10,000-row report cap (paging past it 500s). No Data API quota.
//
//   npx tsx scripts/owned-analytics-sync.ts            # last 45 days, all connections
//   npx tsx scripts/owned-analytics-sync.ts --days 400 # backfill
//   npx tsx scripts/owned-analytics-sync.ts --dry
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' }); dotenv.config({ path: '.env' });

const { q, getPool } = await import('../lib/admin/db');
const { allConnections, accessTokenFromRefresh, fetchDaily, saveDaily, markSynced, videosPerCall } = await import('../lib/app/youtube-connect');

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const days = parseInt(arg('days') || '45', 10);
const dry = process.argv.includes('--dry');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);      // Analytics lags ~2 days; yesterday is the newest that may exist
const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);

let total = 0;
for (const c of await allConnections()) {
  const label = `${c.channel_title || c.channel_id}`;
  try {
    const token = await accessTokenFromRefresh(c.refresh_token);
    // Videos that were live at any point in the window.
    const vids = await q<{ id: string }>(
      `select id from videos where channel_id = $1 and published_at <= $2::date + 1 order by published_at desc`,
      [c.channel_id, iso(end)]
    );
    // Only videos that can still have rows in the window: published before the window ends.
    let written = 0;
    const per = videosPerCall(days);
    for (let i = 0; i < vids.length; i += per) {
      const ids = vids.slice(i, i + per).map((v) => v.id);
      const rows = await fetchDaily(token, ids, iso(start), iso(end)).catch(async (e) => {
        if (!/analytics 5\d\d/.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 2000));
        return fetchDaily(token, ids, iso(start), iso(end));
      });
      if (!dry) written += await saveDaily(rows); else written += rows.length;
    }
    total += written;
    if (!dry) await markSynced(c.user_id, c.channel_id, null);
    console.log(`${label}: ${vids.length} videos, ${written} day-rows ${dry ? '(dry)' : 'upserted'} for ${iso(start)}..${iso(end)}`);
  } catch (e: any) {
    console.error(`${label}: ${e.message}`);
    if (!dry) await markSynced(c.user_id, c.channel_id, e.message.slice(0, 300));
  }
}
console.log(`done: ${total} rows`);
await getPool().end();
