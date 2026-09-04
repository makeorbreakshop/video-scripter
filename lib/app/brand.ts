/**
 * The brand, in one place, so the favicon, the OG card, the CSS and the extension cannot
 * drift apart. Before this the repo shipped five product names and six greens, and the only
 * favicon in the app belonged to Thumbnail Battle.
 *
 * The mark is a smith's anvil drawn on a 16×16 pixel grid — the same grid the wordmark's face
 * (Press Start 2P) is built on, so the identity is one idea at every size. Because the artwork
 * *is* a 16px design, the favicon is not a shrunk illustration: it is the drawing at its native
 * resolution.
 *
 * An anvil rather than a hammer because the silhouette has to survive 16px: wide face, narrow
 * waist, flared foot and a horn on one side is asymmetric and unmistakable, where a hammer's
 * head over a centred handle just reads as the letter T.
 */
export const BRAND = {
  name: 'ChannelSmith',
  tagline: 'Track what the channels you watch are changing, and what it did for them.',
  /** --cs-accent on the light ground. Text-safe at 4.5:1, and 5.4:1 under --cs-accent-on. */
  accent: '#0E7A3C',
  /** --cs-accent on the dark ground. */
  accentDark: '#3DF07A',
  /** The ink to put on an accent fill, both themes. */
  accentOn: '#FFFFFF',
  ground: '#F6F7FA',
  groundDark: '#0B0E14',
  ink: '#10131A',
} as const;

/** The mark's grid: [x, y, width, height] in cells of a 16×16 square, origin top-left. */
export const MARK_GRID = 16;
export const MARK_CELLS: ReadonlyArray<readonly [number, number, number, number]> = [
  [3, 3, 10, 1],   // face, top course
  [1, 4, 12, 2],   // face + the horn overhanging to the left
  [3, 6, 10, 1],   // under the face
  [5, 7, 6, 1],    // shoulder
  [6, 8, 4, 2],    // waist
  [5, 10, 6, 1],   // base flare
  [2, 11, 11, 2],  // foot
];

/** The mark as SVG path data, for anywhere that wants one string. */
export function markPath(): string {
  return MARK_CELLS.map(([x, y, w, h]) =>
    `M${x} ${y}h${w}v${h}h-${w}z`).join('');
}
