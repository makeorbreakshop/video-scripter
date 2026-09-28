// Split a batch into statements that each stay under a byte budget.
//
// Postgres materialises a set-returning function in FROM (unnest of arrays) into a tuplestore, and
// past work_mem (5 MB on this instance) the tuplestore spills to a temp file. The observation cache
// upsert sent up to 25 MB of bytea per statement and spilled ~24 MB each time (2026-09-28).

/** Under work_mem, with headroom for the other columns. */
export const UPSERT_CHUNK_BYTES = 4_000_000;

export function chunkByBytes<T>(rows: readonly T[], bytesOf: (r: T) => number, maxBytes = UPSERT_CHUNK_BYTES): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const r of rows) {
    const b = bytesOf(r);
    if (cur.length && size + b > maxBytes) { out.push(cur); cur = []; size = 0; }
    cur.push(r);
    size += b;
  }
  if (cur.length) out.push(cur);
  return out;
}
