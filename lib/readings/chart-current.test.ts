import { readCurrentChart, MAX_CHART_STATE_BYTES, MAX_CHART_METADATA_BYTES } from './chart-current';
import { emptyObservationState, applyObservationChanges, encodeObservationState } from '../scoring/observation-state';
import { readOrRequestCurrentChart, REQUEST_CHART_BOOTSTRAP_SQL } from './chart-current';
const at = '2026-09-18T12:00:00.000Z';
const state = applyObservationChanges(emptyObservationState('v', at), [
  { videoId: 'v', changeId: 3, source: 'sample', operation: 'upsert', at, views: 321 },
]);
const row = () => ({ obs: encodeObservationState(state), built_at: at, last_change_id: '3',
  metadata: { published_at: at, thumbs: [], titles: [] } });

test('missing compact history requests bounded background recovery without reading raw history', async () => {
  const query = jest.fn().mockResolvedValue([]);
  expect(await readOrRequestCurrentChart('v', query)).toBeNull();
  expect(query).toHaveBeenLastCalledWith(REQUEST_CHART_BOOTSTRAP_SQL, ['v']);
  expect(REQUEST_CHART_BOOTSTRAP_SQL).not.toMatch(/\b(view_samples|rss_samples|view_snapshots)\b/);
});

test('current charts do not write a recovery request', async () => {
  const query = jest.fn().mockResolvedValue([row()]);
  expect(await readOrRequestCurrentChart('v', query)).not.toBeNull();
  expect(query).toHaveBeenCalledTimes(1);
});

test('one byte-bounded indexed query returns the current chart without raw source tables', async () => {
  const query = jest.fn().mockResolvedValue([row()]);
  expect((await readCurrentChart('v', query))?.samples).toEqual([{ at, views: 321 }]);
  expect(query).toHaveBeenCalledTimes(1);
  const [sql, args] = query.mock.calls[0];
  expect(args).toEqual(['v', MAX_CHART_STATE_BYTES, MAX_CHART_METADATA_BYTES]);
  expect(sql).not.toMatch(/\b(view_samples|rss_samples|view_snapshots)\b/);
});

test.each(['absent', 'over-budget', 'corrupt', 'wrong-video', 'watermark-mismatch'])(
  'a %s compact state never becomes a raw-history fallback', async (reason) => {
    const r = row();
    if (reason === 'over-budget') r.obs = null as any;
    if (reason === 'corrupt') r.obs = Buffer.from('corrupt');
    if (reason === 'wrong-video') r.obs = encodeObservationState({ ...state, videoId: 'other' });
    if (reason === 'watermark-mismatch') r.last_change_id = '4';
    const query = jest.fn().mockResolvedValue(reason === 'absent' ? [] : [r]);
    expect(await readCurrentChart('v', query)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
