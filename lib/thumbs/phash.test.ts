import { dhashFromGray, dhashFromRgb, downsampleGray, hamming, isSameImage, labelByPhash, DHASH_W, DHASH_H, SAME_IMAGE_MAX_DISTANCE } from './phash';

// synthetic 90x80 grayscale "image": a horizontal gradient with a bright block
function makeImage(opts: { blockX?: number; noise?: number; offset?: number } = {}) {
  const w = 90, h = 80, g = new Float64Array(w * h);
  const { blockX = 20, noise = 0, offset = 0 } = opts;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = (x / w) * 200 + offset;
    if (x >= blockX && x < blockX + 30 && y >= 20 && y < 50) v = 250;
    g[y * w + x] = Math.max(0, Math.min(255, v + rnd() * noise));
  }
  return { g, w, h };
}
const hashOf = (img: { g: Float64Array; w: number; h: number }) => dhashFromGray(downsampleGray(img.g, img.w, img.h), DHASH_W, DHASH_H);

describe('dhash', () => {
  test('is 64 bits as 16 hex chars and deterministic', () => {
    const h = hashOf(makeImage());
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashOf(makeImage())).toBe(h);
  });

  test('a re-encode (small noise, slight brightness offset) is the SAME image', () => {
    const a = hashOf(makeImage());
    const b = hashOf(makeImage({ noise: 3, offset: 2 }));   // ~JPEG re-encode magnitude (mean diff <1/255 observed)
    expect(hamming(a, b)).toBeLessThanOrEqual(SAME_IMAGE_MAX_DISTANCE);
    expect(isSameImage(a, b)).toBe(true);
  });

  test('a real thumbnail swap (moved subject) is a DIFFERENT image', () => {
    const a = hashOf(makeImage({ blockX: 10 }));
    const b = hashOf(makeImage({ blockX: 55 }));
    expect(hamming(a, b)).toBeGreaterThan(SAME_IMAGE_MAX_DISTANCE);
    expect(isSameImage(a, b)).toBe(false);
  });

  test('rgb path matches the gray path', () => {
    const img = makeImage();
    const rgb = new Uint8Array(img.w * img.h * 3);
    for (let i = 0; i < img.w * img.h; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = Math.round(img.g[i]);
    expect(dhashFromRgb(rgb, img.w, img.h, 3)).toBe(hashOf(img));
  });

  test('hamming counts differing bits; missing hashes are never "same"', () => {
    expect(hamming('0000000000000000', '000000000000000f')).toBe(4);
    expect(isSameImage(null, 'abcd')).toBe(false);
  });
});

describe('labelByPhash', () => {
  test('collapses CDN re-encodes into one letter and keeps real swaps distinct', () => {
    const A = hashOf(makeImage()), A2 = hashOf(makeImage({ noise: 3, offset: 2 })), B = hashOf(makeImage({ blockX: 55 }));
    const labeled = labelByPhash([
      { sha256: 's1', phash: A }, { sha256: 's2', phash: A2 }, { sha256: 's3', phash: A },
      { sha256: 's4', phash: B }, { sha256: 's5', phash: A2 },
    ]);
    expect(labeled.map((l) => l.label).join('')).toBe('AAABA');
    expect(labeled.map((l) => l.repeat)).toEqual([false, true, true, false, true]);
  });

  test('falls back to sha256 identity when no phash is stored', () => {
    const labeled = labelByPhash([{ sha256: 'x', phash: null }, { sha256: 'y', phash: null }, { sha256: 'x', phash: null }]);
    expect(labeled.map((l) => l.label).join('')).toBe('ABA');
  });
});

import { isSamePicture, meanAbsDiff } from './phash';

describe('isSamePicture (combined rule)', () => {
  const h0 = '0000000000000000', h9 = '00000000000001ff' /* 9 bits */, h20 = '00000000000fffff' /* 20 bits */;
  test('small hash distance is the same picture regardless of pixels', () => {
    expect(isSamePicture(h0, '000000000000000f', 30)).toBe(true);
  });
  test('ambiguous hash distance is decided by the pixel difference', () => {
    expect(isSamePicture(h0, h9, 0.4)).toBe(true);    // CDN re-render
    expect(isSamePicture(h0, h9, 12.5)).toBe(false);  // real subtle variant (AI LABS case)
    expect(isSamePicture(h0, h9, null)).toBe(false);  // no pixel evidence -> treat as change
  });
  test('large hash distance is always a change', () => {
    expect(isSamePicture(h0, h20, 0.1)).toBe(false);
  });
  test('meanAbsDiff', () => {
    expect(meanAbsDiff([0, 10, 20], [1, 12, 17])).toBeCloseTo(2, 6);
  });
});
