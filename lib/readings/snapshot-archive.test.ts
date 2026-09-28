import { encodeSnapshotParquet, decodeSnapshotParquet, snapshotKey } from './archive';
import { snapshotChecksum } from './snapshot-retention';

describe('the view_snapshots archive format', () => {
  it('keys one object per snapshot_date', () => {
    expect(snapshotKey('2025-07-01')).toBe('snapshots/day=2025-07-01/part-0.parquet');
    expect(() => snapshotKey('2025-7-1')).toThrow();
  });

  it('round-trips every column, and the checksum survives the trip', async () => {
    const rows = [
      { id: '7b2c4f0e-0000-4000-8000-000000000001', video_id: 'abc', snapshot_date: '2025-07-01', view_count: 1200,
        like_count: 30, comment_count: null, days_since_published: 400, daily_views_rate: 1.5, created_at: '2025-07-01T08:00:00.000Z' },
      { id: '7b2c4f0e-0000-4000-8000-000000000002', video_id: 'def', snapshot_date: '2025-07-01', view_count: 0,
        like_count: null, comment_count: 2, days_since_published: 31, daily_views_rate: null, created_at: null },
    ];
    const back = await decodeSnapshotParquet(await encodeSnapshotParquet(rows));
    expect(back).toEqual(rows);
    expect(snapshotChecksum(back)).toBe(snapshotChecksum(rows));
  });
});
