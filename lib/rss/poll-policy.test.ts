import {
  RSS_POLICY as P,
  stateForLastUpload,
  intervalSecFor,
  isDue,
  backoffAfter,
  perRunCap,
  parseRssEntries,
  decodeEntities,
  isUpdatedSince,
  SEED_SUBSET_SQL,
  SEED_ALL_SQL,
  DUE_CHANNELS_SQL,
  STATE_COUNTS_SQL,
} from './poll-policy';

const NOW = new Date('2026-09-03T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const mins = (m: number) => m * 60_000;
const days = (d: number) => d * 86_400_000;

describe('channel state', () => {
  it('is active while the channel uploaded inside the dormancy window', () => {
    expect(stateForLastUpload(ago(days(1)), NOW)).toBe('active');
    expect(stateForLastUpload(ago(days(59)), NOW)).toBe('active');
    expect(stateForLastUpload(ago(days(61)), NOW)).toBe('dormant');
    expect(stateForLastUpload(null, NOW)).toBe('dormant');
    expect(P.dormantAfterDays).toBe(60);
  });

  it('active/woken poll every 15 min, dormant daily', () => {
    expect(intervalSecFor('active')).toBe(900);
    expect(intervalSecFor('woken')).toBe(900);
    expect(intervalSecFor('dormant')).toBe(86_400);
  });
});

describe('isDue', () => {
  it('polls a never-polled channel immediately', () => {
    expect(isDue({ rss_state: 'active', rss_last_polled: null }, NOW)).toBe(true);
    expect(isDue({ rss_state: 'dormant', rss_last_polled: null }, NOW)).toBe(true);
  });

  it('honours the per-state interval', () => {
    expect(isDue({ rss_state: 'active', rss_last_polled: ago(mins(16)) }, NOW)).toBe(true);
    expect(isDue({ rss_state: 'active', rss_last_polled: ago(mins(5)) }, NOW)).toBe(false);
    expect(isDue({ rss_state: 'dormant', rss_last_polled: ago(mins(60)) }, NOW)).toBe(false);
    expect(isDue({ rss_state: 'dormant', rss_last_polled: ago(days(2)) }, NOW)).toBe(true);
  });

  it('a WebSub-woken channel polls on the next tick', () => {
    expect(isDue({ rss_state: 'woken', rss_last_polled: null }, NOW)).toBe(true);
  });

  it('respects a live back-off and the widened interval behind it', () => {
    expect(isDue({ rss_state: 'active', rss_last_polled: ago(days(1)), rss_backoff_until: new Date(NOW.getTime() + mins(5)) }, NOW)).toBe(false);
    expect(isDue({ rss_state: 'active', rss_last_polled: ago(days(1)), rss_backoff_until: ago(mins(1)) }, NOW)).toBe(true);
    expect(isDue({ rss_state: 'active', rss_last_polled: ago(mins(20)), rss_interval_sec: 3600 }, NOW)).toBe(false);
  });
});

describe('backoffAfter', () => {
  it('resets on 200 and 304', () => {
    expect(backoffAfter(200, 'active', 3600, NOW)).toEqual({ intervalSec: null, backoffUntil: null });
    expect(backoffAfter(304, 'active', 3600, NOW)).toEqual({ intervalSec: null, backoffUntil: null });
  });

  it('doubles on 429 and 5xx, capped at 6 hours', () => {
    expect(backoffAfter(429, 'active', null, NOW).intervalSec).toBe(1800);
    expect(backoffAfter(503, 'active', 1800, NOW).intervalSec).toBe(3600);
    expect(backoffAfter(429, 'active', 5 * 3600, NOW).intervalSec).toBe(P.backoffCapSec);
    expect(backoffAfter(429, 'active', 99 * 3600, NOW).intervalSec).toBe(6 * 3600);
  });

  it('does not escalate a plain 404 past one cycle', () => {
    expect(backoffAfter(404, 'active', 3600, NOW).intervalSec).toBe(900);
  });
});

describe('perRunCap staggers the population across the interval', () => {
  it('spreads 52 subset channels over the three 5-min slots in 15 min', () => {
    expect(perRunCap(52)).toBe(18);
  });
  it('never returns zero and never exceeds the hard ceiling', () => {
    expect(perRunCap(1)).toBe(1);
    expect(perRunCap(0)).toBe(1);
    expect(perRunCap(1_000_000)).toBe(P.maxPerRun);
  });
});

describe('parseRssEntries', () => {
  const xml = `<feed>
  <entry>
    <id>yt:video:XplV_L7gx6w</id>
    <yt:videoId>XplV_L7gx6w</yt:videoId>
    <yt:channelId>UCVUSDq6-oSpWAAPUppHFtZQ</yt:channelId>
    <title>I Built 2 Coffee Tables in 8 Hours</title>
    <published>2026-08-29T11:12:40+00:00</published>
    <updated>2026-09-03T09:06:25+00:00</updated>
    <media:group>
      <media:description>Boss vs Employee &amp;amp; more</media:description>
      <media:community>
        <media:starRating count="12129" average="5.00" min="1" max="5"/>
        <media:statistics views="985292"/>
      </media:community>
    </media:group>
  </entry>
  <entry>
    <yt:videoId>abcdefghijk</yt:videoId>
    <title>No stats here</title>
  </entry>
  <entry><title>no video id, skipped</title></entry>
</feed>`;

  it('reads id, title, description, timestamps and free stats', () => {
    const e = parseRssEntries(xml);
    expect(e).toHaveLength(2);
    expect(e[0].video_id).toBe('XplV_L7gx6w');
    expect(e[0].channel_id).toBe('UCVUSDq6-oSpWAAPUppHFtZQ');
    expect(e[0].title).toBe('I Built 2 Coffee Tables in 8 Hours');
    expect(e[0].description).toBe('Boss vs Employee &amp; more');
    expect(e[0].published).toBe('2026-08-29T11:12:40+00:00');
    expect(e[0].updated).toBe('2026-09-03T09:06:25+00:00');
    expect(e[0].views).toBe(985292);
    expect(e[0].likes).toBe(12129);
  });

  it('tolerates entries without stats and skips entries without a video id', () => {
    const e = parseRssEntries(xml);
    expect(e[1].views).toBeNull();
    expect(e[1].likes).toBeNull();
    expect(e[1].description).toBeNull();
  });

  it('decodes the entities YouTube escapes in titles', () => {
    expect(decodeEntities('Tom &amp; Jerry &quot;live&quot; &#39;26')).toBe(`Tom & Jerry "live" '26`);
    expect(decodeEntities('a &lt;b&gt; c')).toBe('a <b> c');
  });
});

describe('isUpdatedSince', () => {
  it('is true when the feed timestamp is newer than what we stored', () => {
    expect(isUpdatedSince('2026-09-03T09:06:25Z', '2026-09-01T00:00:00Z')).toBe(true);
    expect(isUpdatedSince('2026-09-03T09:06:25Z', '2026-09-03T09:06:25Z')).toBe(false);
    expect(isUpdatedSince('2026-09-03T09:06:25Z', null)).toBe(true);
    expect(isUpdatedSince(null, null)).toBe(false);
  });
});

describe('SQL shape', () => {
  it('the runtime queries can be restricted to watch_subset', () => {
    for (const sql of [DUE_CHANNELS_SQL, STATE_COUNTS_SQL]) {
      expect(sql).toContain('watch_subset');
      expect(sql).toContain('$1::boolean');
    }
    expect(SEED_SUBSET_SQL).toContain('watch_subset');
  });

  // The group-by-with-EXISTS form of the subset seed reads 98K blocks and takes 56 s on this
  // DB (measured 2026-09-03); the LATERAL form takes 7 ms. Guard the shape, not just the text.
  it('the subset seed drives off watch_subset through a lateral, never a corpus group-by', () => {
    expect(SEED_SUBSET_SQL).toContain('cross join lateral');
    expect(SEED_SUBSET_SQL).not.toContain('group by');
    expect(SEED_SUBSET_SQL).toContain('from watch_subset w');
    expect(SEED_ALL_SQL).toContain('group by v.channel_id');
    expect(SEED_ALL_SQL).not.toContain('watch_subset');
  });
  it('the due query carries the cadences and orders by the stagger key', () => {
    expect(DUE_CHANNELS_SQL).toContain('900');
    expect(DUE_CHANNELS_SQL).toContain('86400');
    expect(DUE_CHANNELS_SQL).toContain('rss_backoff_until');
    expect(DUE_CHANNELS_SQL).toContain('order by c.rss_last_polled nulls first');
  });
  it('neither seed demotes a channel a WebSub push woke', () => {
    expect(SEED_SUBSET_SQL).toContain("rss_state = 'woken'");
    expect(SEED_ALL_SQL).toContain("rss_state = 'woken'");
  });
});
