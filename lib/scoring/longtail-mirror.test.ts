import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findExportMirror, fitInputsFromMirrors, longtailRowsFromMirrors } from './longtail-mirror';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const DAY = 86_400_000;
let dir: string;

function mirror(file: string, bodies: Record<string, unknown>[], meta: Record<string, string>) {
  const db = new DatabaseSync(path.join(dir, file));
  db.exec(`CREATE TABLE rows(key TEXT PRIMARY KEY,hash TEXT NOT NULL,body TEXT NOT NULL,seen INTEGER NOT NULL) WITHOUT ROWID;
           CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;`);
  const put = db.prepare('INSERT INTO rows VALUES(?,?,?,1)');
  bodies.forEach((b, i) => put.run(String(i), 'x', JSON.stringify(b)));
  const m = db.prepare('INSERT INTO metadata VALUES(?,?)');
  for (const [k, v] of Object.entries(meta)) m.run(k, v);
  db.close();
  return path.join(dir, file);
}
const fresh = { 'synced-at': new Date(NOW - 3_600_000).toISOString(), identity: JSON.stringify({ host: 'db.example' }) };
const snap = (video_id: string, d: number, view_count: number, snapshot_date = '2026-10-01') =>
  ({ video_id, days_since_published: d, view_count, snapshot_date });
const vid = (id: string, ageDays: number, view_count: number, is_longform = true) =>
  ({ id, published_at: new Date(NOW - ageDays * DAY).toISOString(), view_count, is_longform });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'longtail-mirror-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('longtailRowsFromMirrors', () => {
  it('reproduces the Postgres long-tail query: day-30 base, lifetime count, and later snapshots', () => {
    const s = mirror('view_snapshots-a.sqlite', [
      snap('A', 26, 50), snap('A', 29, 90), snap('A', 31, 100), snap('A', 34, 120), // base = d29? no: |29-30|=|31-30|, earlier day wins
      snap('A', 60, 200), snap('A', 90, 0), snap('A', 120, 300),
      snap('B', 30, 10), snap('B', 70, 20), // B is a Short: excluded everywhere
      snap('C', 28, 0), snap('C', 32, 40), // zero reading never becomes the base
      snap('D', 10, 5), snap('D', 80, 9), // no day-27..33 reading: no base
    ], fresh);
    const v = mirror('videos-a.sqlite', [vid('A', 400, 1000), vid('B', 400, 50, false), vid('C', 45, 70), vid('D', 400, 9)], fresh);
    const rows = longtailRowsFromMirrors(s, v, { now: NOW, maxAgeMs: DAY, host: 'db.example' });
    const key = (r: { v30: number; lifetime: number; age: number }) => `${r.v30}/${r.lifetime}/${Math.round(r.age)}`;
    expect(rows.map(key).sort()).toEqual(['90/1000/400', '90/200/60', '90/300/120'].sort());
  });

  it('refuses a mirror the nightly export has not refreshed recently, instead of reading production', () => {
    const stale = { ...fresh, 'synced-at': new Date(NOW - 3 * DAY).toISOString() };
    const s = mirror('view_snapshots-a.sqlite', [], stale);
    const v = mirror('videos-a.sqlite', [], fresh);
    expect(() => longtailRowsFromMirrors(s, v, { now: NOW, maxAgeMs: DAY, host: 'db.example' })).toThrow(/stale/);
  });

  it('refuses a mirror with no sync stamp or of another database', () => {
    const s = mirror('view_snapshots-a.sqlite', [], { identity: fresh.identity });
    const v = mirror('videos-a.sqlite', [], fresh);
    expect(() => longtailRowsFromMirrors(s, v, { now: NOW, maxAgeMs: DAY, host: 'db.example' })).toThrow(/synced-at/);
    expect(() => longtailRowsFromMirrors(v, v, { now: NOW, maxAgeMs: DAY, host: 'other.example' })).toThrow(/database/);
  });
});

describe('fitInputsFromMirrors past-30 pairs', () => {
  it('pairs the in-window day-30 reading of a long-form video with each later snapshot', () => {
    const s = mirror('view_snapshots-a.sqlite', [
      snap('A', 30, 100, '2026-06-01'), snap('A', 65, 150, '2026-07-06'), snap('A', 95, 0, '2026-08-05'),
      snap('O', 30, 7, '2024-01-01'), snap('O', 70, 9, '2024-02-10'), // day-30 reading outside 12 months
      snap('S', 30, 5, '2026-06-01'), snap('S', 70, 6, '2026-07-10'), // a Short
    ], fresh);
    const v = mirror('videos-a.sqlite', [vid('A', 200, 900), vid('O', 1000, 9), vid('S', 200, 6, false)], fresh);
    const inputs = fitInputsFromMirrors(s, v, { now: NOW, maxAgeMs: DAY, host: 'db.example', pastMonths: [12, 120] });
    expect(inputs.past30[12]).toEqual([{ laterAge: 65, v30: 100, later: 150 }]);
    expect(inputs.past30[120]).toEqual(expect.arrayContaining([{ laterAge: 65, v30: 100, later: 150 }, { laterAge: 70, v30: 7, later: 9 }]));
    expect(inputs.past30[120]).toHaveLength(2);
  });
});

describe('findExportMirror', () => {
  it('finds the one mirror for a table, and refuses ambiguity', () => {
    mirror('videos-1111.sqlite', [], fresh);
    expect(findExportMirror(dir, 'videos')).toBe(path.join(dir, 'videos-1111.sqlite'));
    expect(() => findExportMirror(dir, 'view_snapshots')).toThrow(/no export mirror/);
    mirror('videos-2222.sqlite', [], fresh);
    expect(() => findExportMirror(dir, 'videos')).toThrow(/2 export mirrors/);
  });
});
