import fs from 'node:fs';
import path from 'node:path';
import {
  OBS_DIRTY_CLAIM_SQL,
  OBS_DIRTY_CLEAR_SQL,
  SCORE_DIRTY_CLEAR_SQL,
  scoreDirtyTargetsSql,
} from './materialization-queue';

test('observation work is claimed in bounded lock-safe pages and cleared by exact generation', () => {
  expect(OBS_DIRTY_CLAIM_SQL).toMatch(/limit \$1/i);
  expect(OBS_DIRTY_CLAIM_SQL).toMatch(/for update[^;]*skip locked/i);
  expect(OBS_DIRTY_CLAIM_SQL).toMatch(/not d\.requires_bootstrap/i);
  expect(OBS_DIRTY_CLEAR_SQL).toMatch(/generation\s*=\s*x\.generation/i);
  expect(SCORE_DIRTY_CLEAR_SQL).toMatch(/generation\s*=\s*x\.generation/i);
});

test('the live scorer selects only the bounded queue and applies age-aware cadence', () => {
  const q = scoreDirtyTargetsSql({ limit: 100, channels: [] });
  expect(q.text).toContain('from score_dirty');
  expect(q.text).toContain('video_scores');
  expect(q.text).toContain("interval '1 hour'");
  expect(q.text).toContain("interval '1 day'");
  expect(q.text).toContain("interval '3 days'");
  expect(q.text).toContain("interval '7 days'");
  expect(q.text).not.toMatch(/rss_samples|view_samples|view_snapshots/);
  expect(q.values).toEqual([100]);
  expect(() => scoreDirtyTargetsSql({ limit: 101, channels: [] })).toThrow('100');
});

test('the migration captures every source at statement scope and protects internal queues', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260911153000_event_driven_scoring.sql'), 'utf8');
  for (const table of ['view_snapshots', 'view_samples', 'rss_samples']) {
    expect(sql).toMatch(new RegExp(`on public\\.${table}`, 'i'));
  }
  expect(sql.match(/for each statement/gi)?.length).toBeGreaterThanOrEqual(9);
  expect(sql).toContain('observation_change_log');
  expect(sql).toContain('obs_cache_dirty');
  expect(sql).toContain('score_dirty');
  expect(sql).toMatch(/revoke all on table[\s\S]*from anon, authenticated/i);
});
