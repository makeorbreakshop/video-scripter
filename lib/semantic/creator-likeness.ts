// The creator_likeness floor: one number, computed by scripts/semantic/creator-likeness.ts and
// checked in, that separates "a channel like the ones people track" from everything else in the
// identity index.
//
// It lives in a file rather than a table because it is a property of a model run, not of live
// state: it changes only when the script is re-run, and a reviewer should be able to see it move
// in a diff. The value it gates is `creator_likeness` on each channels_identity_v1 point.
import fs from 'node:fs';
import path from 'node:path';

export interface CreatorLikenessFloor {
  floor: number;
  k: number;
  percentile: number;
  reference_channels: number;
  identity_channels: number;
  below_floor: number;
  computed_at: string;
}

export const CREATOR_LIKENESS_FILE = path.resolve(process.cwd(), 'lib/semantic/creator-likeness.json');

let cached: CreatorLikenessFloor | null = null;

/**
 * The floor, or null when the script has never run. Null means "do not filter": a missing
 * measurement must not silently empty every board.
 */
export function creatorLikenessFloor(): CreatorLikenessFloor | null {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(CREATOR_LIKENESS_FILE, 'utf8')) as CreatorLikenessFloor;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam. */
export function clearCreatorLikenessCache(): void { cached = null; }

// --- the measure itself ------------------------------------------------------------------------
// Pure math, kept here rather than in the script so that both the batch run
// (scripts/semantic/creator-likeness.ts) and the hourly identity rebuild
// (scripts/semantic/build-channel-identity.ts) compute the same number. Before this was shared,
// the rebuild wrote whole points without the field and silently dropped every value the batch
// script had written.

/** A channel users track, with its identity `mean` vector. The id is what makes self-exclusion possible. */
export interface TrackedVector {
  channel_id: string;
  vector: number[];
}

function unit(values: number[]): Float32Array {
  let norm = 0;
  for (const v of values) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] / norm;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

/**
 * Mean cosine similarity between each channel and its k nearest neighbours among the tracked set,
 * excluding the channel itself when it is one of the tracked channels.
 *
 * Degenerate cases are answered by omission rather than by a made-up number: an empty tracked set
 * yields an empty map, and so does a channel whose only neighbour in the reference set is itself.
 * A caller that gets no entry must not write the field — it carries the old value forward instead.
 * When k exceeds the usable reference size the mean is taken over everything available.
 */
export function likenessScores(
  channelVectors: Map<string, number[]>,
  trackedVectors: TrackedVector[],
  k = 5,
): Map<string, number> {
  const scores = new Map<string, number>();
  if (!trackedVectors.length || k < 1) return scores;
  const reference = trackedVectors.map((t) => ({ channel_id: t.channel_id, vec: unit(t.vector) }));
  for (const [channelId, vector] of channelVectors) {
    const self = unit(vector);
    const top: number[] = [];
    for (const r of reference) {
      if (r.channel_id === channelId) continue; // a tracked channel is not its own evidence
      const s = dot(self, r.vec);
      if (top.length < k) { top.push(s); top.sort((a, b) => a - b); }
      else if (s > top[0]) { top[0] = s; top.sort((a, b) => a - b); }
    }
    if (!top.length) continue;
    scores.set(channelId, top.reduce((a, b) => a + b, 0) / top.length);
  }
  return scores;
}

/** The rounding the batch script writes with, so a rebuilt point and a batch-written point agree. */
export function roundLikeness(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Attach `creator_likeness` to a rebuilt identity payload: the freshly computed value when there is
 * one, otherwise whatever the point already carried. A whole-point upsert replaces the payload, so
 * dropping this field is data loss, not a missing optimisation — the only payload allowed out
 * without it is one for which neither source exists.
 */
export function mergeLikenessPayload<T extends Record<string, unknown>>(
  payload: T,
  computed?: number | null,
  existingPayload?: Record<string, unknown> | null,
): T & { creator_likeness?: number } {
  if (typeof computed === 'number' && Number.isFinite(computed)) {
    return { ...payload, creator_likeness: roundLikeness(computed) };
  }
  const carried = existingPayload?.creator_likeness;
  if (typeof carried === 'number' && Number.isFinite(carried)) {
    return { ...payload, creator_likeness: carried };
  }
  return { ...payload };
}
