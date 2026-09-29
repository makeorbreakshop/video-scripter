import { Triage, TRIAGE, triageParams, SNAPSHOT_TRIAGE_SQL } from './snapshot-triage';
import type { RssEntry } from './poll-policy';

const entry = (o: Partial<RssEntry>): RssEntry => ({
  video_id: 'v', channel_id: 'c', title: 't', description: null, published: null, updated: null,
  views: 10, likes: null, ...o,
});

describe('Triage', () => {
  const t = new Triage();
  t.add([
    { id: 'unknown', mask: 0 },
    { id: 'unknown-new-reading', mask: TRIAGE.SAMPLE, last_views: null, last_at: null },
    { id: 'title', mask: TRIAGE.KNOWN | TRIAGE.TITLE },
    { id: 'reading', mask: TRIAGE.KNOWN | TRIAGE.SAMPLE, last_views: '7', last_at: '2026-09-29T10:00:00Z' },
  ]);

  it('treats an id the database did not return as known and quiet', () => {
    expect(t.known('quiet')).toBe(true);
    expect(t.sampleMayStore('quiet')).toBe(false);
    expect(t.quietKnownIds(['quiet', 'unknown', 'title', 'reading'])).toEqual(['quiet', 'reading']);
  });

  it('sends only title/description/thumbnail suspects to the full read', () => {
    expect(t.fullReadIds()).toEqual(['title']);
    expect(t.known('unknown')).toBe(false);
  });

  it('carries the last reading for sample suspects, and no reading when there is none', () => {
    expect(t.lastSamples.get('reading')).toEqual({ views: 7, at: new Date('2026-09-29T10:00:00Z') });
    expect(t.lastSamples.has('unknown-new-reading')).toBe(false);
    expect(t.sampleMayStore('unknown-new-reading')).toBe(true);
  });

  it('ORs the masks of an id that arrives in two chunks', () => {
    const u = new Triage();
    u.add([{ id: 'x', mask: TRIAGE.KNOWN | TRIAGE.SAMPLE, last_views: 1, last_at: '2026-01-01T00:00:00Z' }]);
    u.add([{ id: 'x', mask: TRIAGE.KNOWN | TRIAGE.DESC }]);
    expect(u.masks.get('x')).toBe(TRIAGE.KNOWN | TRIAGE.SAMPLE | TRIAGE.DESC);
  });
});

describe('triageParams', () => {
  it('sends the poller hash of the description, nulls for invalid views and unparseable dates', () => {
    const at = new Date('2026-09-29T11:00:00.000Z');
    const p = triageParams([
      { entry: entry({ video_id: 'a', description: 'hello', views: 5, updated: '2026-09-29T10:00:00+00:00' }), observedAt: at },
      { entry: entry({ video_id: 'b', views: -1, updated: 'garbage' }), observedAt: at },
    ], (s) => `sha(${s})`, 86_400_000);
    expect(p).toEqual([
      ['a', 'b'], ['t', 't'], ['sha(hello)', null], [5, null],
      ['2026-09-29T10:00:00.000Z', null], [at.toISOString(), at.toISOString()], 86_400_000,
    ]);
  });
});

test('the triage SQL returns only non-quiet ids and reads the NEWEST description and thumbnail versions', () => {
  expect(SNAPSHOT_TRIAGE_SQL).toMatch(/where m\.mask <> 1/);
  expect(SNAPSHOT_TRIAGE_SQL).toMatch(/order by dv\.version desc limit 1/);
  expect(SNAPSHOT_TRIAGE_SQL).toMatch(/order by tv\.version desc limit 1/);
  expect(SNAPSHOT_TRIAGE_SQL).toMatch(/group by f\.id/);
});
