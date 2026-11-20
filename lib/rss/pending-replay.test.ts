import {
  splitBuffers, mergeBuffers, emptyBuffers, rowCount, stripStaleControlRows, afterFailure, chunkId, planReplay,
  BUFFER_KEYS, MAX_REPLAY_ATTEMPTS, type Buffers,
} from './pending-replay';

const AT = '2026-09-11T21:51:11.120Z';
/** A buffer shaped like a real tick: `channels` feeds of `perFeed` videos each. */
function tick(channels: number, perFeed: number, at = AT): Buffers {
  const b = emptyBuffers();
  for (let c = 0; c < channels; c++) {
    const ch = `UC${String(c).padStart(4, '0')}`;
    const views: Record<string, number> = {};
    for (let v = 0; v < perFeed; v++) {
      const id = `${ch}v${v}`;
      views[id] = 100 + v;
      b.samples.push({ video_id: id, at, views: 100 + v, likes: null });
      b.observed.push(id); b.titleChecks.push(id);
    }
    b.responses.push({ fetchedAt: at, date: null, age: null, cacheControl: null, channelId: ch, views });
    b.channels.push({ channel_id: ch, status: 200, body_sha: 'x', etag: null, interval_sec: null, backoff_until: null, clear_woken: true });
  }
  return b;
}
const sortedJson = (b: Buffers) => BUFFER_KEYS.map((k) => (b[k] as unknown[]).map((r) => JSON.stringify(r)).sort());

describe('splitBuffers', () => {
  it('bounds every chunk to the sample cap and loses or duplicates nothing', () => {
    const b = tick(150, 15); // 2,250 samples, like the stuck 2026-09-11 buffer's shape
    b.touchQueue.push({ ref: 'orphan1', source_url: 'feed:/rss/x' });
    b.titleVersions.push({ video_id: 'UC0003v2', version: 2, title: 't', first_seen: AT, backfill: false });
    const chunks = splitBuffers(b, 200);
    expect(chunks.length).toBeGreaterThan(10);
    for (const c of chunks) expect(c.samples.length).toBeLessThanOrEqual(200);
    expect(sortedJson(mergeBuffers(chunks))).toEqual(sortedJson(b));
  });

  it('keeps each sample in the same chunk as the response that carries its evidence', () => {
    for (const c of splitBuffers(tick(40, 15), 200)) {
      const covered = new Set(c.responses.flatMap((r) => Object.keys(r.views)));
      for (const s of c.samples) expect(covered.has(s.video_id)).toBe(true);
      const chans = new Set(c.responses.map((r) => r.channelId));
      for (const ch of c.channels) expect(chans.has(ch.channel_id)).toBe(true);
    }
  });

  it('bounds the non-sample rows too', () => {
    const b = emptyBuffers();
    for (let i = 0; i < 12_000; i++) b.titleChecks.push(`v${i}`);
    const chunks = splitBuffers(b, 200, 5000);
    expect(chunks.map((c) => c.titleChecks.length)).toEqual([5000, 5000, 2000]);
  });

  it('never splits one channel, and never emits an empty chunk', () => {
    const chunks = splitBuffers(tick(3, 300), 200); // each feed alone exceeds the cap
    expect(chunks).toHaveLength(3);
    expect(splitBuffers(emptyBuffers())).toEqual([]);
  });
});

describe('mergeBuffers', () => {
  it('tolerates older lines with missing keys', () => {
    const m = mergeBuffers([{ samples: tick(1, 2).samples }, { observed: ['a'] }]);
    expect(rowCount(m)).toBe(3);
  });
});

describe('stripStaleControlRows', () => {
  const b = tick(2, 2);
  b.reentries.push('UC0000v0'); b.videoTitles.push({ video_id: 'UC0000v0', title: 'old' });
  it('keeps a fresh buffer whole', () => {
    const r = stripStaleControlRows(b, new Date(Date.parse(AT) + 10 * 60_000));
    expect(r.stale).toBe(false);
    expect(r.buffer).toBe(b);
  });
  it('drops channel state, title writes and re-entries from a stale one, keeping the evidence', () => {
    const r = stripStaleControlRows(b, new Date('2026-09-22T18:00:00Z'));
    expect(r.stale).toBe(true);
    expect(r.buffer.channels).toEqual([]);
    expect(r.buffer.videoTitles).toEqual([]);
    expect(r.buffer.reentries).toEqual([]);
    expect(r.buffer.samples).toHaveLength(4);
    expect(r.buffer.titleChecks).toContain('UC0000v0');
  });
  it('treats a buffer with no timestamps as stale', () => {
    const x = emptyBuffers(); x.channels.push(tick(1, 1).channels[0]);
    expect(stripStaleControlRows(x, new Date()).stale).toBe(true);
  });
});

describe('afterFailure (attempt counter)', () => {
  it('retries, then quarantines on the third consecutive failure of the same chunk', () => {
    const a1 = afterFailure(null, 'c1');
    expect(a1).toEqual({ action: 'retry', attempts: 1 });
    const a2 = afterFailure({ attempts: 1, chunkId: 'c1' }, 'c1');
    expect(a2).toEqual({ action: 'retry', attempts: 2 });
    expect(afterFailure({ attempts: 2, chunkId: 'c1' }, 'c1')).toEqual({ action: 'quarantine', attempts: MAX_REPLAY_ATTEMPTS });
  });
  it('resets when a different chunk is at the head', () => {
    expect(afterFailure({ attempts: 2, chunkId: 'c1' }, 'c2')).toEqual({ action: 'retry', attempts: 1 });
  });
  it('identifies a chunk stably', () => {
    const [c] = splitBuffers(tick(2, 2));
    expect(chunkId(c)).toBe(chunkId(JSON.parse(JSON.stringify(c))));
  });
});

describe('planReplay', () => {
  it('judges each line on its own age, so a fresh line never vouches for a stale one', () => {
    const old = tick(2, 2); old.reentries.push('UC0000v0');
    const fresh = { ...tick(1, 1, '2026-09-22T17:59:00Z'), journaledAt: '2026-09-22T17:59:30Z' };
    fresh.channels[0].channel_id = 'UCfresh'; fresh.responses[0].channelId = 'UCfresh';
    const { chunks, staleLines } = planReplay([old, fresh], new Date('2026-09-22T18:00:00Z'));
    expect(staleLines).toBe(1);
    const all = mergeBuffers(chunks);
    expect(all.reentries).toEqual([]);
    expect(all.channels.map((c) => c.channel_id)).toEqual(['UCfresh']);
  });
  it('carries journaledAt onto every chunk so a fresh error-only chunk stays fresh next tick', () => {
    const b = { ...emptyBuffers(), journaledAt: '2026-09-22T17:59:30Z' };
    b.channels.push({ channel_id: 'UCerr', status: 404, body_sha: null, etag: null, interval_sec: 3600, backoff_until: null, clear_woken: false });
    const { chunks } = planReplay([b], new Date('2026-09-22T18:00:00Z'));
    expect(chunks[0].journaledAt).toBe(b.journaledAt);
    expect(planReplay(JSON.parse(JSON.stringify(chunks)), new Date('2026-09-22T18:05:00Z')).chunks[0].channels).toHaveLength(1);
  });
});

describe('planReplay re-packing', () => {
  it('re-packs a file of small chunks at the current chunk size', () => {
    const small = splitBuffers(tick(60, 15), 200);
    expect(small.length).toBeGreaterThan(4);
    const { chunks } = planReplay(JSON.parse(JSON.stringify(small)), new Date('2026-09-11T21:55:00Z'), 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].samples).toHaveLength(900);
  });
});
