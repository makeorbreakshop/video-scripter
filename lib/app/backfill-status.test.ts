import { backfillStatus, progressPercent } from './backfill-status';

const NOW = new Date('2026-09-03T12:00:00Z');
const job = (o: Partial<any> = {}) => ({ status: 'running', windows_total: 40, windows_done: 10, cursor_date: '2026-09-02', ...o }) as any;

describe('progressPercent', () => {
  it('reports whole percent, and nothing when the size is unknown', () => {
    expect(progressPercent(job())).toBe(25);
    expect(progressPercent(job({ windows_total: 0 }))).toBeNull();
  });
});

describe('backfillStatus', () => {
  it('tells a waiting user what is happening and roughly when', () => {
    const v = backfillStatus(job({ status: 'queued' }), null, NOW);
    expect(v.label).toBe('Waiting to import');
    expect(v.detail).toMatch(/queue/);
  });
  it('shows progress while running and says they can walk away', () => {
    const v = backfillStatus(job(), null, NOW);
    expect(v.label).toBe('Importing history');
    expect(v.detail).toBe('25% done. Imported through yesterday. You can leave this page.');
  });
  it('confirms completion and the ongoing cadence', () => {
    const v = backfillStatus(job({ status: 'done', windows_done: 40 }), '2026-09-03T05:00:00Z', NOW);
    expect(v).toMatchObject({ label: 'History imported', tone: 'good', percent: 100 });
    expect(v.detail).toBe('Updated daily. Last run today.');
  });
  it('explains a failure and that it retries, without blaming the user', () => {
    const v = backfillStatus(job({ status: 'failed', error: 'YouTube rate limited us.' }), null, NOW);
    expect(v.detail).toBe('YouTube rate limited us. We will try again tonight.');
    expect(v.tone).toBe('bad');
  });
  it('falls back sensibly when there is no job row', () => {
    expect(backfillStatus(null, '2026-09-01T00:00:00Z', NOW).detail).toBe('Last updated 2 days ago.');
    expect(backfillStatus(null, null, NOW).label).toBe('Connected');
  });
});
