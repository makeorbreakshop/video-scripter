// Pure helpers shared by the catalog backfill (scripts/semantic/embed-catalog.ts) and the hourly
// incremental sync (scripts/semantic/sync-semantic.ts). Kept here so they are unit-testable.

export interface CatalogCandidate {
  id: string;
  hash: string;
  payload: { channel_id?: string } & Record<string, unknown>;
}

/** Points whose stored document_hash differs from the freshly computed one (missing counts as stale). */
export function pendingPoints<T extends CatalogCandidate>(
  prepared: T[],
  storedHashes: Map<string | undefined, string | undefined>,
): T[] {
  return prepared.filter((point) => storedHashes.get(point.id) !== point.hash);
}

/** Distinct channel ids touched by a set of points, in first-seen order. */
export function channelIdsOf(points: CatalogCandidate[]): string[] {
  const seen = new Set<string>();
  for (const point of points) {
    const channelId = point.payload.channel_id;
    if (typeof channelId === 'string' && channelId) seen.add(channelId);
  }
  return [...seen];
}
