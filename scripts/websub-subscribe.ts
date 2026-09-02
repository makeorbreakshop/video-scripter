// Subscribe/renew WebSub push subscriptions for tracked channels.
// Leases last ~5-10 days; run every 3 days via LaunchAgent to renew.
// Usage: WEBSUB_CALLBACK=https://channelsmith-websub.onrender.com/websub \
//        npx tsx scripts/websub-subscribe.ts [maxChannels]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { chunk } from '../lib/nightly/tracking-core';

const CALLBACK = process.env.WEBSUB_CALLBACK;
const SECRET = process.env.WEBSUB_SECRET || '';
if (!CALLBACK) { console.error('Set WEBSUB_CALLBACK'); process.exit(1); }
const maxChannels = parseInt(process.argv[2] || '0', 10);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

// Priority: competitor lane first, then most recently active discovered channels
const { rows } = await pool.query(
  `select youtube_channel_id as id from competitor_youtube_channels where youtube_channel_id like 'UC%'
   union all
   select channel_id from discovered_channels
   where channel_id like 'UC%' and channel_id not in (select youtube_channel_id from competitor_youtube_channels)
   order by 1`
);
let channels = [...new Set(rows.map((r) => r.id))];
if (maxChannels > 0) channels = channels.slice(0, maxChannels);
console.log(`Subscribing ${channels.length} channels via ${CALLBACK}`);

// Paced: 10 concurrent + 300ms between batches. An unpaced 20-wide burst got
// ~10% of POSTs rejected by pubsubhubbub at 1,025 channels (measured
// 2026-09-01: 96 and 107 rejects on two runs; the paced shape went
// 1,025/1,025). Non-2xx responses are logged per channel for diagnosis.
let ok = 0;
let fail = 0;
const failures: string[] = [];
const groups = chunk(channels, 10);
for (let i = 0; i < groups.length; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 300));
  await Promise.all(
    groups[i].map(async (ch) => {
      const params = new URLSearchParams({
        'hub.mode': 'subscribe',
        'hub.topic': `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${ch}`,
        'hub.callback': CALLBACK,
        'hub.lease_seconds': '828000', // ~9.5 days
        'hub.verify': 'async',
      });
      if (SECRET) params.set('hub.secret', SECRET);
      try {
        const res = await fetch('https://pubsubhubbub.appspot.com/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: AbortSignal.timeout(15000),
        });
        if (res.status === 202 || res.status === 204) {
          ok++;
        } else {
          fail++;
          const body = (await res.text().catch(() => '')).slice(0, 120);
          failures.push(`${ch}: HTTP ${res.status} ${body}`);
        }
      } catch (e) {
        fail++;
        failures.push(`${ch}: ${e instanceof Error ? e.message : 'fetch error'}`);
      }
    })
  );
}
for (const f of failures) console.error(`REJECTED ${f}`);
console.log(`Done. ${ok} accepted, ${fail} failed.`);
await pool.end();
