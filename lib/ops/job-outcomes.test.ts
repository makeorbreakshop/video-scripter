import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendOutcome, readOutcomes, detectSilentJobs, type JobOutcome, type Heartbeat,
} from './job-outcomes';

// THE FAILURE MODE THIS EXISTS FOR. A scheduled job that decides not to work and exits 0 looks,
// to launchd and to every monitor that watches exit codes, exactly like a job that worked.
// 2026-09-14 .. 09-26: null-video-text stood down 12 nights in a row, each logged "Not a
// failure". 2026-09-10 .. 09-26: check-supabase-egress.py threw on every run and nobody
// looked at its error log. Both were silent because success was defined as "did not crash".
// Here success is defined as "made progress, or had nothing to do" — and the ledger says which.

const at = (d: number, h = 6) => new Date(Date.UTC(2026, 8, d, h + 4)).toISOString();
const run = (job: string, d: number, o: Partial<JobOutcome> = {}): JobOutcome =>
  ({ job, at: at(d), status: 'progressed', progressed: 1, backlog: 0, ...o });
const NOW = new Date(Date.UTC(2026, 8, 26, 12));

const nullOut: Heartbeat = { kind: 'ledger', job: 'null-video-text', everyHours: 24, maxSilentRuns: 3 };

describe('detecting a job that keeps choosing not to work', () => {
  it('replays 2026-09-15..26: alerts on the third consecutive stand-down, not the twelfth', () => {
    const nights = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    const unmoved = [10, 5487, 10312, 2, 3386, 3298, 2812, 10516, 16972, 25276, 38, 4866];
    const ledger = nights.map((d, i) =>
      run('null-video-text', d, { status: 'stood_down', progressed: 0, backlog: unmoved[i] }));
    expect(detectSilentJobs(ledger.slice(0, 2), [nullOut], new Date(at(16, 7)))).toEqual([]);
    const third = detectSilentJobs(ledger.slice(0, 3), [nullOut], new Date(at(17, 7)));
    expect(third).toHaveLength(1);
    expect(third[0]).toMatchObject({ job: 'null-video-text', kind: 'silent-noop' });
    expect(third[0].message).toMatch(/3 consecutive runs .*backlog 10,312/);
  });

  it('does not alert on idle runs — nothing to do is healthy', () => {
    const ledger = [20, 21, 22, 23].map((d) => run('null-video-text', d, { status: 'idle', progressed: 0, backlog: 0 }));
    expect(detectSilentJobs(ledger, [nullOut], new Date(at(23, 7)))).toEqual([]);
  });

  it('a single progressing run resets the streak', () => {
    const ledger = [
      run('null-video-text', 21, { status: 'noop', progressed: 0, backlog: 5 }),
      run('null-video-text', 22, { status: 'noop', progressed: 0, backlog: 5 }),
      run('null-video-text', 23, { status: 'progressed', progressed: 900, backlog: 5 }),
      run('null-video-text', 24, { status: 'noop', progressed: 0, backlog: 5 }),
    ];
    expect(detectSilentJobs(ledger, [nullOut], new Date(at(24, 7)))).toEqual([]);
  });

  it('alerts on repeated failures', () => {
    const ledger = [22, 23, 24].map((d) => run('null-video-text', d, { status: 'failed', progressed: 0, backlog: null }));
    expect(detectSilentJobs(ledger, [nullOut], new Date(at(24, 7)))[0]).toMatchObject({ kind: 'failing' });
  });

  it('alerts when a job has stopped reporting at all (missed two cadences)', () => {
    const ledger = [run('null-video-text', 20)];
    const alerts = detectSilentJobs(ledger, [nullOut], NOW);
    expect(alerts[0]).toMatchObject({ job: 'null-video-text', kind: 'stale' });
  });

  it('alerts when a job has never reported', () => {
    expect(detectSilentJobs([], [nullOut], NOW)[0]).toMatchObject({ kind: 'stale' });
  });

  it('ignores other jobs\' records', () => {
    const ledger = [24, 25, 26].map((d) => run('other', d, { status: 'noop', progressed: 0, backlog: 9 }));
    expect(detectSilentJobs([...ledger, run('null-video-text', 26)], [nullOut], NOW)).toEqual([]);
  });
});

describe('file heartbeats, for jobs that do not write the ledger', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('flags a log that has not been written in longer than its cadence allows', () => {
    // check-supabase-egress.py: last real line 2026-09-09, every run since has thrown.
    const f = path.join(dir, 'supabase-egress-check.log');
    fs.writeFileSync(f, '2026-09-09 09:00 egress 78.4 GB/day\n');
    const old = new Date(Date.UTC(2026, 8, 9, 13)).getTime() / 1000;
    fs.utimesSync(f, old, old);
    const hb: Heartbeat = { kind: 'file', job: 'supabase-egress-check', path: f, everyHours: 24 };
    const alerts = detectSilentJobs([], [hb], NOW);
    expect(alerts[0]).toMatchObject({ job: 'supabase-egress-check', kind: 'stale' });
  });

  it('flags a missing file as stale rather than throwing', () => {
    const hb: Heartbeat = { kind: 'file', job: 'x', path: path.join(dir, 'nope.log'), everyHours: 24 };
    expect(detectSilentJobs([], [hb], NOW)[0]).toMatchObject({ kind: 'stale' });
  });

  it('flags a fresh file whose last line matches a failure pattern', () => {
    const f = path.join(dir, 'a.log');
    fs.writeFileSync(f, 'ok\narchive-then-thin: archive=1 thin=0\n');
    const hb: Heartbeat = { kind: 'file', job: 'archive', path: f, everyHours: 24, failIfLastLine: /archive=[1-9]|thin=[1-9]/ };
    expect(detectSilentJobs([], [hb], new Date())[0]).toMatchObject({ kind: 'failing' });
  });
});

describe('the ledger file', () => {
  let file: string;
  beforeEach(() => { file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')), 'job-outcomes.jsonl'); });

  it('appends and reads back, newest last', () => {
    appendOutcome(run('a', 24), file);
    appendOutcome(run('a', 25, { status: 'noop', progressed: 0, backlog: 3 }), file);
    const got = readOutcomes(file);
    expect(got.map((o) => o.at)).toEqual([at(24), at(25)]);
    expect(got[1].backlog).toBe(3);
  });

  it('skips a torn line instead of failing the whole read', () => {
    appendOutcome(run('a', 24), file);
    fs.appendFileSync(file, '{"job":"a","at":\n');
    appendOutcome(run('a', 25), file);
    expect(readOutcomes(file)).toHaveLength(2);
  });

  it('returns [] for a ledger that does not exist yet', () => {
    expect(readOutcomes(path.join(os.tmpdir(), 'does-not-exist-ledger.jsonl'))).toEqual([]);
  });

  it('stays bounded: an oversized ledger is trimmed to its newest lines on append', () => {
    const big = JSON.stringify(run('a', 1)) + '\n';
    fs.writeFileSync(file, big.repeat(20_000)); // ~2+ MB
    appendOutcome(run('a', 26), file, { maxBytes: 200_000 });
    expect(fs.statSync(file).size).toBeLessThanOrEqual(200_000);
    expect(readOutcomes(file).at(-1)?.at).toBe(at(26));
  });

  it('never throws into the job that is recording — a ledger failure must not fail the work', () => {
    expect(() => appendOutcome(run('a', 26), '/dev/null/cannot/write.jsonl')).not.toThrow();
  });
});

describe('a mixed tail of failures and no-ops is still silent (review P2-1)', () => {
  it('alerts on failed, noop, failed', () => {
    const hb: Heartbeat = { kind: 'ledger', job: 'j', everyHours: 24, maxSilentRuns: 3 };
    const ledger = [
      run('j', 22, { status: 'failed', progressed: 0, backlog: null }),
      run('j', 23, { status: 'noop', progressed: 0, backlog: 5 }),
      run('j', 24, { status: 'failed', progressed: 0, backlog: null }),
    ];
    expect(detectSilentJobs(ledger, [hb], new Date(at(24, 7)))[0]).toMatchObject({ kind: 'silent-noop' });
  });
});
