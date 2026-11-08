import { QdrantUnavailableError } from './qdrant';

/**
 * The hourly semantic sync reads every video changed since its watermark from Supabase before it
 * first touches Qdrant. When Qdrant is down the run fails after that read, the watermark never
 * advances, and every later run re-reads a larger window (2026-10-26 → 2026-11-07: ~18 MB of
 * wasted egress per hour and growing). Probe Qdrant first so an outage costs zero database reads.
 */
export class SemanticSyncPreflightError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SemanticSyncPreflightError';
  }
}

export async function assertSemanticTargetsReachable(probeQdrant: () => Promise<void>): Promise<void> {
  try {
    await probeQdrant();
  } catch (error) {
    if (!(error instanceof QdrantUnavailableError)) throw error;
    throw new SemanticSyncPreflightError(
      `semantic sync skipped before any database read: ${error.message}; watermark retained`,
      { cause: error },
    );
  }
}
