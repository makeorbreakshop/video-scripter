// Deadlock-tolerant write helper for the nightly jobs. Since launch-track
// (every 15 min), the nightly tracker, and the 5-min drain can all touch
// view_snapshots/view_tracking_priority/videos concurrently, batch
// transactions must (a) lock rows in a deterministic order (callers sort by
// video_id) and (b) retry on deadlock instead of killing the whole run.

export const DEADLOCK = '40P01';

export interface RetryOptions {
  attempts?: number; // total tries, including the first
  baseDelayMs?: number; // backoff: baseDelayMs * attempt
  sleep?: (ms: number) => Promise<void>;
}

export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 250, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: RetryOptions = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== DEADLOCK) throw e; // only deadlocks are retryable
      lastErr = e;
      if (attempt < attempts) await sleep(baseDelayMs * attempt);
    }
  }
  throw lastErr;
}
