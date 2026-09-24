import {
  NIGHTLY_STEP_FAILURE_PREFIX,
  OWNED_ANALYTICS_FAILURE_PREFIX,
  nightlyDoneSuffix,
  nightlyStepFailureReport,
  ownedAnalyticsExitCode,
  ownedAnalyticsFailureReport,
  type StepFailure,
} from './failure-report';

const REVOKED: StepFailure = {
  label: 'Make or Break Shop',
  message: 'invalid_grant: Token has been expired or revoked.',
};

describe('ownedAnalyticsFailureReport', () => {
  it('says nothing when every connection synced', () => {
    expect(ownedAnalyticsFailureReport([], 3)).toEqual([]);
  });

  it('reports the revoked-token case that went unnoticed for a week', () => {
    const lines = ownedAnalyticsFailureReport([REVOKED], 2);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`${OWNED_ANALYTICS_FAILURE_PREFIX} 1 of 2 connection(s) did not sync`);
    expect(lines[1]).toContain('Make or Break Shop');
    expect(lines[1]).toContain('Token has been expired or revoked');
  });

  it('prefixes every line so the failure is grep-able in the nightly log', () => {
    const lines = ownedAnalyticsFailureReport([REVOKED, { label: 'Other', message: 'quota' }], 5);

    for (const line of lines) {
      expect(line.startsWith(OWNED_ANALYTICS_FAILURE_PREFIX)).toBe(true);
    }
  });

  it('still reports when the connection count is unknown', () => {
    expect(ownedAnalyticsFailureReport([REVOKED])[0]).toBe(
      `${OWNED_ANALYTICS_FAILURE_PREFIX} 1 connection(s) did not sync`
    );
  });

  it('never prints an empty reason', () => {
    const lines = ownedAnalyticsFailureReport([{ label: 'Chan', message: '   ' }]);
    expect(lines[1]).toBe(`${OWNED_ANALYTICS_FAILURE_PREFIX} Chan: unknown error`);
  });
});

describe('ownedAnalyticsExitCode', () => {
  it('exits 0 on a clean run', () => {
    expect(ownedAnalyticsExitCode([])).toBe(0);
  });

  it('exits non-zero when any connection failed', () => {
    expect(ownedAnalyticsExitCode([REVOKED])).toBe(1);
  });
});

describe('nightlyStepFailureReport', () => {
  it('says nothing when every child step ran', () => {
    expect(nightlyStepFailureReport([])).toEqual([]);
    expect(nightlyDoneSuffix([])).toBe('');
  });

  it('names the failed script', () => {
    const failures: StepFailure[] = [
      { label: 'scripts/owned-analytics-sync.ts', message: 'Command failed with exit code 1' },
    ];

    expect(nightlyStepFailureReport(failures)).toEqual([
      `${NIGHTLY_STEP_FAILURE_PREFIX} scripts/owned-analytics-sync.ts: Command failed with exit code 1`,
    ]);
  });

  it('makes the Done line say the run was not clean', () => {
    const suffix = nightlyDoneSuffix([
      { label: 'scripts/owned-analytics-sync.ts', message: 'boom' },
      { label: 'scripts/avatar-cache-sync.ts', message: 'boom' },
    ]);

    expect(suffix).toContain('2 step(s) FAILED');
    expect(suffix).toContain('scripts/owned-analytics-sync.ts');
    expect(suffix).toContain('scripts/avatar-cache-sync.ts');
  });
});
