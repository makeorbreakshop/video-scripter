// Packaging history as variants and tests, not version numbers.
//
// thumbnail_versions is a *state* log: the watcher (scripts/thumbnail-watch.ts) compares each
// fetch with the previous row only, so a Test & Compare rotation that flips back to an earlier
// image writes a new version with identical bytes. Version numbers therefore count state
// changes, not distinct images. Everything user-facing should go through this module:
//   - thumbnailVariants(): distinct images (A, B, C …) and which variant each state was
//   - testState(): whether those states look like a running test, a settled one, or one swap
// Pure functions, no I/O.
import { isSamePicture } from '../thumbs/phash';

export type ThumbRow = { version: number; sha256: string | null; phash: string | null; first_seen: string };

export type Variant = {
  label: string;            // A, B, C …  in order of first appearance
  versions: number[];       // every state row that showed this image
  firstSeen: string;        // ISO
  current: boolean;         // the latest state shows this image
};

export type VariantState = { version: number; variant: string; first_seen: string; isReturn: boolean };

export type TestStatus = 'none' | 'swap' | 'testing' | 'settled';

export type TestState = {
  status: TestStatus;
  variantCount: number;
  /** state changes after the first image, i.e. how many times the live thumbnail flipped */
  rotations: number;
  /** first flip; null when there is nothing to call a test */
  startedAt: string | null;
  /** last flip */
  lastFlipAt: string | null;
  /** variant label that has held since the last flip, once settled */
  winner: string | null;
  /** lastFlipAt + SETTLE_HOURS, once settled */
  settledAt: string | null;
};

/** A variant that has held this long after a rotation is treated as the winner. */
export const SETTLE_HOURS = 48;

const label = (i: number) => String.fromCharCode(65 + i);

function sameImage(a: ThumbRow, b: ThumbRow): boolean {
  if (a.sha256 && b.sha256 && a.sha256 === b.sha256) return true;
  return isSamePicture(a.phash, b.phash, null);
}

export function thumbnailVariants(rows: ThumbRow[]): { variants: Variant[]; states: VariantState[] } {
  const sorted = [...rows].sort((a, b) => a.version - b.version);
  const variants: Variant[] = [];
  const reps: ThumbRow[] = [];
  const states: VariantState[] = [];
  for (const r of sorted) {
    let i = reps.findIndex((rep) => sameImage(rep, r));
    const isReturn = i >= 0;
    if (i < 0) {
      i = reps.length;
      reps.push(r);
      variants.push({ label: label(i), versions: [], firstSeen: new Date(r.first_seen).toISOString(), current: false });
    }
    variants[i].versions.push(r.version);
    states.push({ version: r.version, variant: variants[i].label, first_seen: new Date(r.first_seen).toISOString(), isReturn });
  }
  if (states.length) {
    const last = states[states.length - 1].variant;
    for (const v of variants) v.current = v.label === last;
  }
  return { variants, states };
}

export function testState(rows: ThumbRow[], now: string | number | Date = Date.now()): TestState {
  const { variants, states } = thumbnailVariants(rows);
  const none: TestState = { status: 'none', variantCount: variants.length, rotations: 0, startedAt: null, lastFlipAt: null, winner: null, settledAt: null };
  if (states.length < 2) return none;

  const flips = states.slice(1);
  const rotations = flips.length;
  const startedAt = flips[0].first_seen;
  const lastFlipAt = flips[flips.length - 1].first_seen;
  const returned = states.some((s) => s.isReturn);

  // One new image that never flipped back is a swap, not a test.
  if (!returned) return { ...none, status: 'swap', rotations, startedAt, lastFlipAt };

  const heldMs = new Date(now).getTime() - new Date(lastFlipAt).getTime();
  if (heldMs >= SETTLE_HOURS * 3_600_000) {
    return {
      status: 'settled', variantCount: variants.length, rotations, startedAt, lastFlipAt,
      winner: states[states.length - 1].variant,
      settledAt: new Date(new Date(lastFlipAt).getTime() + SETTLE_HOURS * 3_600_000).toISOString(),
    };
  }
  return { status: 'testing', variantCount: variants.length, rotations, startedAt, lastFlipAt, winner: null, settledAt: null };
}
