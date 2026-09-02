// Perceptual thumbnail identity (2026-09-02). Pure functions, no I/O.
//
// Why: YouTube's CDN periodically re-encodes the same thumbnail (bytes differ by a few hundred bytes,
// pixels differ by <1/255 on average), and those re-encodes flip back and forth across ~50 videos at the
// same minute. An exact sha256 sees every flip as a "thumbnail change"; a creator's real swap or a
// Test & Compare variant differs by tens of gray levels. So identity = difference hash (dHash) on a
// 9x8 grayscale downsample, and "same image" = Hamming distance <= SAME_IMAGE_MAX_DISTANCE.

export const DHASH_W = 9;
export const DHASH_H = 8;
export const SAME_IMAGE_MAX_DISTANCE = 6; // of 64 bits; re-encodes score 0-2, real swaps 15+

// gray: row-major luminance values (any scale), width w, height h. Returns 16 hex chars (64 bits).
export function dhashFromGray(gray: ArrayLike<number>, w: number, h: number): string {
  if (w !== DHASH_W || h !== DHASH_H) throw new Error(`dhashFromGray expects ${DHASH_W}x${DHASH_H}, got ${w}x${h}`);
  let bits = '';
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W - 1; x++) {
      bits += gray[y * w + x] < gray[y * w + x + 1] ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

// Box-filter downsample of a full-size grayscale image to DHASH_W x DHASH_H.
export function downsampleGray(gray: ArrayLike<number>, w: number, h: number): Float64Array {
  const out = new Float64Array(DHASH_W * DHASH_H);
  for (let oy = 0; oy < DHASH_H; oy++) {
    const y0 = Math.floor((oy * h) / DHASH_H), y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * h) / DHASH_H));
    for (let ox = 0; ox < DHASH_W; ox++) {
      const x0 = Math.floor((ox * w) / DHASH_W), x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * w) / DHASH_W));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += gray[y * w + x]; n++; }
      out[oy * DHASH_W + ox] = sum / n;
    }
  }
  return out;
}

// RGB(A) interleaved bytes -> luminance; channels = 3 or 4.
export function toGray(rgba: ArrayLike<number>, w: number, h: number, channels = 3): Float64Array {
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * channels;
    g[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }
  return g;
}

export function dhashFromRgb(rgba: ArrayLike<number>, w: number, h: number, channels = 3): string {
  return dhashFromGray(downsampleGray(toGray(rgba, w, h, channels), w, h), DHASH_W, DHASH_H);
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) throw new Error('hash length mismatch');
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

export function isSameImage(a: string | null | undefined, b: string | null | undefined, max = SAME_IMAGE_MAX_DISTANCE): boolean {
  if (!a || !b) return false;
  return hamming(a, b) <= max;
}

// Collapse a version list into distinct images by perceptual identity (order of first appearance).
// Returns for each version the label index (0 = A, 1 = B, ...) and whether it repeats an earlier image.
export function labelByPhash<T extends { phash?: string | null; sha256: string }>(versions: T[]) {
  const reps: { key: string; phash: string | null }[] = [];
  return versions.map((v) => {
    let idx = -1;
    if (v.phash) idx = reps.findIndex((r) => r.phash && isSameImage(r.phash, v.phash));
    if (idx < 0) idx = reps.findIndex((r) => r.key === v.sha256);
    const repeat = idx >= 0;
    if (!repeat) { reps.push({ key: v.sha256, phash: v.phash ?? null }); idx = reps.length - 1; }
    return { ...v, label: String.fromCharCode(65 + idx), repeat };
  });
}

// ---- second signal: mean absolute pixel difference on a small grayscale (64x36) ----
// Measured on the archive: CDN re-renders with dHash 7-10 have mean diff 0.4-0.5/255; real subtle variants
// with dHash 7-12 have mean diff 12-22. So the combined rule is:
//   same picture  <=>  dhash <= SAME_IMAGE_MAX_DISTANCE
//                  OR (dhash <= AMBIGUOUS_MAX_DISTANCE AND meanAbsDiff < SAME_PIXEL_MAX_MEAN_DIFF)
export const AMBIGUOUS_MAX_DISTANCE = 16;
export const SAME_PIXEL_MAX_MEAN_DIFF = 4;
export const SMALL_W = 64;
export const SMALL_H = 36;

export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || !a.length) throw new Error('size mismatch');
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export function isSamePicture(dhashA: string | null | undefined, dhashB: string | null | undefined, meanDiff: number | null | undefined): boolean {
  if (!dhashA || !dhashB) return false;
  const d = hamming(dhashA, dhashB);
  if (d <= SAME_IMAGE_MAX_DISTANCE) return true;
  if (d <= AMBIGUOUS_MAX_DISTANCE && meanDiff != null && meanDiff < SAME_PIXEL_MAX_MEAN_DIFF) return true;
  return false;
}

/**
 * Vertical (Shorts) videos get a 16:9 thumbnail with black pillars on both sides. Duration no
 * longer separates Shorts (up to 3 minutes since late 2024), so the picture is the reliable tell.
 * Input: the 64x36 grayscale; the outer 18% of columns must be near-black while the middle is not.
 */
export function isPillarboxed(gray: ArrayLike<number>, w = SMALL_W, h = SMALL_H): boolean {
  const band = Math.max(1, Math.round(w * 0.18));
  let side = 0, sideN = 0, mid = 0, midN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      if (x < band || x >= w - band) { side += v; sideN++; } else if (x > w * 0.35 && x < w * 0.65) { mid += v; midN++; }
    }
  }
  return side / sideN < 18 && mid / midN > 40;
}
