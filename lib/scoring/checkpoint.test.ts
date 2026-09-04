import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readScoreCheckpoint, validateScoreCheckpointScope, writeScoreCheckpoint } from './checkpoint';
import { walkIncrementalScoreTargets } from './target-selection';

const rows = [
  { id: 'z', channel_id: 'c', published_at: '2026-01-01 00:00:00.123456+00' },
  { id: 'a', channel_id: 'c', published_at: '2026-01-01 00:00:00.123456+00' },
  { id: 'old', channel_id: 'c', published_at: '2025-01-01 00:00:00+00' },
];
const fetchPage = async (cursor: any, limit: number) => rows.filter(r => !cursor || r.published_at < cursor.publishedAt || (r.published_at === cursor.publishedAt && r.id < cursor.id)).slice(0, limit);

test('an interrupted window does not advance and retry preserves tied microseconds', async () => {
  const saved: any[] = [];
  await walkIncrementalScoreTargets({ limit: 3, signal: new AbortController().signal, fetchPage,
    onPage: async () => false, onCheckpoint: c => { saved.push(c); } });
  expect(saved).toEqual([]);
  const seen: string[] = [];
  await walkIncrementalScoreTargets({ limit: 3, signal: new AbortController().signal, fetchPage,
    onPage: async page => { seen.push(...page.map(r => r.id)); return true; }, onCheckpoint: c => saved.push(c) });
  expect(seen).toEqual(['z', 'a', 'old']);
  expect(saved[0]).toEqual({ publishedAt: '2025-01-01 00:00:00+00', id: 'old' });
});

test('resumes below a durable cursor and marks the exhausted corpus complete', async () => {
  let complete = 0; const seen: string[] = [];
  await walkIncrementalScoreTargets({ limit: 10, initialCursor: { publishedAt: rows[0].published_at, id: 'z' }, signal: new AbortController().signal, fetchPage,
    onPage: async page => { seen.push(...page.map(r => r.id)); }, onComplete: () => { complete++; } });
  expect(seen).toEqual(['a', 'old']); expect(complete).toBe(1);
});

test('checkpoint files replace atomically and persist completion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-checkpoint-')); const file = path.join(dir, 'cursor.json');
  expect(readScoreCheckpoint(file)).toBeNull();
  writeScoreCheckpoint(file, { complete: false, cursor: { publishedAt: rows[0].published_at, id: 'z' } });
  expect(readScoreCheckpoint(file)).toEqual({ complete: false, cursor: { publishedAt: rows[0].published_at, id: 'z' } });
  writeScoreCheckpoint(file, { complete: true }); expect(readScoreCheckpoint(file)).toEqual({ complete: true });
  fs.rmSync(dir, { recursive: true });
});

test('rejects dry-run and channel-scoped cursors that could skip the full corpus', () => {
  const base = { all: true, force: false, since: null, final: false, fit: false, v5: false, channels: [] as string[] };
  expect(() => validateScoreCheckpointScope(base)).not.toThrow();
  expect(() => validateScoreCheckpointScope({ ...base, v5: true })).toThrow('unfiltered incremental --all');
  expect(() => validateScoreCheckpointScope({ ...base, channels: ['c'] })).toThrow('unfiltered incremental --all');
  expect(() => validateScoreCheckpointScope({ ...base, force: true })).toThrow('unfiltered incremental --all');
});
