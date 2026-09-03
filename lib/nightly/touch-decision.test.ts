import { decideVideoRow } from './touch-decision';
import type { KnownChannels } from './enrollment-core';

const GREG = 'UCPjNBjflYl0-HQtUvOx0Ibw';
const STRANGER = 'UCstranger00000000000000';

function known(over: Partial<KnownChannels> = {}): KnownChannels {
  return { competitor: new Set(), discovered: new Set(), legacy: new Set(), withVideos: new Set(), ...over };
}

describe('decideVideoRow — the Greg Isenberg regression (2026-09-02)', () => {
  // The extension saw 9_SZFIW7tus in a feed 10 minutes after publish. The channel was
  // already tracked, but feed-mode rows were treated as discovery signals only, so the
  // video waited 12.5h for the nightly ingest and the launch tracker missed the first day.
  it('imports a feed-mode upload from a channel we already track', () => {
    const d = decideVideoRow({ mode: 'feed', ref: '9_SZFIW7tus', channelId: GREG }, new Set(), known({ discovered: new Set([GREG]) }));
    expect(d).toEqual({ result: 'imported', tier: 0, unknownChannel: false });
  });

  it('imports a feed-mode upload from a channel we have never seen, and flags the channel', () => {
    const d = decideVideoRow({ mode: 'feed', ref: 'v2', channelId: STRANGER }, new Set(), known());
    expect(d).toEqual({ result: 'imported', tier: 0, unknownChannel: true });
  });

  it('imports a passive-mode upload too', () => {
    expect(decideVideoRow({ mode: 'passive', ref: 'v1', channelId: STRANGER }, new Set(), known()).result).toBe('imported');
  });

  it('a video already in the corpus is already-tracked whatever the mode', () => {
    for (const mode of ['feed', 'websub', 'click', 'passive']) {
      expect(decideVideoRow({ mode, ref: 'v3', channelId: GREG }, new Set(['v3']), known()).result).toBe('already-tracked');
    }
  });

  it('websub imports at tier 0, click at tier 1', () => {
    expect(decideVideoRow({ mode: 'websub', ref: 'v4', channelId: STRANGER }, new Set(), known()).tier).toBe(0);
    expect(decideVideoRow({ mode: 'click', ref: 'v5', channelId: STRANGER }, new Set(), known()).tier).toBe(1);
  });

  it('a feed row with no channel (unfetchable) stays a candidate signal', () => {
    expect(decideVideoRow({ mode: 'feed', ref: 'gone', channelId: null }, new Set(), known()).result).toBe('candidate-signal');
  });

  describe('trackedOnly back-off knob (API budget)', () => {
    it('keeps tracked-channel uploads importing', () => {
      const d = decideVideoRow({ mode: 'feed', ref: 'v6', channelId: GREG }, new Set(), known({ withVideos: new Set([GREG]) }), { trackedOnly: true });
      expect(d.result).toBe('imported');
    });
    it('turns unknown-channel feed sightings back into signals', () => {
      const d = decideVideoRow({ mode: 'feed', ref: 'v7', channelId: STRANGER }, new Set(), known(), { trackedOnly: true });
      expect(d).toEqual({ result: 'candidate-signal', tier: null, unknownChannel: true });
    });
    it('never gates websub or click', () => {
      expect(decideVideoRow({ mode: 'websub', ref: 'v8', channelId: STRANGER }, new Set(), known(), { trackedOnly: true }).result).toBe('imported');
    });
  });
});

import { corpusTrackedChannels } from './touch-decision';

describe('corpusTrackedChannels — a channel imported seconds ago is not tracked yet', () => {
  const now = Date.parse('2026-09-03T17:00:00Z');
  it('counts a channel with old corpus videos as tracked', () => {
    expect(corpusTrackedChannels([{ channel_id: 'A', first_import: '2026-08-01T00:00:00Z' }], now).has('A')).toBe(true);
  });
  it('does not count a channel whose first import was inside the grace window', () => {
    expect(corpusTrackedChannels([{ channel_id: 'B', first_import: '2026-09-03T16:59:30Z' }], now).has('B')).toBe(false);
  });
  it('counts a channel exactly at the grace boundary as tracked', () => {
    expect(corpusTrackedChannels([{ channel_id: 'C', first_import: '2026-09-03T16:00:00Z' }], now).has('C')).toBe(true);
  });
  it('treats a null import_date (legacy corpus) as tracked', () => {
    expect(corpusTrackedChannels([{ channel_id: 'D', first_import: null }], now).has('D')).toBe(true);
  });
});
