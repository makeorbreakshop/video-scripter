// Classifying a database object's definition for the database half of the video-text ratchet
// (video-text-db-objects.db.test.ts). Pure, so it is unit-tested without a database.

/**
 * Does this definition read `col` from videos? The accessor idiom `coalesce(vt.col, v.col)` and a
 * plain `vt.col` read the side table and are legitimate — exactly the masking the code sweep does
 * (lib/app/video-text-sweep.ts) — so sql/2026-09-26-metadata-db-readers.sql takes an object off
 * this list by rewriting it, not by renaming anything.
 */
export function readsFromVideos(def: string, col: string): boolean {
  const masked = def
    .replace(new RegExp(`coalesce\\(\\s*vt\\.${col}\\s*,\\s*v\\.${col}\\s*\\)`, 'gi'), '')
    .replace(new RegExp(`\\bvt\\.${col}\\b`, 'gi'), '');
  return new RegExp(`\\b${col}\\b`, 'i').test(masked);
}
