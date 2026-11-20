// The score-fit long-tail table, computed from the nightly export's local mirrors instead of
// production (2026-11-20).
//
// The Postgres form (scripts/score-videos.ts fitLongtailTableDb) walks idx_view_snapshots_days_since
// for ~390 K day-27..33 rows — correlation -0.27, so one random heap read each across a 614 MB
// heap — then probes view_snapshots again per video for every later reading. On an IO-saturated
// Small instance it hit the 300 s statement_timeout (57014) on most nights.
//
// scripts/export-tables.ts already keeps a complete, fingerprint-synced SQLite copy of
// view_snapshots and videos (~/.cache/video-scripter/table-exports/<table>-<digest>.sqlite) and
// runs before the fit. The same question over those files takes ~40 s of local CPU and reads
// nothing from Supabase. Measured 2026-11-20 against the 11-16 mirrors: 564,620 observations vs
// the 566,313 the 11-16 fit read from production (the videos mirror was four days newer).
//
// No silent fallback: a mirror that is missing, ambiguous, of another database, or not refreshed
// within maxAgeMs throws. `score-videos.ts --fit --longtail-source db` is the explicit escape hatch.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { LongtailRow } from './core';
import type { TailPair } from './growth';

export const EXPORT_MIRROR_DIR = path.join(os.homedir(), '.cache', 'video-scripter', 'table-exports');
/** The metadata key export-tables stamps after a complete incremental sync. */
export const SYNCED_AT = 'synced-at';

export function findExportMirror(dir: string, table: string): string {
  const pattern = new RegExp(`^${table}-[0-9a-f]+\\.sqlite$`);
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => pattern.test(f)) : [];
  if (found.length === 0) throw new Error(`no export mirror for ${table} in ${dir}; run scripts/export-tables.ts`);
  if (found.length > 1) throw new Error(`${found.length} export mirrors for ${table} in ${dir}; remove the stale one`);
  return path.join(dir, found[0]);
}

function checkMirror(db: DatabaseSync, schema: string, file: string, opts: { now: number; maxAgeMs: number; host: string }) {
  const meta = (key: string) =>
    (db.prepare(`SELECT value FROM ${schema}.metadata WHERE key=?`).get(key) as { value: string } | undefined)?.value;
  const identity = JSON.parse(meta('identity') ?? '{}') as { host?: string };
  if (identity.host !== opts.host) throw new Error(`${file} mirrors database ${identity.host}, not ${opts.host}`);
  const synced = meta(SYNCED_AT);
  if (!synced) throw new Error(`${file} has no ${SYNCED_AT} stamp; run scripts/export-tables.ts`);
  const age = opts.now - Date.parse(synced);
  if (!(age <= opts.maxAgeMs)) throw new Error(`${file} is stale: synced ${synced}`);
}

export interface MirrorFitOptions { now: number; maxAgeMs: number; host: string; pastMonths?: number[] }

/** Both view_snapshots-heavy fit inputs in one pass over the mirrors. */
export function fitInputsFromMirrors(
  snapshotsFile: string, videosFile: string, opts: MirrorFitOptions,
): { longtail: LongtailRow[]; past30: Record<number, TailPair[]> } {
  const db = new DatabaseSync(snapshotsFile, { readOnly: true });
  try {
    db.prepare('ATTACH DATABASE ? AS vm').run(videosFile);
    checkMirror(db, 'main', snapshotsFile, opts);
    checkMirror(db, 'vm', videosFile, opts);
    db.exec(`
      CREATE TEMP TABLE s AS
        SELECT json_extract(body,'$.video_id') AS vid, json_extract(body,'$.view_count') AS vc,
               json_extract(body,'$.days_since_published') AS d, json_extract(body,'$.snapshot_date') AS day
          FROM main.rows
         WHERE json_extract(body,'$.view_count') > 0
           AND (json_extract(body,'$.days_since_published') BETWEEN 27 AND 33
                OR json_extract(body,'$.days_since_published') >= 60);
      CREATE INDEX temp.s_vid ON s(vid, d);
      CREATE TEMP TABLE v AS
        SELECT json_extract(body,'$.id') AS id, json_extract(body,'$.view_count') AS vc,
               json_extract(body,'$.published_at') AS pub
          FROM vm.rows WHERE json_extract(body,'$.is_longform') = 1;
      CREATE UNIQUE INDEX temp.v_id ON v(id);
      -- The day-27..33 reading closest to day 30 per video (earlier day on a tie).
      CREATE TEMP TABLE c AS
        SELECT vid, vc, d, day, row_number() OVER (PARTITION BY vid ORDER BY abs(d - 30), d) AS rn
          FROM s WHERE d BETWEEN 27 AND 33;
      CREATE TEMP TABLE base AS SELECT vid, vc AS v30 FROM c WHERE rn = 1;
      CREATE UNIQUE INDEX temp.base_vid ON base(vid);`);
    const nowJd = opts.now / 86_400_000 + 2440587.5;
    // Long-tail: (a) lifetime count at current age, (b) every stored reading at day >= 60.
    const longtail = (db.prepare(`
      SELECT b.v30 AS v30, v.vc AS later, ? - julianday(v.pub) AS age
        FROM base b JOIN v ON v.id = b.vid
       WHERE v.vc > 0 AND julianday(v.pub) < ? - 60
      UNION ALL
      SELECT b.v30, l.vc, l.d
        FROM base b JOIN s l ON l.vid = b.vid AND l.d >= 60
        JOIN v ON v.id = b.vid`).all(nowJd, nowJd) as { v30: number; later: number; age: number }[])
      .map((r) => ({ age: Number(r.age), v30: Number(r.v30), lifetime: Number(r.later) }));
    // Past-30: the base is chosen AFTER the window filter, as in the Postgres query.
    const past30: Record<number, TailPair[]> = {};
    const pairs = db.prepare(`
      WITH w AS (
        SELECT s.vid, s.vc, row_number() OVER (PARTITION BY s.vid ORDER BY abs(s.d - 30), s.d) AS rn
          FROM s JOIN v ON v.id = s.vid
         WHERE s.d BETWEEN 27 AND 33 AND s.day > date(?, 'unixepoch', '-' || ? || ' months'))
      SELECT w.vc AS v30, l.vc AS later, l.d AS later_age
        FROM w JOIN s l ON l.vid = w.vid AND l.d >= 60
       WHERE w.rn = 1`);
    for (const months of opts.pastMonths ?? []) {
      past30[months] = (pairs.all(Math.floor(opts.now / 1000), months) as { v30: number; later: number; later_age: number }[])
        .map((r) => ({ laterAge: Number(r.later_age), v30: Number(r.v30), later: Number(r.later) }));
    }
    return { longtail, past30 };
  } finally { db.close(); }
}

export function longtailRowsFromMirrors(snapshotsFile: string, videosFile: string, opts: MirrorFitOptions): LongtailRow[] {
  return fitInputsFromMirrors(snapshotsFile, videosFile, { ...opts, pastMonths: [] }).longtail;
}
