import { assessResponse, type ResponseEvidence } from './response-freshness';
const prior = '2026-09-07T11:18:17.000Z';
const evidence = (date: string | null, age: string | null = null): ResponseEvidence => ({
  fetchedAt: '2026-09-07T11:18:59.436Z', date, age, cacheControl: 'public, max-age=900',
});
test('Every older cached response cannot replace the fresher 88,694 observation', () => {
  expect(assessResponse(prior, evidence('Mon, 07 Sep 2026 11:11:24 GMT', '455')))
    .toEqual({ stale: true, responseDate: '2026-09-07T11:11:24.000Z', watermark: prior });
});
test('valid response Date works even without Age and advances the watermark', () => {
  expect(assessResponse(prior, evidence('Mon, 07 Sep 2026 11:18:59 GMT')))
    .toEqual({ stale: false, responseDate: '2026-09-07T11:18:59.000Z', watermark: '2026-09-07T11:18:59.000Z' });
});
test.each([null, '', 'nonsense', 'Mon, 07 Sep 2026 12:18:59 GMT'])('unknown/invalid/future Date %s never invents freshness or erases watermark', date => {
  expect(assessResponse(prior, evidence(date, '455'))).toEqual({ stale: false, responseDate: null, watermark: prior });
});
test('equal Date is accepted; one-second HTTP resolution cannot prove order', () => {
  expect(assessResponse(prior, evidence(prior)).stale).toBe(false);
});

import { advanceResponse, type FeedResponse } from './response-freshness';
const feed = (minute: number, dateMinute: number | null, views: number): FeedResponse => ({
  channelId: 'every', fetchedAt: `2026-09-07T11:${minute}:59.000Z`,
  date: dateMinute === null ? null : `2026-09-07T11:${dateMinute}:00.000Z`, age: null,
  cacheControl: 'public, max-age=900', views: { video: views },
});
test('fresh → stale → unchanged → fresh decrease has honest raw and accepted denominators', () => {
  let state = advanceResponse(null, feed(18, 18, 88694)).state;
  const stale = advanceResponse(state, feed(19, 11, 88653));
  expect(stale.accepted).toBe(false);
  expect(stale.state.acceptedViews.video).toBe(88694);
  expect(stale.state.rejected?.views.video).toBe(88653);
  state = advanceResponse(stale.state, feed(20, 20, 88694)).state;
  const correction = advanceResponse(state, feed(21, 21, 88000));
  expect(correction.accepted).toBe(true);
  expect(correction.state.acceptedViews.video).toBe(88000);
  expect(correction.state.counters).toEqual({ responses: 4, unknownResponses: 0, staleResponses: 1,
    readings: 4, staleDecreases: 1, unknownDecreases: 0, rawComparisons: 3, rawDecreases: 2, acceptedComparisons: 2, acceptedDecreases: 1 });
});
test('replay or out-of-order fetch cannot change state or inflate telemetry', () => {
  const response = feed(20, 20, 200);
  const state = advanceResponse(null, response).state;
  expect(advanceResponse(state, response)).toEqual({ state, accepted: false, replay: true });
  expect(advanceResponse(state, feed(19, 19, 100))).toEqual({ state, accepted: false, replay: true });
});
test('unknown freshness can decrease, retains known watermark, and is counted separately', () => {
  const state = advanceResponse(null, feed(18, 18, 100)).state;
  const unknown = advanceResponse(state, feed(19, null, 90));
  expect(unknown.accepted).toBe(true);
  expect(unknown.state.watermark).toBe('2026-09-07T11:18:00.000Z');
  expect(unknown.state.counters.unknownResponses).toBe(1);
  expect(unknown.state.counters.acceptedDecreases).toBe(1);
});
test('older response increases are rejected too; freshness is independent of count direction', () => {
  const state = advanceResponse(null, feed(18, 18, 100)).state;
  expect(advanceResponse(state, feed(19, 11, 200)).accepted).toBe(false);
});
test('the report can attribute raw decreases to rejected responses without subtracting unrelated rates', () => {
  const state = advanceResponse(null, feed(18, 18, 100)).state;
  const stale = advanceResponse(state, feed(19, 11, 90));
  expect(stale.state.counters).toMatchObject({ staleDecreases: 1, unknownDecreases: 0 });
  const unknown = advanceResponse(stale.state, feed(20, null, 80));
  expect(unknown.state.counters).toMatchObject({ staleDecreases: 1, unknownDecreases: 1 });
});

// Cache response delay is measured independently of count disagreement.
test('delay histogram counts every known response clock, including unchanged readings', () => {
  const r = { channelId: 'c', fetchedAt: '2026-09-07T12:10:00Z', date: '2026-09-07T12:00:00Z', age: '600', cacheControl: null, views: { v: 100 } };
  expect(advanceResponse(null, r).state.delayMinutes).toEqual({ under5: 0, from5to15: 1, from15to60: 0, over60: 0 });
});
