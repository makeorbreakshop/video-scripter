// Failure reporting for the nightly jobs.
//
// Both nightly scripts used to swallow per-step failures: they logged to stderr
// inside a catch and carried on to a cheerful "done" line with exit code 0. When
// the YouTube refresh token for an owned channel was revoked, owned-analytics-sync
// failed every night for a week and nothing downstream - not the exit code, not
// the nightly-ingest log, not launchd - said so.
//
// Pure so the wording and the exit decision are testable without a database or
// a YouTube token.

/** Marker for a failed owned-analytics connection. Grep-able in the nightly log. */
export const OWNED_ANALYTICS_FAILURE_PREFIX = 'OWNED ANALYTICS FAILED:'

/** Marker for a child step of nightly-ingest that did not complete. */
export const NIGHTLY_STEP_FAILURE_PREFIX = 'NIGHTLY STEP FAILED:'

export type StepFailure = {
  /** Channel title, channel id, or script name - whatever identifies the unit of work. */
  label: string
  message: string
}

function summarise(failure: StepFailure): string {
  const message = (failure.message || 'unknown error').trim() || 'unknown error'
  return `${failure.label}: ${message}`
}

/**
 * Lines to print to **stdout** when owned-analytics-sync had failures.
 * Empty when everything succeeded, so a healthy run stays quiet.
 */
export function ownedAnalyticsFailureReport(
  failures: readonly StepFailure[],
  totalConnections?: number
): string[] {
  if (failures.length === 0) return []

  const scope =
    typeof totalConnections === 'number'
      ? `${failures.length} of ${totalConnections} connection(s)`
      : `${failures.length} connection(s)`

  return [
    `${OWNED_ANALYTICS_FAILURE_PREFIX} ${scope} did not sync`,
    ...failures.map((failure) => `${OWNED_ANALYTICS_FAILURE_PREFIX} ${summarise(failure)}`),
  ]
}

/**
 * Exit code for owned-analytics-sync. Non-zero on any failed connection so the
 * caller - and launchd - can see that the run did not do its job.
 */
export function ownedAnalyticsExitCode(failures: readonly StepFailure[]): number {
  return failures.length > 0 ? 1 : 0
}

/** Lines to print to stdout when a nightly-ingest child step failed. */
export function nightlyStepFailureReport(failures: readonly StepFailure[]): string[] {
  if (failures.length === 0) return []

  return failures.map((failure) => `${NIGHTLY_STEP_FAILURE_PREFIX} ${summarise(failure)}`)
}

/** Suffix appended to the nightly-ingest "Done." line so the summary is never clean when it should not be. */
export function nightlyDoneSuffix(failures: readonly StepFailure[]): string {
  if (failures.length === 0) return ''
  return ` ${failures.length} step(s) FAILED: ${failures.map((failure) => failure.label).join(', ')}`
}
