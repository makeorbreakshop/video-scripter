// The rules the subscription import runs on, with no network and no React so they can be
// tested on their own (lib/app/import-batch.test.ts).
//
// There is no cap on how many channels one import may add. What replaces the cap is shape:
// the client sends the ids in sequential batches so it can draw a real progress bar, and the
// server walks each batch in small chunks with bounded concurrency so a big import is a
// steady trickle of YouTube calls rather than a spike. Re-posting the same ids is a no-op —
// anything already tracked is skipped, not re-added.

/** Split a list into runs of at most `size`. An empty or bad size still yields one run. */
export function chunkIds<T>(ids: T[], size: number): T[][] {
  const all = ids || [];
  const n = Number.isFinite(size) && size > 0 ? Math.floor(size) : all.length || 1;
  const out: T[][] = [];
  for (let i = 0; i < all.length; i += n) out.push(all.slice(i, i + n));
  return out;
}

/** How many channels the client sends per POST, and how many the server adds per chunk. */
export const CLIENT_BATCH = 50;
export const SERVER_CHUNK = 25;
export const SERVER_CONCURRENCY = 4;

/**
 * What an import request actually has to do: the ids worth adding, and the ones already
 * tracked. Idempotency lives here — a second post of the same ids plans no work at all.
 */
export function planImport(ids: string[], alreadyTracked: Iterable<string>): { add: string[]; skip: string[] } {
  const have = new Set(alreadyTracked);
  const seen = new Set<string>();
  const add: string[] = [];
  const skip: string[] = [];
  for (const id of ids || []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (have.has(id)) skip.push(id); else add.push(id);
  }
  return { add, skip };
}

/**
 * Map over items with at most `limit` in flight. Order of results follows the input; a
 * rejected item is handed to the caller as a value, never thrown — one dead channel must
 * not lose the 473 that worked.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<{ ok: true; value: R } | { ok: false; error: any }>> {
  const all = items || [];
  const width = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  const out: Array<{ ok: true; value: R } | { ok: false; error: any }> = new Array(all.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= all.length) return;
      try { out[i] = { ok: true, value: await fn(all[i], i) }; }
      catch (error) { out[i] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, all.length) }, worker));
  return out;
}

/**
 * One commit, however many times it is triggered. The "+ New group" chip commits on both
 * Enter and blur, and Enter closes the field — which fires the blur. Without this the user
 * gets two creates and the second one's "You already have a group called …".
 */
export function createOnceGuard(): { run<T>(fn: () => T): T | undefined; done: boolean } {
  let spent = false;
  return {
    get done() { return spent; },
    run<T>(fn: () => T): T | undefined {
      if (spent) return undefined;
      spent = true;
      return fn();
    },
  };
}
