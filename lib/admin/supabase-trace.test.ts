import {
  SupabaseQueryTracer,
  estimatePostgresResultBytes,
  supabaseApplicationName,
  supabaseTraceOperation,
} from './supabase-trace';

test('Supabase application names are stable, safe, and fit the Postgres limit', () => {
  expect(supabaseApplicationName('Observation Materializer')).toBe('video-scripter:observation-materializer');
  expect(supabaseApplicationName('../secret value')).not.toMatch(/[/. ]/);
  expect(Buffer.byteLength(supabaseApplicationName('x'.repeat(200)))).toBeLessThanOrEqual(63);
});

test('trace operation comes from an explicit safe marker and never from SQL values', () => {
  expect(supabaseTraceOperation('/* trace:score.cache-read */ select * from x where token=$1'))
    .toBe('score.cache-read');
  expect(supabaseTraceOperation('select * from video_obs_cache where token=$1'))
    .toBe('select:video_obs_cache');
});

test('result sizing counts returned values without serializing column names', () => {
  expect(estimatePostgresResultBytes([
    { id: 'abc', n: 12, payload: Buffer.alloc(5), missing: null },
  ])).toBe(10);
});

test('query spans and the run summary contain attribution and bounded egress facts, not SQL or params', async () => {
  const lines: string[] = [];
  const tracer = new SupabaseQueryTracer('score', (line) => lines.push(line));
  const db = {
    query: jest.fn(async () => ({ rows: [{ id: 'abc', payload: Buffer.alloc(5) }], rowCount: 1, command: 'SELECT' })),
  };
  const result = await tracer.query(db, '/* trace:score.cache-read */ select * from cache where secret=$1', ['do-not-log']);
  expect(result.rowCount).toBe(1);
  tracer.finish({ cache_hits: 1 });

  const span = JSON.parse(lines[0]);
  expect(span).toEqual(expect.objectContaining({
    type: 'supabase.query', component: 'score', operation: 'score.cache-read', status: 'ok',
    rows: 1, estimated_response_bytes: 8,
  }));
  expect(lines.join('\n')).not.toContain('do-not-log');
  expect(lines.join('\n')).not.toContain('select *');

  const summary = JSON.parse(lines[1]);
  expect(summary).toEqual(expect.objectContaining({
    type: 'supabase.run', component: 'score', status: 'ok', queries: 1,
    rows: 1, estimated_response_bytes: 8, cache_hits: 1,
  }));
  expect(summary.trace_id).toBe(span.trace_id);
});

test('failed queries emit only a safe error code and make the run fail', async () => {
  const lines: string[] = [];
  const tracer = new SupabaseQueryTracer('materializer', (line) => lines.push(line));
  const error = Object.assign(new Error('secret SQL text'), { code: '57014' });
  await expect(tracer.query({ query: async () => { throw error; } }, '/* trace:obs.claim */ select $1', ['secret']))
    .rejects.toBe(error);
  tracer.finish();
  expect(JSON.parse(lines[0])).toEqual(expect.objectContaining({ status: 'error', error_code: '57014' }));
  expect(JSON.parse(lines[1]).status).toBe('error');
  expect(lines.join('\n')).not.toContain('secret');
});

test('a non-query worker failure marks the run without inventing a failed query', () => {
  const lines: string[] = [];
  const tracer = new SupabaseQueryTracer('series-drain', (line) => lines.push(line));
  tracer.markFailed();
  tracer.finish({ busy_refusal: true });
  expect(JSON.parse(lines[0])).toEqual(expect.objectContaining({
    type: 'supabase.run', status: 'error', failures: 0, run_failed: true, busy_refusal: true,
  }));
});
