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
  shouldProcessEntries,
  SEED_SUBSET_SQL,
  SEED_ALL_SQL,
  DUE_CHANNELS_SQL,
  STATE_COUNTS_SQL,
} from './poll-policy';

const NOW = new Date('2026-09-03T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const mins = (m: number) => m * 60_000;
const days = (d: number) => d * 86_400_000;
const hours = (h: number) => h * 3_600_000;

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

  // The whole point of the cap is that a full sweep of the active corpus finishes inside the
  // 15-minute cadence. If the ceiling is below the corpus's own stagger number, the cadence is
  // silently stretched instead (at maxPerRun 600 the 5,803-channel corpus polled every ~38 min).
  it('does not throttle the real corpus below its 15-minute cadence', () => {
    const CORPUS = 5_803; // channel_rss_state, 2026-09-03
    expect(perRunCap(CORPUS)).toBe(Math.ceil(CORPUS / 3));
    expect(perRunCap(CORPUS)).toBeLessThanOrEqual(P.maxPerRun);
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

describe('shouldProcessEntries (the unchanged-body rule)', () => {
  // A byte-identical feed means identical view/like counts too, so an rss_samples row would
  // duplicate the previous one. Nothing is written for the channel's videos on that poll.
  it('skips all per-entry work — rss_samples included — when the body hash is unchanged', () => {
    expect(shouldProcessEntries('abc123', 'abc123')).toBe(false);
  });

  it('does the full poll whenever the body differs at all, including view-count-only changes', () => {
    expect(shouldProcessEntries('abc123', 'def456')).toBe(true);
  });

  it('does the full poll on the first ever sight of a channel', () => {
    expect(shouldProcessEntries(null, 'abc123')).toBe(true);
    expect(shouldProcessEntries(undefined, 'abc123')).toBe(true);
  });
});

describe('the 60-day dormancy rule end to end', () => {
  it('an active channel polls every 15 min and a dormant one gets a daily safety poll', () => {
    const active = { rss_state: stateForLastUpload(ago(days(3)), NOW), rss_last_polled: ago(mins(16)) } as const;
    expect(active.rss_state).toBe('active');
    expect(isDue(active, NOW)).toBe(true);
    expect(isDue({ ...active, rss_last_polled: ago(mins(14)) }, NOW)).toBe(false);

    const dormant = { rss_state: stateForLastUpload(ago(days(120)), NOW), rss_last_polled: ago(hours(25)) } as const;
    expect(dormant.rss_state).toBe('dormant');
    expect(isDue(dormant, NOW)).toBe(true);                                   // daily safety poll
    expect(isDue({ ...dormant, rss_last_polled: ago(hours(23)) }, NOW)).toBe(false);
  });

  it('a channel crossing the 60-day line flips active -> dormant, and a new upload flips it back', () => {
    expect(stateForLastUpload(ago(days(59.9)), NOW)).toBe('active');
    expect(stateForLastUpload(ago(days(60.1)), NOW)).toBe('dormant');
    expect(stateForLastUpload(ago(mins(1)), NOW)).toBe('active');
  });

  // A WebSub push writes rss_state='woken' and rss_last_polled=null (scripts/drain-touch-queue.ts).
  // Both halves matter: 'woken' must poll at the active cadence, and the null must make it due now.
  it('a WebSub push makes a dormant channel due on the very next tick at the active cadence', () => {
    expect(intervalSecFor('woken')).toBe(intervalSecFor('active'));
    expect(isDue({ rss_state: 'woken', rss_last_polled: null }, NOW)).toBe(true);
    expect(isDue({ rss_state: 'woken', rss_last_polled: ago(mins(16)) }, NOW)).toBe(true);
    expect(isDue({ rss_state: 'woken', rss_last_polled: ago(mins(2)) }, NOW)).toBe(false);
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
    // 'woken' must fall through to the active cadence in SQL too, not just in isDue()
    expect(DUE_CHANNELS_SQL).toContain("when c.rss_state = 'dormant' then 86400");
  });
  it('neither seed demotes a channel a WebSub push woke', () => {
    expect(SEED_SUBSET_SQL).toContain("rss_state = 'woken'");
    expect(SEED_ALL_SQL).toContain("rss_state = 'woken'");
  });
});
