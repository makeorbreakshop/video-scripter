import { longformSql } from './longform';
import { scoreRefreshSql } from './refresh-sql';
import { OBSERVATION_SCORE_VERSION } from './observations';

interface Cursor { publishedAt: string; id: string }
interface Options { all: boolean; channels: string[]; limit: number; cursor: Cursor | null; version?: string }

export function incrementalScoreTargetsSql(options: Options): { text: string; values: unknown[] } {
  if (!(options.limit > 0) || options.limit > 100) throw new Error('score target page limit must be 1..100');
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const channel = options.channels.length ? `and v.channel_id = any(${bind(options.channels)})` : '';
  const cursor = options.cursor
    ? `and (v.published_at, v.id) < (${bind(options.cursor.publishedAt)}::timestamptz, ${bind(options.cursor.id)}::text)`
    : '';
  const ceiling = options.all ? '' : `and v.published_at > now() - interval '60 days'`;
  const limit = bind(options.limit);
  return {
    text: `select v.id, v.channel_id, v.published_at::text as published_at
      from videos v left join video_scores sc on sc.video_id = v.id
     where ${longformSql('v')} and coalesce(v.privacy_status,'public') = 'public'
       and v.published_at is not null ${ceiling} ${channel} ${cursor}
       and ${scoreRefreshSql(options.version ?? OBSERVATION_SCORE_VERSION)}
     order by v.published_at desc, v.id desc limit ${limit}`,
    values,
  };
}

export interface ScoreTargetCursorRow { id: string; channel_id: string; published_at: string }
interface WalkOptions<T extends ScoreTargetCursorRow> {
  limit: number;
  signal: AbortSignal;
  fetchPage: (cursor: Cursor | null, limit: number) => Promise<T[]>;
  onPage: (page: T[]) => Promise<void>;
}

export async function walkIncrementalScoreTargets<T extends ScoreTargetCursorRow>(options: WalkOptions<T>): Promise<number> {
  let cursor: Cursor | null = null;
  let selected = 0;
  // IDs only (roughly 2 MB at the cap), not observations. A wide enough window lets
  // interleaved uploads share channel priors; database pages and score transactions stay 100.
  let lookahead: T[] = [];
  while (!options.signal.aborted && selected < options.limit) {
    const pageSize = Math.min(100, options.limit - selected);
    const page = await options.fetchPage(cursor, pageSize);
    if (!page.length) {
      if (lookahead.length) await options.onPage(lookahead);
      break;
    }
    selected += page.length;
    const last = page[page.length - 1];
    cursor = { publishedAt: last.published_at, id: last.id };
    lookahead.push(...page);
    const exhausted = page.length < pageSize || selected === options.limit;
    if (lookahead.length >= 10_000 || exhausted) {
      await options.onPage(lookahead);
      lookahead = [];
    }
    if (exhausted) break;
  }
  return selected;
}
