import { LAUNCH_ENROLL_SQL } from './launch-enroll';

// launch-track runs every 5 minutes. Its enrollment used to read the heap row and the latest
// view_samples row of every video published in the last 30 days (~86K) to enroll ~700:
// ~400 MB of cold reads per run (measured 2026-09-23). Unenrolled ids must be found first,
// from an index alone, and only those rows read.
describe('LAUNCH_ENROLL_SQL', () => {
  it('finds unenrolled ids before touching videos rows or view_samples', () => {
    const fresh = LAUNCH_ENROLL_SQL.indexOf('fresh as materialized');
    expect(fresh).toBeGreaterThan(-1);
    const freshBody = LAUNCH_ENROLL_SQL.slice(fresh, LAUNCH_ENROLL_SQL.indexOf('insert into track_schedule'));
    expect(freshBody).toContain('not exists (select 1 from track_schedule t where t.video_id = v.id)');
    expect(freshBody).not.toContain('view_samples');
    expect(freshBody).not.toContain('duration');
    expect(LAUNCH_ENROLL_SQL).toContain('from fresh f');
    expect(LAUNCH_ENROLL_SQL).toContain('on conflict (video_id) do nothing');
  });
});
