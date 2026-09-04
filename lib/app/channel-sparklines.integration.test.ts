// The read that took /app/channels down for a 500-channel account.
//
// It was a LATERAL per channel taking the 60 most recent videos and probing video_scores
// 15,488 times by primary key: 88,254 buffer accesses, 6.6 s warm and 26.6 s cold. The
// server render outran the function ceiling, the RSC stream never finished, and the skeleton
// never resolved. A date range instead of a per-channel LIMIT makes it one ranged walk of
// idx_videos_channel_published_longform, so what is read tracks how much the list published
// rather than how many channels are in it.
//
// Nothing pinned that. These do, and they fail on the shape that caused the incident.
// Against the real database; skipped without DATABASE_URL so CI without one still passes.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const HAVE_DB = !!(process.env.DATABASE_URL || process.env.DATABASE_POOLER_URL);
const d = HAVE_DB ? describe : describe.skip;

/** The account the bug was reported on. */
const HEAVY_USER = '60945b47-6237-4575-b2fb-93d2a894585b';
/** A page render's budget. The old read spent 6.6 s warm here, and 26.6 s cold. */
const BUDGET_MS = 2_000;
/**
 * Buffer accesses are what become cold storage reads, and cold storage is what turned a
 * 6.6 s query into a 26.6 s one. The old shape touched 88,254 for these same channels; the
 * ranged walk touches ~17,000. A stopwatch measures the network to us-east-1 as much as the
 * query — this measures the query.
 */
const BUFFER_BUDGET = 40_000;

jest.setTimeout(120_000);

d('the sparkline lane, on a 500-channel account', () => {
  it(`draws every tracked channel in under ${BUDGET_MS}ms`, async () => {
    const { listUserChannels } = await import('./channels');
    const { channelSparklines } = await import('./channel-sparklines');

    const rows = await listUserChannels(HEAVY_USER);
    // An emptied fixture account would make the timing meaningless; say so instead.
    expect(rows.length).toBeGreaterThan(100);
    const ids = rows.map((r) => r.channel_id);

    // A serving process has a live pool and a warm cache; a fresh jest run has neither, and
    // paying for both here measures this laptop. The broken shape was 6.6 s warm — three
    // budgets — so warming hides no regression.
    await channelSparklines(ids);

    const t0 = Date.now();
    const sparks = await channelSparklines(ids);
    const ms = Date.now() - t0;

    expect(Object.keys(sparks)).toHaveLength(ids.length);
    // eslint-disable-next-line no-console
    console.log(`channelSparklines: ${ids.length} channels in ${ms}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('gives every channel an entry, and every drawn line at most 24 points', async () => {
    const { listUserChannels } = await import('./channels');
    const { channelSparklines } = await import('./channel-sparklines');
    const { SPARK_MAX_POINTS } = await import('./groups-view');
    const ids = (await listUserChannels(HEAVY_USER)).map((r) => r.channel_id);
    const sparks = await channelSparklines(ids);
    for (const id of ids) {
      expect(sparks[id]).toBeDefined();
      expect(sparks[id].points.length).toBeLessThanOrEqual(SPARK_MAX_POINTS);
    }
  });

  it(`reads under ${BUFFER_BUDGET} buffers for the whole list`, async () => {
    const { q } = await import('../admin/db');
    const { listUserChannels } = await import('./channels');
    const { longformSql } = await import('../scoring/longform');
    const ids = (await listUserChannels(HEAVY_USER)).map((r) => r.channel_id);

    const plan = await q<{ 'QUERY PLAN': string }>(
      `explain (analyze, buffers)
       select v.channel_id, v.published_at as t, s.baseline
         from videos v
         join video_scores s on s.video_id = v.id
        where v.channel_id = any($1::text[])
          and v.published_at >= now() - ($2 || ' days')::interval
          and ${longformSql('v')}
          and s.baseline is not null and s.baseline > 0`,
      [ids, '730']
    );
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    const total = [...(text.match(/Buffers: shared (.*)/)?.[1] ?? '')
      .matchAll(/(?:hit|read|dirtied)=(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    // eslint-disable-next-line no-console
    console.log(`sparkline read: ${total} buffers for ${ids.length} channels`);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(BUFFER_BUDGET);
  });
});
