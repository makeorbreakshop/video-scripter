import { buildGuardReport, parseDiskMetrics, DISK_WARN_DAYS } from './storage-guard';
import type { StorageSnapshot, RelationSize } from './storage-contract';

const MB = 1024 * 1024;
const rel = (name: string, mb: number, o: Partial<RelationSize> = {}): RelationSize => ({
  name, kind: 'r', totalBytes: mb * MB, heapBytes: mb * MB, toastBytes: 0, indexBytes: 0,
  liveTuples: 1, deadTuples: 0, estBloatPct: 0, ...o,
});
const SIZE = 28_422_983_680;
const snap = (day: number, usedMb: number, rels: RelationSize[]): StorageSnapshot => ({
  at: new Date(Date.UTC(2026, 8, day, 11)).toISOString(), dbBytes: 0,
  disk: { sizeBytes: SIZE, availBytes: SIZE - usedMb * MB }, relations: rels,
});

describe('the daily guard report', () => {
  it('is clean when every table is within contract and the disk has months of room', () => {
    const r = buildGuardReport([snap(19, 10_000, [rel('videos', 4000)]), snap(26, 10_070, [rel('videos', 4010)])], [], []);
    expect(r.status).toBe('pass');
    expect(r.alerts).toEqual([]);
    expect(r.summary).toMatch(/disk 37 % of 27,106 MB/);
  });

  it('warns when the disk will reach the 90 % autoscale trigger within the warning window', () => {
    // The 2026-09 trajectory: ~400 MB/day with 17 GB of 27 GB used.
    const r = buildGuardReport([snap(19, 14_300, []), snap(26, 17_100, [])], [], []);
    expect(r.status).toBe('warn');
    expect(r.alerts.join('\n')).toMatch(/90 % autoscale trigger in 18 days at 400 MB\/day/);
    expect(DISK_WARN_DAYS).toBeGreaterThanOrEqual(30);
  });

  it('carries contract, growth and job alerts through', () => {
    const r = buildGuardReport(
      [snap(19, 10_000, [rel('video_score_history', 1392)]), snap(26, 10_000, [rel('video_score_history', 1392), rel('new_log', 50)])],
      [], [{ kind: 'ledger', job: 'null-video-text', everyHours: 24, maxSilentRuns: 3 }],
      new Date(Date.UTC(2026, 8, 26, 12)));
    const all = r.alerts.join('\n');
    expect(all).toMatch(/video_score_history is 1,392 MB/);
    expect(all).toMatch(/new_log is 50 MB and has no storage contract/);
    expect(all).toMatch(/null-video-text: no outcome ever recorded/);
    expect(r.status).toBe('warn');
  });

  it('says so when the disk metrics could not be read — a blind guard is not a passing guard', () => {
    const s = { ...snap(26, 0, []), disk: null };
    const r = buildGuardReport([s], [], []);
    expect(r.alerts.join('\n')).toMatch(/disk metrics unavailable/);
  });
});

describe('reading the data volume from the Prometheus text', () => {
  const text = [
    '# HELP node_filesystem_avail_bytes x',
    'node_filesystem_avail_bytes{device="/dev/nvme0n1p2",fstype="ext4",mountpoint="/"} 3.38e+09',
    'node_filesystem_avail_bytes{device="/dev/nvme1n1",fstype="ext4",mountpoint="/data"} 1.1277623296e+10',
    'node_filesystem_size_bytes{device="/dev/nvme1n1",fstype="ext4",mountpoint="/data"} 2.842298368e+10',
    'node_filesystem_size_bytes{device="/dev/nvme0n1p2",fstype="ext4",mountpoint="/"} 1.03e+10',
  ].join('\n');

  it('takes the /data mount, not the root filesystem', () => {
    expect(parseDiskMetrics(text)).toEqual({ sizeBytes: 28_422_983_680, availBytes: 11_277_623_296 });
  });

  it('returns null when the mount is missing', () => {
    expect(parseDiskMetrics('node_cpu_seconds_total 1')).toBeNull();
  });
});

describe('temp-file spills', () => {
  const GB = 1024 ** 3;
  const t = (day: number, tempGb: number): StorageSnapshot => ({ ...snap(day, 10_000, []), tempBytes: tempGb * GB });

  it('reports the daily spill rate and stays quiet below the threshold', () => {
    const r = buildGuardReport([t(25, 100), t(26, 103.5)], [], []);
    expect(r.summary).toMatch(/temp spills 3\.5 GB\/day/);
    expect(r.alerts).toEqual([]);
  });

  it('alerts above it', () => {
    const r = buildGuardReport([t(25, 100), t(26, 160)], [], []);
    expect(r.alerts.join(' ')).toMatch(/temp-file spills 60\.0 GB\/day/);
  });

  it('ignores an interval across a stats reset', () => {
    const r = buildGuardReport([t(25, 900), t(26, 2)], [], []);
    expect(r.alerts).toEqual([]);
  });
});
