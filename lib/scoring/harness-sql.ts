// The harnesses' readings queries, in one place, so the old-path/new-path diff can run the very
// same text the harness runs.
//
// These were inline in scripts/benchmark-scores.ts, scripts/backtest-baseline-trend.ts and
// scripts/check-band-calibration.ts. They are lifted here VERBATIM — not merged, not tidied.
// The three deliberately DISAGREE about what a reading is, and unifying them here would silently
// change three benchmarks at once:
//
//   benchmark.records      view_snapshots ∪ view_samples ∪ rss_samples, with the 12-hour
//                          paid-precedence rule and `model_eligible and not conflicted`
//   backtest.snapshots     view_snapshots ONLY
//   calibration.records    view_snapshots ∪ view_samples, no rss at all
//
// If those should be one definition, that is a scoring change with its own benchmark, not a
// refactor. Until then this file's job is to make the disagreement visible and stop it drifting.
//
// $1 is a video_id array everywhere except benchmarkPopulation, where it is a month count.

import { longformSql } from './longform';

export const HARNESS_QUERIES = {
  /** scripts/benchmark-scores.ts records() */
  benchmarkRecords: `with src as (
          select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views, 2 as rank, null::timestamptz as received_at
            from view_snapshots where video_id = any($1)
          union all
          select video_id, sampled_at, view_count, 1, null::timestamptz from view_samples where video_id = any($1)
          union all
          select video_id, at, views, 0, received_at from rss_samples where video_id = any($1) and views is not null and model_eligible and not conflicted
        ), paid as (select video_id, at from src where rank > 0)
        select x.video_id,
               extract(epoch from (x.at - v.published_at))/86400.0 as day,
               x.views, extract(epoch from greatest(x.at, x.received_at))*1000 as at_ms
          from src x join videos v on v.id = x.video_id
         where x.views > 0 and x.at >= v.published_at
           and (x.rank > 0 or not exists (
                 select 1 from paid p where p.video_id = x.video_id
                   and abs(extract(epoch from (p.at - x.at))) < 43200))
         order by x.video_id, x.at`,

  /** scripts/benchmark-scores.ts day30() */
  benchmarkDay30: `select distinct on (s.video_id) s.video_id, s.view_count, s.days_since_published as day,
              extract(epoch from (s.snapshot_date::timestamptz + interval '12 hours'))*1000 as at_ms
         from view_snapshots s
        where s.video_id = any($1) and s.days_since_published between 27 and 33 and s.view_count > 0
        order by s.video_id, abs(s.days_since_published - 30)`,

  /** scripts/benchmark-scores.ts population. $1 = months. */
  benchmarkPopulation: `select v.id, v.channel_id, extract(epoch from v.published_at)*1000 as pub
     from videos v
    where v.published_at > now() - ($1 || ' months')::interval
      and ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public'
      and exists (select 1 from view_snapshots s
                   where s.video_id = v.id and s.days_since_published between 27 and 33 and s.view_count > 0)
      -- and at least one reading inside the first 14 days: a video we only ever saw once, at
      -- day 30, cannot be replayed at any age and is not what the hourly scorer works on either.
      and exists (select 1 from view_snapshots s
                   where s.video_id = v.id and s.days_since_published <= 14 and s.view_count > 0)`,

  /** scripts/backtest-baseline-trend.ts snapsFor() */
  backtestSnapshots: `select video_id, days_since_published as day, view_count as views,
              extract(epoch from (snapshot_date::timestamptz + interval '12 hours'))*1000 as at
         from view_snapshots where video_id = any($1) and view_count > 0 order by video_id, snapshot_date`,

  /** scripts/check-band-calibration.ts observation record */
  calibrationRecords: `select x.video_id, extract(epoch from (x.at - v.published_at))/86400.0 as day, x.views
         from (select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views
                 from view_snapshots where video_id = any($1)
               union all
               select video_id, sampled_at, view_count from view_samples where video_id = any($1)) x
         join videos v on v.id = x.video_id
        where x.views > 0 and x.at >= v.published_at`,

  /** scripts/check-band-calibration.ts day-30 truth */
  calibrationDay30: `select distinct on (video_id) video_id, view_count as v30 from view_snapshots
        where video_id = any($1) and days_since_published between 27 and 33 and view_count > 0
        order by video_id, abs(days_since_published - 30)`,

  /** scripts/check-band-calibration.ts per-video metadata */
  calibrationMeta: `select v.id, v.channel_id, sc.baseline::float8 as baseline from videos v
        left join video_scores sc on sc.video_id = v.id where v.id = any($1)`,
} as const;
