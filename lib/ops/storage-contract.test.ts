import {
  STORAGE_CONTRACTS, CONTRACT_THRESHOLD_MB, evaluateContracts, growthRates, evaluateGrowth, projectDisk,
  CATALOG_SIZES_SQL, type RelationSize, type StorageSnapshot,
} from './storage-contract';

const MB = 1024 * 1024;
const rel = (name: string, mb: number, o: Partial<RelationSize> = {}): RelationSize => ({
  name, kind: 'r', totalBytes: mb * MB, heapBytes: mb * MB, toastBytes: 0, indexBytes: 0,
  liveTuples: 1000, deadTuples: 0, estBloatPct: 0, ...o,
});

describe('every table over the threshold must declare how it is kept bounded', () => {
  it('declares each table at most once, with a positive budget and an enforcement note', () => {
    const names = STORAGE_CONTRACTS.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
    for (const c of STORAGE_CONTRACTS) {
      expect(c.budgetMb).toBeGreaterThan(0);
      expect(c.enforcedBy.length).toBeGreaterThan(10);
      if (c.policy === 'append-forever') expect(c.maxGrowthMbPerDay).toBeDefined();
    }
  });

  it('fails an undeclared table the moment it crosses the threshold', () => {
    const v = evaluateContracts([rel('brand_new_log', CONTRACT_THRESHOLD_MB + 1)], STORAGE_CONTRACTS);
    expect(v).toEqual([expect.objectContaining({ table: 'brand_new_log', kind: 'undeclared' })]);
  });

  it('ignores an undeclared table below the threshold', () => {
    expect(evaluateContracts([rel('tiny', 1)], STORAGE_CONTRACTS)).toEqual([]);
  });

  it('fails a declared table over its budget, and says by how much', () => {
    // video_score_history on 2026-09-26: 1,392 MB against a 14-day retention that should hold ~130 MB.
    const v = evaluateContracts([rel('video_score_history', 1392)], STORAGE_CONTRACTS);
    expect(v[0]).toMatchObject({ table: 'video_score_history', kind: 'over-budget' });
    expect(v[0].message).toMatch(/1,392 MB.*budget 600 MB/);
  });

  it('flags heavy bloat on a big table even when it is within budget', () => {
    const v = evaluateContracts([rel('videos', 4000, { estBloatPct: 65 })], STORAGE_CONTRACTS);
    expect(v.map((x) => x.kind)).toContain('bloat');
  });
});

describe('growth, from daily snapshots', () => {
  const snap = (day: number, sizes: Record<string, number>, used?: number): StorageSnapshot => ({
    at: new Date(Date.UTC(2026, 8, day, 11)).toISOString(),
    dbBytes: Object.values(sizes).reduce((a, b) => a + b, 0) * MB,
    disk: used == null ? null : { sizeBytes: 28_422_983_680, availBytes: 28_422_983_680 - used * MB },
    relations: Object.entries(sizes).map(([n, mb]) => rel(n, mb)),
  });

  it('computes MB/day per table across the window', () => {
    const r = growthRates([snap(19, { rss_samples: 2400 }), snap(26, { rss_samples: 2962 })], 7);
    expect(r.get('rss_samples')).toBeCloseTo(80.3, 1);
  });

  it('needs at least a day of history before it will state a rate', () => {
    expect(growthRates([snap(26, { a: 1 })], 7).size).toBe(0);
  });

  it('alerts when an append-forever table grows faster than it declared', () => {
    // view_snapshots: no retention, declared at 15 MB/day.
    const rates = new Map([['view_snapshots', 40]]);
    const v = evaluateGrowth(rates, STORAGE_CONTRACTS, new Map([['view_snapshots', 1008]]));
    expect(v[0]).toMatchObject({ table: 'view_snapshots', kind: 'growth' });
    expect(v[0].message).toMatch(/40 MB\/day.*budget in 7 days/);
  });

  it('projects days until the disk reaches the autoscale trigger', () => {
    // 17,100 MiB used of a 27,106 MiB volume, growing 400 MiB/day → 90 % (24,395 MiB) in ~18 days.
    const snaps = [snap(19, { x: 1 }, 14_300), snap(26, { x: 1 }, 17_100)];
    const p = projectDisk(snaps, 0.9)!;
    expect(p.usedFraction).toBeCloseTo(0.63, 2);
    expect(p.mbPerDay).toBeCloseTo(400, 0);
    expect(p.daysToThreshold).toBeGreaterThan(17.5);
    expect(p.daysToThreshold).toBeLessThan(19);
  });

  it('returns null when the disk metrics were unavailable', () => {
    expect(projectDisk([snap(19, { x: 1 }), snap(26, { x: 1 })], 0.9)).toBeNull();
  });
});

describe('the catalog query', () => {
  it('reads sizes from the catalog only — no table is scanned', () => {
    expect(CATALOG_SIZES_SQL).toMatch(/pg_total_relation_size/);
    expect(CATALOG_SIZES_SQL).toMatch(/from pg_class c/);
    expect(CATALOG_SIZES_SQL).not.toMatch(/count\(\*\)/);
    expect(CATALOG_SIZES_SQL).not.toMatch(/pgstattuple/);
  });

  it('rolls partitions up into their parent and never lists a partition on its own', () => {
    expect(CATALOG_SIZES_SQL).toMatch(/pg_partition_tree/);
    expect(CATALOG_SIZES_SQL).toMatch(/not c\.relispartition/);
  });

  it('is byte-bounded: a size floor and a row limit', () => {
    expect(CATALOG_SIZES_SQL).toMatch(/> 1048576/);
    expect(CATALOG_SIZES_SQL).toMatch(/limit 300/);
  });
});
