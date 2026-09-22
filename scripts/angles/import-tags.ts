// Load the one-off MVP tagging run (scratchpad tags.jsonl) into video_angles, and record the
// run it came from in angle_tag_runs so the cost of the corpus is on the record rather than in
// a log file. Idempotent: insert ... on conflict do nothing, and one run row per --notes key.
//
//   npx tsx scripts/angles/import-tags.ts [--file <tags.jsonl>] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env.local') });

import { q, getPool } from '../../lib/admin/db';

const MVP_DIR = '/private/tmp/claude-501/-Users-brandoncullum-video-scripter-v2/7b27fa5a-72b2-4468-a71d-ced0705afddc/scratchpad/angles-mvp';
const RUN_KEY = 'angles-mvp 2026-09-16';
const MODEL = 'claude-haiku-4-5';
const TAXONOMY_VERSION = 1;

// The MVP ran in two passes (tag.log's 275-request main run, then a 3-request top-up). These
// are their sums; tag-cost.json only ever holds the last pass.
const RUN_COST = {
  requests: 278,
  input_tokens: 1_961_342 + 19_694,
  output_tokens: 310_370 + 2_664,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  usd: 3.5462,
};

interface TagRow {
  video_id: string;
  angles?: string[];
  thumbnail_angles?: string[];
  variation?: string;
  confidence?: number;
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const file = arg('--file') ?? path.join(MVP_DIR, 'tags.jsonl');
  const dryRun = process.argv.includes('--dry-run');

  const known = new Map<string, string>(
    (await q<{ id: string; kind: string }>(`select id, kind from angles where active`)).map((a) => [a.id, a.kind])
  );
  if (known.size === 0) throw new Error('angles table is empty — run seed-taxonomy.ts first');

  // Last line wins: the file was appended to across two passes and carries one duplicate.
  const byVideo = new Map<string, TagRow>();
  let malformed = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as TagRow;
      if (row.video_id) byVideo.set(row.video_id, row);
    } catch { malformed += 1; }
  }

  const pairs: Array<[string, string, string, number | null, string | null]> = [];
  let dropped = 0;
  for (const row of byVideo.values()) {
    const seen = new Set<string>();
    for (const [ids, kind] of [[row.angles ?? [], 'title'], [row.thumbnail_angles ?? [], 'thumbnail']] as const) {
      for (const id of ids) {
        if (known.get(id) !== kind) { dropped += 1; continue; }
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push([row.video_id, id, kind, row.confidence ?? null, row.variation ?? null]);
      }
    }
  }

  console.log(`videos ${byVideo.size} · rows ${pairs.length} · dropped ids ${dropped} · malformed lines ${malformed}`);
  if (dryRun) { await getPool().end(); return; }

  // One multi-row insert per chunk: 2,000 pairs is ~10k bound parameters, comfortably under
  // Postgres's 65,535 limit and far cheaper than a statement per row.
  const CHUNK = 2_000;
  let inserted = 0;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const slice = pairs.slice(i, i + CHUNK);
    const values = slice
      .map((_, n) => `($${n * 5 + 1}, $${n * 5 + 2}, $${n * 5 + 3}, $${n * 5 + 4}, $${n * 5 + 5}, $${slice.length * 5 + 1}, $${slice.length * 5 + 2})`)
      .join(', ');
    const rows = await q<{ video_id: string }>(
      `insert into video_angles (video_id, angle_id, kind, confidence, variation, model, taxonomy_version)
       values ${values}
       on conflict (video_id, angle_id, taxonomy_version) do nothing
       returning video_id`,
      [...slice.flat(), MODEL, TAXONOMY_VERSION]
    );
    inserted += rows.length;
  }

  const existing = await q<{ id: string }>(`select id from angle_tag_runs where notes = $1`, [RUN_KEY]);
  if (existing.length === 0) {
    await q(
      `insert into angle_tag_runs (started_at, finished_at, videos, requests, input_tokens,
                                   output_tokens, cache_read_tokens, cache_write_tokens, usd, model, notes)
       values (now(), now(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [byVideo.size, RUN_COST.requests, RUN_COST.input_tokens, RUN_COST.output_tokens,
       RUN_COST.cache_read_tokens, RUN_COST.cache_write_tokens, RUN_COST.usd, MODEL, RUN_KEY]
    );
  }

  const [totals] = await q<{ rows: string; videos: string }>(
    `select count(*)::text as rows, count(distinct video_id)::text as videos from video_angles`
  );
  console.log(`inserted ${inserted} new · video_angles now ${totals.rows} rows over ${totals.videos} videos`);
  await getPool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
