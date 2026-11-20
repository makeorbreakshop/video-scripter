import { createSchedulerState, launchSpec, markFinished, markStarted, nextStarts, overdue, slotKey, type SchedulerConfig } from './scheduler-core';

const at = (iso: string) => new Date(iso).getTime();

const config: SchedulerConfig = {
  maxConcurrent: 3,
  lanes: { heavy: 1, db: 2, net: 3 },
  exclusiveHolds: ['heavy', 'db'],
  jobs: [
    { name: 'materializer', script: 'scripts/m.ts', args: [], lane: 'heavy', every: { minutes: 5, offsetSeconds: 210 }, maxSeconds: 300 },
    { name: 'bootstrap', script: 'scripts/b.ts', args: [], lane: 'heavy', every: { minutes: 5, offsetSeconds: 30 }, maxSeconds: 300 },
    { name: 'score', script: 'scripts/s.ts', args: [], lane: 'db', every: { minutes: 5, offsetSeconds: 240 }, maxSeconds: 300 },
    { name: 'rss', script: 'scripts/r.ts', args: [], lane: 'net', every: { minutes: 5, offsetSeconds: 60 }, maxSeconds: 300 },
    { name: 'fit', script: 'scripts/f.ts', args: [], lane: 'heavy', daily: { hour: 22, minute: 30 }, exclusive: true, maxSeconds: 3600 },
  ],
};

describe('slotKey', () => {
  it('advances an interval job once per period, shifted by its offset', () => {
    const job = config.jobs[0];
    expect(slotKey(job, at('2026-11-20T10:03:29'))).toBe(slotKey(job, at('2026-11-20T09:58:31')));
    expect(slotKey(job, at('2026-11-20T10:03:31'))).not.toBe(slotKey(job, at('2026-11-20T10:03:29')));
  });

  it('gives a daily job no slot before its local time and one slot per day after it', () => {
    const fit = config.jobs[4];
    expect(slotKey(fit, new Date(2026, 10, 20, 22, 29).getTime())).toBe(slotKey(fit, new Date(2026, 10, 19, 23, 0).getTime()));
    expect(slotKey(fit, new Date(2026, 10, 20, 22, 30).getTime())).toBe('2026-11-20');
    expect(slotKey(fit, new Date(2026, 10, 21, 3, 0).getTime())).toBe('2026-11-20');
  });
});

describe('nextStarts', () => {
  it('starts nothing on the boot tick for a daily job whose time already passed today', () => {
    const state = createSchedulerState(config, new Date(2026, 10, 20, 23, 0).getTime());
    const names = nextStarts(config, state, new Date(2026, 10, 20, 23, 0).getTime()).map((j) => j.name);
    expect(names).not.toContain('fit');
  });

  it('never runs two jobs of a capacity-1 lane at once', () => {
    const t0 = at('2026-11-20T10:00:00');
    const state = createSchedulerState(config, t0 - 3_600_000);
    const first = nextStarts(config, state, t0);
    const heavy = first.filter((j) => j.lane === 'heavy');
    expect(heavy).toHaveLength(1);
    heavy.forEach((j) => markStarted(state, j.name, t0));
    expect(nextStarts(config, state, t0 + 1000).filter((j) => j.lane === 'heavy')).toHaveLength(0);
  });

  it('runs the lane job that has waited longest first, then the other once the lane frees', () => {
    const t0 = at('2026-11-20T10:00:00');
    const state = createSchedulerState(config, t0 - 3_600_000);
    const [firstHeavy] = nextStarts(config, state, t0).filter((j) => j.lane === 'heavy');
    markStarted(state, firstHeavy.name, t0);
    markFinished(state, firstHeavy.name, t0 + 60_000);
    const [second] = nextStarts(config, state, t0 + 61_000).filter((j) => j.lane === 'heavy');
    expect(second.name).not.toBe(firstHeavy.name);
  });

  it('coalesces missed slots: a job that overran starts once, not once per missed period', () => {
    const t0 = at('2026-11-20T10:00:00');
    const state = createSchedulerState(config, t0 - 3_600_000);
    markStarted(state, 'rss', t0);
    markFinished(state, 'rss', t0 + 20 * 60_000);
    const later = t0 + 20 * 60_000 + 1000;
    expect(nextStarts(config, state, later).filter((j) => j.name === 'rss')).toHaveLength(1);
    markStarted(state, 'rss', later);
    markFinished(state, 'rss', later + 1000);
    expect(nextStarts(config, state, later + 2000).filter((j) => j.name === 'rss')).toHaveLength(0);
  });

  it('never starts a second copy of a running job', () => {
    const t0 = at('2026-11-20T10:00:00');
    const state = createSchedulerState(config, t0 - 3_600_000);
    markStarted(state, 'rss', t0);
    expect(nextStarts(config, state, t0 + 10 * 60_000).map((j) => j.name)).not.toContain('rss');
  });

  it('respects the global concurrency cap', () => {
    const t0 = at('2026-11-20T10:00:00');
    const state = createSchedulerState({ ...config, maxConcurrent: 2 }, t0 - 3_600_000);
    expect(nextStarts({ ...config, maxConcurrent: 2 }, state, t0)).toHaveLength(2);
  });

  it('holds new heavy and db work while an exclusive job waits, then runs it alone in the database lanes', () => {
    const due = new Date(2026, 10, 20, 22, 30, 5).getTime();
    const state = createSchedulerState(config, due - 3_600_000);
    markStarted(state, 'materializer', due - 60_000);
    markStarted(state, 'score', due - 60_000);
    let names = nextStarts(config, state, due).map((j) => j.name);
    expect(names).not.toContain('fit');
    expect(names).not.toContain('bootstrap');
    expect(names).toContain('rss'); // network-only work is not held
    markFinished(state, 'materializer', due + 1000);
    markFinished(state, 'score', due + 1000);
    names = nextStarts(config, state, due + 2000).map((j) => j.name);
    expect(names).toContain('fit');
    expect(names.filter((n) => n === 'bootstrap' || n === 'score' || n === 'materializer')).toHaveLength(0);
    markStarted(state, 'fit', due + 2000);
    names = nextStarts(config, state, due + 3000).map((j) => j.name);
    expect(names.filter((n) => n === 'bootstrap' || n === 'score' || n === 'materializer')).toHaveLength(0);
  });
});

describe('overdue', () => {
  it('names a job that has run past its ceiling plus grace, and nothing younger', () => {
    const t0 = at('2026-11-20T10:00:00');
    const state = createSchedulerState(config, t0);
    markStarted(state, 'rss', t0);
    expect(overdue(config, state, t0 + 300_000 + 59_000, 60_000)).toEqual([]);
    expect(overdue(config, state, t0 + 300_000 + 61_000, 60_000)).toEqual(['rss']);
  });
});

describe('launchSpec', () => {
  it('runs one node with tsx and the egress meter, labelled with the job name, in the existing log files', () => {
    const spec = launchSpec({ ...config.jobs[3], env: { EXTRA: '1' } }, '/repo', { PATH: '/bin', NODE_OPTIONS: '--import x' } as unknown as NodeJS.ProcessEnv);
    expect(spec.command).toBe('/opt/homebrew/bin/node');
    expect(spec.command).not.toMatch(/Cellar|npx|npm/);
    expect(spec.args).toEqual(['--import', 'tsx', 'scripts/r.ts']);
    expect(spec.env).toMatchObject({ PATH: '/bin', EGRESS_JOB: 'rss', EXTRA: '1',
      NODE_OPTIONS: '--import /repo/lib/ops/egress-meter.ts' });
    expect(spec.stdout).toBe('/repo/logs/rss-launchd.log');
    expect(spec.stderr).toBe('/repo/logs/rss-launchd.err.log');
  });
});
