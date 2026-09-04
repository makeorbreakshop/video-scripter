import { startManagedJob } from '../nightly/job-lifecycle';

const SCORE_WORKLOAD = 'score-videos';
const DEFAULT_MAX_SECONDS = 45 * 60;
export const SCORING_TARGET_BATCH_SIZE = 100;

interface ScoringWorkerOptions {
  args: string[];
  lockRoot?: string;
  run: (signal: AbortSignal) => Promise<void>;
}

export async function runScoringWorker(options: ScoringWorkerOptions): Promise<'completed' | 'skipped'> {
  const args = options.args.includes('--max-seconds')
    ? options.args
    : [...options.args, '--max-seconds', String(DEFAULT_MAX_SECONDS)];
  const job = startManagedJob({ name: SCORE_WORKLOAD, args, lockRoot: options.lockRoot });
  if (!job.acquired) return 'skipped';

  try {
    await options.run(job.signal);
    return 'completed';
  } finally {
    job.finish();
  }
}

/** Keep each database unit bounded without disturbing the selection query's priority order. */
export function scoringTargetBatches<T extends { channel_id?: string }>(targets: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < targets.length; i += SCORING_TARGET_BATCH_SIZE) {
    batches.push(targets.slice(i, i + SCORING_TARGET_BATCH_SIZE));
  }
  return batches;
}
