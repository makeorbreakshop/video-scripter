// Pure: no React, so the list and the test can both use it.
/**
 * YouTube avatar URLs carry their size in the path (`=s800-c-k-c0x0`). The directory stores the
 * 800px variant; asking the CDN for that for a 36px disc, 26 rows at a time, is why a long list
 * of avatars sat blank. Ask for 2x the rendered size instead. Non-YouTube URLs pass through.
 */
export function sizedAvatarUrl(src: string, size: number): string {
  const px = Math.max(32, Math.min(800, Math.round(size * 2)));
  return src.replace(/=s\d+(-c)?/, `=s${px}$1`);
}
