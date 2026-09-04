// Append-only score history. See sql/score-history.sql for why it exists.
//
// Every path that writes `video_scores` also appends here, in the same batch, so the current
// answer and the record of how it was reached can never drift apart. Pure SQL construction; the
// caller owns the pool.

/** The 18 written columns, in insert order. `id` is generated, `scored_at` defaults to now(). */
export const HISTORY_COLUMNS = [
  'video_id', 'channel_id', 'model_version', 'age_days', 'views', 'score', 'same_age_ratio',
  'typical_at_age', 'n_typical', 'typical_measured_share', 'projection', 'projection_horizon',
  'est30', 'baseline', 'n_baseline', 'confidence', 'extra',
] as const;

export interface HistoryRow {
  video_id: string;
  channel_id?: string | null;
  model_version: string;
  age_days?: number | null;
  views?: number | null;
  score?: number | null;
  same_age_ratio?: number | null;
  typical_at_age?: number | null;
  n_typical?: number | null;
  typical_measured_share?: number | null;
  projection?: number | null;
  projection_horizon?: number | null;
  est30?: number | null;
  baseline?: number | null;
  n_baseline?: number | null;
  confidence?: string | null;
  /** Serialised to the jsonb `extra` column. Undefined/empty writes SQL null, not '{}'. */
  extra?: Record<string, unknown> | null;
}

export interface HistoryInsert { text: string; values: unknown[] }

/**
 * One multi-row INSERT for a batch of history rows. Returns null for an empty batch so callers
 * can `if (!ins) return;` rather than sending a syntactically invalid statement.
 */
export function historyInsert(rows: readonly HistoryRow[]): HistoryInsert | null {
  if (!rows.length) return null;
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const r of rows) {
    const start = values.length;
    for (const c of HISTORY_COLUMNS) {
      if (c === 'extra') {
        const e = r.extra;
        values.push(e && Object.keys(e).length ? JSON.stringify(e) : null);
      } else {
        values.push((r as any)[c] ?? null);
      }
    }
    tuples.push(`(${HISTORY_COLUMNS.map((_, i) => `$${start + i + 1}`).join(',')})`);
  }
  return {
    text: `insert into video_score_history (${HISTORY_COLUMNS.join(', ')}) values ${tuples.join(',')}`,
    values,
  };
}
