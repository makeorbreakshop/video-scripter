// The proof that moving the chart's reads to R2 changed nothing about the chart.
//
// For a sample of real videos this builds the series file from Postgres, writes it to R2, then
// renders the video page TWICE — once with SERIES_DISABLE=1 (every read from Postgres, the
// control arm) and once without (every reading from the series file) — and requires the drawn
// line to be identical. Not close: identical. `series` is the whole line the chart draws,
// `actuals` are the measured points inside it, and `marks` / `packagingEvents` are the packaging
// version markers on its axis; a difference in any of them is a difference the reader would see.
//
// This is scripts/verify-archive.ts's idea applied to the serving path: deviation must be 0.
//
// Against the real database and the real bucket; skipped without either, so CI still passes.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// unstable_cache needs Next's incremental cache, which only exists inside a render. The page's
// memoisation is not what is under test here — the data is — so it is the identity function.
jest.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));

import { makeTimedPool } from '../admin/db';
import { buildSeriesFile } from './series';
import { SERIES_SQL, writeSeriesFile } from './series-store';
import { r2Config } from './archive';

const HAVE_DB = !!process.env.DATABASE_URL;
const HAVE_R2 = !!r2Config();
const d = HAVE_DB && HAVE_R2 ? describe : describe.skip;

jest.setTimeout(300_000);

/** Small on purpose: a handful of channels, a few dozen videos, all index-backed reads. */
const SAMPLE = Number(process.env.SERIES_EQUALITY_SAMPLE ?? 20);
/** A fixed clock, so the two renders cannot differ merely by having run a second apart. */
const NOW = Date.parse('2026-09-08T12:00:00.000Z');

d('the series file draws the same chart as Postgres', () => {
  const pool = makeTimedPool({ connectionString: process.env.DATABASE_URL, max: 2, timeoutMs: 60_000 });
  const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];
  afterAll(async () => { await pool.end(); });

  test(`chart output is byte-identical for ${SAMPLE} videos`, async () => {
    // Index-backed and bounded: one ranged walk of idx_videos_published_desc, grouped into a
    // few channels in JS. A `group by channel_id` over the same range is a 19k-row aggregate and
    // times out — this is a sample, not an analysis.
    const recent = await q<{ id: string; channel_id: string }>(
      `select id, channel_id from videos
        where published_at > now() - interval '45 days' and published_at < now() - interval '10 days'
        order by published_at desc limit 200`);
    expect(recent.length).toBeGreaterThan(0);
    const perChannel = new Map<string, string[]>();
    for (const r of recent) (perChannel.get(r.channel_id) ?? perChannel.set(r.channel_id, []).get(r.channel_id)!).push(r.id);
    const channels = [...perChannel.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3);
    const videos = channels.flatMap(([, vids]) => vids.slice(0, Math.ceil(SAMPLE / 3)))
      .slice(0, SAMPLE).map((id) => ({ id }));
    expect(videos.length).toBeGreaterThan(0);
    const ids = videos.map((v) => v.id);

    // Build and publish each video's series file from exactly what Postgres holds.
    const by = <T extends { video_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) (m.get(r.video_id) ?? m.set(r.video_id, []).get(r.video_id)!).push(r);
      return m;
    };
    let bytes = 0;
    const publish = async (batch: string[]) => {
      const [meta, snapshots, samples, rss, thumbs, titles] = [
        await q(SERIES_SQL.video, [batch]), await q(SERIES_SQL.snapshots, [batch]), await q(SERIES_SQL.samples, [batch]),
        await q(SERIES_SQL.rss, [batch]), await q(SERIES_SQL.thumbs, [batch]), await q(SERIES_SQL.titles, [batch]),
      ];
      const [bs, ba, br, bt, bl] = [by(snapshots), by(samples), by(rss), by(thumbs), by(titles)];
      const pub = new Map(meta.map((v: any) => [v.id, v.published_at]));
      for (const id of batch) {
        const file = buildSeriesFile({
          videoId: id, publishedAt: pub.get(id) ?? null,
          snapshots: bs.get(id) ?? [], samples: ba.get(id) ?? [], rss: br.get(id) ?? [],
          thumbs: bt.get(id) ?? [], titles: bl.get(id) ?? [],
        });
        bytes += (await writeSeriesFile(file)).bytes;
      }
    };
    await publish(ids);

    const { loadVideoPage } = await import('../app/video-page');
    const drawn = (p: any) => p && ({
      series: p.series, actuals: p.actuals, marks: p.marks,
      packagingEvents: p.packagingEvents, thumbs: p.thumbs, titles: p.titles,
      horizonDay: p.horizonDay, counts: p.counts,
    });

    let compared = 0, differing = 0, maxDeviation = 0;
    for (const id of ids) {
      process.env.SERIES_READ = '1';
      process.env.SERIES_DISABLE = '1';
      let fromPg = drawn(await loadVideoPage(id, NOW));
      delete process.env.SERIES_DISABLE;
      let fromR2 = drawn(await loadVideoPage(id, NOW));
      if (!fromPg && !fromR2) continue;
      compared++;
      // The poller is live: a reading or a thumbnail version can land between the file being
      // built and the page being rendered, and that shows up here as a difference the reader
      // would never see (the queue rebuilds the file within the minute). A rebuild-and-retry
      // separates that race from a real disagreement — a race resolves, a bug does not.
      if (JSON.stringify(fromPg) !== JSON.stringify(fromR2)) {
        await publish([id]);
        process.env.SERIES_DISABLE = '1';
        fromPg = drawn(await loadVideoPage(id, NOW));
        delete process.env.SERIES_DISABLE;
        fromR2 = drawn(await loadVideoPage(id, NOW));
      }
      const a = fromPg?.series ?? [], b = fromR2?.series ?? [];
      if (a.length !== b.length) { differing++; maxDeviation = Infinity; }
      else for (let i = 0; i < a.length; i++) {
        const denom = Math.abs(a[i].views) || 1;
        maxDeviation = Math.max(maxDeviation, Math.abs(a[i].views - b[i].views) / denom);
      }
      if (JSON.stringify(fromPg) !== JSON.stringify(fromR2)) differing++;
      expect(fromR2).toEqual(fromPg);
    }
    console.log(`series equality: ${compared} videos compared, ${differing} differing, max deviation ${(maxDeviation * 100).toFixed(4)}%, ${(bytes / compared / 1024).toFixed(1)} KB mean series file`);
    expect(compared).toBeGreaterThan(0);
    expect(differing).toBe(0);
    expect(maxDeviation).toBe(0);
  });
});
