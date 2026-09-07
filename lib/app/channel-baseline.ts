// What "typical for this channel" means in the channel HEADER.
//
// It is the channel's normal NOW: C(30) from the newest scored long-form video — the same
// `video_scores.baseline` the video page anchors on, taken from the most recent video that
// has one.
//
// It used to be `percentile_cont(0.5) over EVERY video_scores.baseline for the channel`, in
// both `channel_stats.baseline` and the inline fallback, which is a LIFETIME median of per-video
// C(30) across the channel's whole history and can never be the current level. No refresh
// cadence could fix that; the definition was the bug. Measured on 2026-09-07: the median channel
// was fine (a flat channel's lifetime median IS its current level) but a THIRD of channels were
// off by more than 2x, symmetrically — Andrej Karpathy read 312,038 against a current 5,782,654
// (0.05x), Morley Kert 12,172 against 899,262 (0.01x), Myers Woodshop 8,486 against 43 (195x).
//
// "N beat 2x" is deliberately left alone: that is a count over the channel's history, and a
// history is the right thing to count over.
import { longformSql } from '../scoring/longform';

/** One candidate row: a scored video's C(30) and when the video went out. */
export type BaselineRow = { published_at: string | Date | null; baseline: number | string | null };

/**
 * The pure rule the SQL below implements: the baseline of the newest-published row that has
 * one. Null when no video on the channel has a baseline yet — which is a real answer ("we have
 * never been able to say what normal is here"), not a zero.
 */
export function currentBaseline(rows: readonly BaselineRow[]): number | null {
  let best: { at: number; baseline: number } | null = null;
  for (const r of rows) {
    const b = r.baseline == null ? NaN : Number(r.baseline);
    if (!(b > 0) || !Number.isFinite(b)) continue;
    const at = r.published_at == null ? NaN : new Date(r.published_at).getTime();
    if (!Number.isFinite(at)) continue;
    if (!best || at > best.at) best = { at, baseline: b };
  }
  return best ? best.baseline : null;
}

/**
 * The same rule as a scalar subquery, so `channel_stats.baseline` and the channel page's inline
 * fallback cannot drift apart. `channelExpr` is whatever SQL yields the channel id in the
 * caller's scope ($1, `c.channel_id`, …).
 *
 * Long-form only, matching the scorer: a Short's C(30) is not this channel's normal.
 */
export function currentBaselineSql(channelExpr: string): string {
  return `(select s.baseline
             from video_scores s
             join videos vb on vb.id = s.video_id
            where s.channel_id = ${channelExpr}
              and s.baseline is not null
              and ${longformSql('vb')}
            order by vb.published_at desc nulls last
            limit 1)`;
}
