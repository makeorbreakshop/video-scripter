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
  it('says what is happening while queued, without inventing a wait time', () => {
    const v = backfillStatus(job({ status: 'queued' }), null, NOW);
    expect(v).toMatchObject({ label: 'Queued', detail: 'Waiting to import history' });
  });
  it('shows progress and how far back it has got', () => {
    const v = backfillStatus(job(), null, NOW);
    expect(v).toMatchObject({ label: 'Importing', detail: '25% · through yesterday' });
  });
  it('states the ongoing cadence once finished', () => {
    const v = backfillStatus(job({ status: 'done', windows_done: 40 }), '2026-09-03T05:00:00Z', NOW);
    expect(v).toMatchObject({ label: 'Synced', tone: 'good', percent: 100, detail: 'Updated daily · last run today' });
  });
  it('surfaces the failure and that it retries, without blaming the user', () => {
    const v = backfillStatus(job({ status: 'failed', error: 'YouTube rate limited us' }), null, NOW);
    expect(v).toMatchObject({ label: 'Stopped', tone: 'bad', detail: 'YouTube rate limited us · retries tonight' });
  });
  it('falls back sensibly when there is no job row', () => {
    expect(backfillStatus(null, '2026-09-01T00:00:00Z', NOW).detail).toBe('Last run 2 days ago');
    expect(backfillStatus(null, null, NOW).label).toBe('Connected');
  });
});
