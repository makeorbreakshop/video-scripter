import crypto from 'crypto';
import {
  verificationResponse, verifySignature, parsePushEntries, pushPlan,
  TOUCH_QUEUE_SQL, WOKEN_SQL, VERIFY_SQL,
} from './receive';
import { WEBSUB } from './lease-policy';

const atom = (id: string, ch: string, title: string, published: string) => `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>${ch}</yt:channelId>
  <title>${title}</title><published>${published}</published><updated>${published}</updated></entry>
</feed>`;

describe('hub verification handshake', () => {
  const q = (o: Record<string, string>) => new URLSearchParams(o);

  it('echoes the challenge for a subscribe and reports the channel to stamp', () => {
    const r = verificationResponse(q({
      'hub.mode': 'subscribe',
      'hub.topic': 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC0123456789012345678901',
      'hub.challenge': 'chal-42',
      'hub.lease_seconds': '828000',
    }), new Date('2026-09-06T00:00:00Z'));
    expect(r.status).toBe(200);
    expect(r.body).toBe('chal-42');
    expect(r.channelId).toBe('UC0123456789012345678901');
    expect(r.leaseExpiresAt?.toISOString()).toBe('2026-09-15T14:00:00.000Z');
  });

  it('404s a request with no challenge', () => {
    expect(verificationResponse(q({ 'hub.mode': 'subscribe' })).status).toBe(404);
  });

  it('echoes an unsubscribe challenge but records no lease', () => {
    const r = verificationResponse(q({
      'hub.mode': 'unsubscribe', 'hub.challenge': 'c',
      'hub.topic': 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC0123456789012345678901',
    }));
    expect(r.body).toBe('c');
    expect(r.leaseExpiresAt).toBeNull();
  });
});

describe('HMAC signature', () => {
  const body = 'hello';
  const secret = 'shh';
  const sig1 = 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
  const sig256 = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

  it('accepts a correct sha1 or sha256 signature', () => {
    expect(verifySignature(body, sig1, secret)).toBe(true);
    expect(verifySignature(body, sig256, secret)).toBe(true);
  });

  it('rejects a wrong or missing signature when a secret is configured', () => {
    expect(verifySignature(body, 'sha1=deadbeef', secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, 'sha1=' + 'zz'.repeat(20), secret)).toBe(false);
  });

  it('accepts anything when no secret is configured', () => {
    expect(verifySignature(body, null, '')).toBe(true);
  });
});

describe('Atom parsing', () => {
  it('pulls video id, channel id, title and published out of a push', () => {
    const [e] = parsePushEntries(atom('vid00000001', 'UC0123456789012345678901', 'Hello &amp; welcome', '2026-09-06T12:00:00+00:00'));
    expect(e).toEqual({
      video_id: 'vid00000001',
      channel_id: 'UC0123456789012345678901',
      title: 'Hello & welcome',
      published: '2026-09-06T12:00:00+00:00',
      updated: '2026-09-06T12:00:00+00:00',
      deleted: false,
    });
  });

  it('reports a deletion notification without inventing an entry', () => {
    const del = `<feed xmlns:at="http://purl.org/atompub/tombstones/1.0"><at:deleted-entry ref="yt:video:abc12345678"/></feed>`;
    expect(parsePushEntries(del)).toEqual([
      { video_id: 'abc12345678', channel_id: null, title: null, published: null, updated: null, deleted: true },
    ]);
  });

  it('ignores junk', () => {
    expect(parsePushEntries('<feed></feed>')).toEqual([]);
    expect(parsePushEntries('not xml at all')).toEqual([]);
  });
});

describe('push plan', () => {
  const now = new Date('2026-09-06T12:05:00Z');
  const entry = {
    video_id: 'vid00000001', channel_id: 'UC0123456789012345678901',
    title: 'New title', published: '2026-09-06T12:00:00Z', updated: '2026-09-06T12:00:00Z', deleted: false,
  };

  it('queues an unknown, freshly published video and wakes the channel', () => {
    const p = pushPlan([entry], new Map(), now);
    expect(p.queue).toEqual([{ ref: 'vid00000001', source_url: 'websub:UC0123456789012345678901' }]);
    expect(p.woken).toEqual(['UC0123456789012345678901']);
    expect(p.titleChanges).toEqual([]);
  });

  // A hub re-delivery for a video we already have is an edit, not a new upload: no queue row.
  it('is idempotent — a known video is never re-queued', () => {
    const known = new Map([['vid00000001', { title: 'New title', published_at: new Date('2026-09-06T12:00:00Z') }]]);
    const p = pushPlan([entry], known, now);
    expect(p.queue).toEqual([]);
    expect(p.titleChanges).toEqual([]);
    expect(p.woken).toEqual(['UC0123456789012345678901']);
  });

  it('reports a title edit carried by the push', () => {
    const known = new Map([['vid00000001', { title: 'Old title', published_at: new Date('2026-09-06T12:00:00Z') }]]);
    const p = pushPlan([entry], known, now);
    expect(p.titleChanges).toEqual([{ video_id: 'vid00000001', from: 'Old title', to: 'New title' }]);
    expect(p.queue).toEqual([]);
  });

  it('does not queue an unknown but old catalogue entry', () => {
    const old = { ...entry, published: '2020-01-01T00:00:00Z' };
    expect(pushPlan([old], new Map(), now).queue).toEqual([]);
  });

  it('drops deletions and dedupes repeated ids inside one push', () => {
    const p = pushPlan([entry, entry, { ...entry, video_id: 'gone1234567', deleted: true }], new Map(), now);
    expect(p.queue).toHaveLength(1);
    expect(p.woken).toEqual(['UC0123456789012345678901']);
  });
});

describe('SQL reuses the poller write paths', () => {
  it('queues into touch_queue in websub mode, ignoring duplicates', () => {
    expect(TOUCH_QUEUE_SQL).toMatch(/insert into touch_queue \(kind, ref, source_url, mode\)/);
    expect(TOUCH_QUEUE_SQL).toMatch(/'websub'/);
    expect(TOUCH_QUEUE_SQL).toMatch(/on conflict \(kind, ref\) do nothing/);
  });

  it('marks the channel woken and stamps the push', () => {
    expect(WOKEN_SQL).toMatch(/rss_state = 'woken'/);
    expect(WOKEN_SQL).toMatch(/rss_last_polled = null/);
    expect(VERIFY_SQL).toMatch(/last_verified_at/);
    expect(VERIFY_SQL).toMatch(/lease_expires_at/);
  });

  it('keeps the default lease in sync with the policy', () => {
    expect(WEBSUB.leaseSeconds).toBe(432_000);
  });
});
