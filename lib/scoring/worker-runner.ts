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

/** Pack shared priors within the bounded lookahead, retaining first-seen channel priority. */
export function scoringTargetBatches<T extends { channel_id?: string }>(targets: T[]): T[][] {
  const grouped = new Map<string, T[]>();
  targets.forEach((target, index) => {
    const key = target.channel_id || `__ungrouped_${index}`;
    const group = grouped.get(key);
    if (group) group.push(target);
    else grouped.set(key, [target]);
  });
  const ordered = [...grouped.values()].flat();
  const batches: T[][] = [];
  for (let i = 0; i < ordered.length; i += SCORING_TARGET_BATCH_SIZE) {
    batches.push(ordered.slice(i, i + SCORING_TARGET_BATCH_SIZE));
  }
  return batches;
}
