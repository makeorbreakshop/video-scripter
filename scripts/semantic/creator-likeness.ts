// creator_likeness — how much a channel in the identity index looks like the kind of channel
// ChannelSmith's users actually track.
//
// Why this exists: /app/angles drew its "far" examples from every channel the corpus had ever
// scored, and the board filled with Euro-disco megamixes, NFL recaps, Quran recitations and
// Disney Jr compilations. Those are not packaging failures, they are not packaging at all — a
// music mix has no angle to learn from. The first fix attempted was a hand-written list of
// content kinds; it was rejected as a taxonomy nobody can maintain. This is the emergent
// replacement: no categories, one number, derived from the set of channels users track.
//
// The measure: for each channel C in channels_identity_v1, the mean cosine similarity (on the
// `mean` vector) between C and its k=5 nearest neighbours among the TRACKED set (distinct
// user_channels.channel_id), excluding C itself. A channel that sits inside the cloud of things
// people track scores high; a channel that sits nowhere near any of them scores low. It is a
// density estimate against a reference set, not a classifier, so it degrades gracefully: a new
// niche someone starts tracking pulls its neighbourhood up automatically at the next run.
//
// The floor is derived from the same reference set rather than eyeballed: the 5th percentile of
// the TRACKED channels' own creator_likeness. By construction, 95% of the things users track
// clear it. If the tracked set itself contains junk, the floor drops and the script says so —
// it prints the channels either side of the line so the number can be checked by reading names.
//
// Cost: one bounded Postgres read (501 ids today, projection is one column) and local Qdrant
// traffic only. No paid API. Safe to re-run; it overwrites the payload field.
//
//   npx tsx scripts/semantic/creator-likeness.ts [--k 5] [--percentile 5] [--dry-run]
import path from 'node:path';
import fs from 'node:fs';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env.local') });

import { closeDb, db } from './common';
import { IDENTITY_COLLECTION } from '../../lib/semantic/channel-relations';
import { uuid5ForId } from '../../lib/semantic/qdrant';
import {
  CREATOR_LIKENESS_FILE, likenessScores, roundLikeness,
  type CreatorLikenessFloor, type TrackedVector,
} from '../../lib/semantic/creator-likeness';

export { likenessScores, type TrackedVector } from '../../lib/semantic/creator-likeness';

const num = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const K = num('--k', 5);
const PERCENTILE = num('--percentile', 5);
const DRY_RUN = process.argv.includes('--dry-run');
const QDRANT = (process.env.QDRANT_URL ?? 'http://localhost:6333').replace(/\/$/, '');

const headers = {
  'content-type': 'application/json',
  ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}),
};

interface Point { id: string | number; channel_id: string; name: string; vec: number[] }

async function loadIdentity(): Promise<Point[]> {
  const points: Point[] = [];
  let offset: unknown = null;
  for (;;) {
    const res = await fetch(`${QDRANT}/collections/${IDENTITY_COLLECTION}/points/scroll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        limit: 512, offset, with_vector: ['mean'],
        with_payload: ['channel_id', 'channel_name'],
      }),
    });
    if (!res.ok) throw new Error(`scroll: HTTP ${res.status}`);
    const body = await res.json() as any;
    for (const p of body.result.points) {
      const vector = p.vector?.mean;
      if (!p.payload?.channel_id || !Array.isArray(vector)) continue;
      points.push({
        id: p.id,
        channel_id: p.payload.channel_id,
        name: p.payload.channel_name ?? p.payload.channel_id,
        vec: vector,
      });
    }
    offset = body.result.next_page_offset;
    if (!offset) break;
  }
  return points;
}

/** The channels ChannelSmith users actually track: one bounded projection of a single column. */
export async function trackedChannelIds(): Promise<string[]> {
  const { rows } = await db().query<{ channel_id: string }>(
    `select distinct channel_id from user_channels where channel_id is not null`,
  );
  return rows.map((r) => r.channel_id);
}

/**
 * The reference set as vectors: one bounded Postgres read, then a direct Qdrant fetch of those
 * points' `mean` vectors. Callers that rebuild identity points need this to score a channel without
 * scrolling the whole collection; the batch script below already has every vector in memory and
 * derives its reference from those instead.
 */
export async function loadTrackedVectors(
  options: { qdrantUrl?: string } = {},
): Promise<TrackedVector[]> {
  const ids = await trackedChannelIds();
  if (!ids.length) return [];
  const base = (options.qdrantUrl ?? process.env.QDRANT_URL ?? 'http://localhost:6333').replace(/\/$/, '');
  const out: TrackedVector[] = [];
  for (let i = 0; i < ids.length; i += 1_000) {
    const slice = ids.slice(i, i + 1_000);
    const res = await fetch(`${base}/collections/${IDENTITY_COLLECTION}/points`, {
      method: 'POST', headers,
      body: JSON.stringify({
        ids: slice.map(uuid5ForId), with_vector: ['mean'], with_payload: ['channel_id'],
      }),
    });
    if (!res.ok) throw new Error(`tracked points: HTTP ${res.status} ${await res.text()}`);
    const body = await res.json() as any;
    for (const p of body.result ?? []) {
      const vector = p.vector?.mean;
      if (!p.payload?.channel_id || !Array.isArray(vector)) continue;
      out.push({ channel_id: p.payload.channel_id, vector });
    }
  }
  return out;
}

/** Percentile by nearest rank on a sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

async function main() {
  const trackedIds = new Set(await trackedChannelIds());
  await closeDb();

  const points = await loadIdentity();
  const reference = points.filter((p) => trackedIds.has(p.channel_id));
  console.log(`identity ${points.length} · tracked ids ${trackedIds.size} · tracked with a vector ${reference.length} · k ${K}`);
  if (reference.length <= K) throw new Error('reference set too small to measure against');

  // 6,467 x 501 x 512 dot products — ~1.7 GFLOP, about a second, no index needed.
  const likeness = likenessScores(
    new Map(points.map((p) => [p.channel_id, p.vec])),
    reference.map((r) => ({ channel_id: r.channel_id, vector: r.vec })),
    K,
  );

  const referenceScores = reference
    .map((r) => likeness.get(r.channel_id))
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);
  const floor = percentile(referenceScores, PERCENTILE);

  const ranked = points
    .filter((p) => likeness.has(p.channel_id))
    .map((p) => ({ name: p.name, channel_id: p.channel_id, value: likeness.get(p.channel_id)!, tracked: trackedIds.has(p.channel_id) }))
    .sort((a, b) => a.value - b.value);
  const cut = ranked.findIndex((r) => r.value >= floor);
  const show = (r: typeof ranked[number]) => `    ${r.value.toFixed(3)}  ${r.name}${r.tracked ? '  [tracked]' : ''}`;

  console.log(`\nfloor = p${PERCENTILE} of the ${reference.length} tracked channels = ${floor.toFixed(4)}`);
  console.log(`below floor ${cut} / ${points.length} identity channels (${((cut / points.length) * 100).toFixed(1)}%)`);
  console.log('\n  10 just BELOW the floor (excluded):');
  console.log(ranked.slice(Math.max(0, cut - 10), cut).map(show).join('\n'));
  console.log('\n  10 just ABOVE the floor (kept):');
  console.log(ranked.slice(cut, cut + 10).map(show).join('\n'));
  console.log('\n  10 lowest overall:');
  console.log(ranked.slice(0, 10).map(show).join('\n'));
  const trackedBelow = ranked.filter((r) => r.tracked && r.value < floor);
  console.log(`\n  tracked channels below the floor (${trackedBelow.length}, the p${PERCENTILE} tail — read these to judge whether the reference set is clean):`);
  console.log(trackedBelow.slice(0, 15).map(show).join('\n'));

  const dumpAt = process.argv.indexOf('--dump');
  if (dumpAt !== -1 && process.argv[dumpAt + 1]) {
    fs.writeFileSync(process.argv[dumpAt + 1], ranked.map((r) => `${r.value.toFixed(4)}\t${r.channel_id}\t${r.name}`).join('\n'));
  }

  if (DRY_RUN) return;

  for (let i = 0; i < points.length; i += 512) {
    const slice = points.slice(i, i + 512);
    // Qdrant sets one payload object per request, so a distinct value per point means one
    // request per distinct value. Batch by rounding to 4 dp and grouping — 6,467 points
    // collapse to a few thousand groups, and the rounding is far below any decision the floor makes.
    const groups = new Map<string, Array<string | number>>();
    for (const p of slice) {
      const value = likeness.get(p.channel_id);
      if (value == null) continue;
      const key = roundLikeness(value).toFixed(4);
      const list = groups.get(key) ?? [];
      list.push(p.id);
      groups.set(key, list);
    }
    for (const [value, ids] of groups) {
      const r = await fetch(`${QDRANT}/collections/${IDENTITY_COLLECTION}/points/payload?wait=true`, {
        method: 'POST', headers,
        body: JSON.stringify({ payload: { creator_likeness: Number(value) }, points: ids }),
      });
      if (!r.ok) throw new Error(`set_payload: HTTP ${r.status} ${await r.text()}`);
    }
    process.stdout.write(`\r  payload ${Math.min(i + 512, points.length)}/${points.length}`);
  }

  const record: CreatorLikenessFloor = {
    floor: Number(floor.toFixed(4)),
    k: K,
    percentile: PERCENTILE,
    reference_channels: reference.length,
    identity_channels: points.length,
    below_floor: cut,
    computed_at: new Date().toISOString(),
  };
  fs.writeFileSync(CREATOR_LIKENESS_FILE, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nwrote ${CREATOR_LIKENESS_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
