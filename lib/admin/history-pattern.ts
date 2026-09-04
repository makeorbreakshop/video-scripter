/**
 * How many version labels the History column prints before it stops. Past this the string is
 * no longer telling you anything a count would not — and unbounded it ran off the right edge
 * of the admin table, which has no horizontal scroll container.
 */
export const PATTERN_MAX = 8;

/** "A → B → A", or "+12 more → A → B → A" once a video has rotated more than PATTERN_MAX times. */
export function patternSummary(labels: string[], max = PATTERN_MAX): string {
  if (!labels.length) return '';
  if (labels.length <= max) return labels.join(' → ');
  // Keep the tail: the recent versions are the ones a swap is being read for.
  const dropped = labels.length - max;
  return [`+${dropped} more`, ...labels.slice(-max)].join(' → ');
}
