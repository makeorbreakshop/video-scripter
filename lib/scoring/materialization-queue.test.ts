import fs from 'node:fs';
import path from 'node:path';
import {
  OBS_DIRTY_CLAIM_SQL,
  OBS_DIRTY_CLEAR_SQL,
  SCORE_DIRTY_CLEAR_SQL,
  ensureObservationMaterializationSql,
  scoreDirtyTargetsSql,
  walkScoreDirtyTargets,
} from './materialization-queue';

test('observation work is claimed without holding ingest-blocking locks and cleared by exact generation', () => {
  expect(OBS_DIRTY_CLAIM_SQL).toMatch(/limit \$1/i);
  expect(OBS_DIRTY_CLAIM_SQL).not.toMatch(/for update/i);
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
  expect(sql).toMatch(/function public\.queue_new_video_bootstraps/i);
  expect(sql).toMatch(/join public\.videos v on v\.id=x\.video_id/i);
  expect(sql).toMatch(/jsonb_array_elements\(p_rows\) with ordinality/i);
  expect(sql).toMatch(/order by item\.position/i);
  expect(sql).toContain('observation_change_log');
  expect(sql).toContain('obs_cache_dirty');
  expect(sql).toContain('score_dirty');
  expect(sql.match(/join public\.videos v on v\.id=p\.video_id/gi)?.length).toBeGreaterThanOrEqual(3);
  expect(sql).toMatch(/coalesce\(v\.import_date\s*>=\s*m\.capture_started_at,\s*false\)/i);
  expect(sql).toMatch(/sc\.scored_at\s*\+\s*case/i);
  expect(sql).toMatch(/when public\.score_dirty\.reason\s*=\s*'model-rollout'/i);
  expect(sql).toMatch(/least\(public\.score_dirty\.not_before,\s*excluded\.not_before\)/i);
  for (const source of ['snapshot', 'sample', 'rss']) {
    expect(sql).toMatch(new RegExp(`function public\\.queue_${source}_updates`, 'i'));
  }
  expect(sql.match(/referencing old table as old_rows new table as new_rows/gi)?.length).toBe(3);
  expect(sql.match(/jsonb_agg\(payload order by phase\)/gi)?.length).toBe(3);
  expect(sql).toMatch(/revoke all on table[\s\S]*from anon, authenticated/i);
});

test('cache misses request delta work without forcing healthy v2 rows into bootstrap', () => {
  const q = ensureObservationMaterializationSql(['a', 'a', 'b']);
  expect(q.values).toEqual([['a', 'b']]);
  expect(q.text).toContain('obs_cache_dirty');
  expect(q.text).toContain('video_obs_cache');
  expect(q.text).toMatch(/format\s*=\s*2/i);
});

test('the score queue walker never fetches or processes more than 100 at once', async () => {
  const pending = Array.from({ length: 205 }, (_, i) => ({
    id: `v${i}`, channel_id: 'c', published_at: '2026-09-01', generation: String(i + 1),
  }));
  const pages: number[] = [];
  const selected = await walkScoreDirtyTargets({
    limit: 205,
    signal: new AbortController().signal,
    fetchPage: async (limit) => pending.splice(0, limit),
    onPage: async (page) => { pages.push(page.length); },
  });
  expect(selected).toBe(205);
  expect(pages).toEqual([100, 100, 5]);
});
