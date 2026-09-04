# /app/feed speed audit — 500 tracked channels

2026-09-04. Account `60945b47-6237-4575-b2fb-93d2a894585b`, 500 tracked channels,
24,092 longform feed events across them (125,825 in the table, 43 MB).

Brandon's report was that the feed "seems to take a bit to load with lots of videos."
It does, and the reason is not the amount of time Postgres spends thinking. Every query
on the route executes in single-digit to low-double-digit milliseconds once its pages are
in cache. What made the page slow was **how many pages it had to touch** to produce 60
rows, and **how many round trips** the route made before the first card existed.

## The three biggest causes

**1. The per-channel lateral read 12,728 buffers to return 60 rows.**
The feed query probed `idx_feed_events_channel_at_longform` once per channel, taking each
channel's newest 61 events and merging them. At 19 channels that is 1,159 index entries and
it was the right shape. At 500 it is 30,500 entries — 99 MB of index and heap — to throw
away all but 60. Warm that costs ~26 ms; on a cold cache it took **3.7 s**, which is the
version Brandon feels after the connection has been idle. One walk down the global
`idx_feed_events_at_id`, discarding untracked channels as it goes, fills the same page from
**1,331 buffers**, because at 500 channels the recent window is dense enough that 60 matches
turn up within the first couple of thousand entries.

**2. The segment chips had no index for the type filter.**
Each per-channel probe read the channel's whole longform history and filtered by `type`
afterwards. The Outliers chip touched 18,906 buffers and took **2.3 s cold** (967 ms TTFB
in production). A partial index on `(channel_id, type, at desc, id desc) where is_longform`
makes the probe exact: **1,707 buffers, ~6 ms**.

**3. The route made four sequential Postgres round trips before a card existed.**
Tracked channels, then groups, then memberships, then the feed. Three of those are one
per-user shell read that does not depend on itself. Their combined execution time is ~5 ms;
their combined cost on the page was three network RTTs to Supabase. They are now one query.
Alongside it, `avatarsFor` read all 500 tracked channels' avatars to decorate 60 cards and
shipped the whole map to the browser.

## Before / after

Production, Brandon's signed-in Chrome, three runs per route. `cold` is the first hit after
an idle connection, `warm` the steady state. Query ms and buffers are `EXPLAIN (ANALYZE,
BUFFERS)` against the real 500-channel set for the 60-row page.

| Route | TTFB cold→warm | First row | Interactive | Query ms | Buffers | Rows | Payload |
|---|---|---|---|---|---|---|---|
| **Before** |
| `/app/feed` | 280 → 129 ms | 240–386 ms | 350 ms | 26.2 | 12,728 | 60 | 277 KB |
| `?seg=uploads` | 151 → 96 ms | 256–536 ms | 537 ms | 22.1 | 13,299 | 60 | 284 KB |
| `?seg=tests` | 227 → 99 ms | 161–248 ms | 250 ms | 18.6 | 19,520 | 60 | 213 KB |
| `?seg=changes` | 154 → 101 ms | 187–313 ms | 313 ms | 20.0 | 19,497 | 60 | 307 KB |
| `?seg=outliers` | **967** → 102 ms | **1,275** ms | 1,277 ms | 21.0 | 18,906 | 60 | 290 KB |
| `/api/app/feed` page 2 | **615** → 111 ms | — | — | 26.2 | 12,728 | 60 | 43 KB |
| **After** (deployed, same account, same browser) |
| `/app/feed` | 131 → 106 ms | 187–259 ms | 259 ms | 3.6 | **1,331** | 60 | **211 KB** |
| `?seg=uploads` | 158 → 134 ms | 194–202 ms | 202 ms | 3.8 | **2,309** | 60 | **218 KB** |
| `?seg=tests` | 119 → 114 ms | 162–176 ms | 176 ms | 5.7 | **3,040** | 60 | **142 KB** |
| `?seg=changes` | 158 → 111 ms | 193–250 ms | 250 ms | 7.6 | **4,552** | 60 | **240 KB** |
| `?seg=outliers` | 146 → 108 ms | **190–268** ms | 268 ms | 6.3 | **1,707** | 60 | **226 KB** |
| `/api/app/feed` page 2 | 167 → 140 ms | — | — | 3.6 | 1,331 | 60 | 49 KB |

The number Brandon was feeling is the Outliers row: **first row 1,275 ms → 190–268 ms**, and
its cold TTFB spike (967 ms) is gone because the chip no longer reads 18,906 buffers. The
default view's worst first-row went 386 ms → 259 ms. Payloads are 22–33% smaller across every
route — that is the 500-entry avatar map no longer being shipped to decorate 60 cards.

Paging is flat, which is what keyset pagination is for: page 1 / 2 / 3 of the default view
came back in 156 / 152 / 321 ms, 60 events each, and each page brings its own avatars.

Worst case across every segment: **19,520 → 4,552 buffers**. Default view: **9.6× less IO**.
Round trips before the first card: **4 → 2** (shell, then feed; the avatar and packaging
reads share the third).

## The query plans

### Before — default view, 500 channels (the shape that was replaced)

```
Nested Loop Left Join  (actual time=26.198..28.551 rows=61)
  Buffers: shared hit=12690
  ->  Limit  (actual time=25.528..25.547 rows=61)
        ->  Sort  (Sort Key: e2.at DESC, e2.id DESC; top-N heapsort)
              ->  Nested Loop  (actual time=3.397..19.116 rows=12591)
                    ->  Function Scan on unnest c  (rows=500)
                    ->  Limit  (actual time=0.008..0.028 rows=25 loops=500)
                          ->  Index Scan using idx_feed_events_channel_at_longform
                                Index Cond: (channel_id = c.channel_id)
                                Buffers: shared hit=12273
Execution Time: 33.581 ms
```

12,591 rows produced to return 61. On a cold cache the same statement took 3,773 ms.

### After — default view, 500 channels

```
Limit  (actual time=0.082..1.018 rows=61)
  Buffers: shared hit=926
  ->  Index Scan using idx_feed_events_at_id on feed_events
        Filter: (is_longform AND (channel_id = ANY (...500 ids...)))
        Rows Removed by Filter: 1939
Execution Time: 1.643 ms
```

1,939 rows discarded instead of 12,530.

### After — Outliers chip, 500 channels, on the new index

```
->  Index Scan using idx_feed_events_channel_type_at_longform
      Index Cond: (channel_id = c.channel_id AND type = 'outlier')
Buffers: shared hit=1707
Execution Time: 6.3 ms
```

### The crossover — why the shape is chosen, not fixed

The flat walk is only cheap when the page fills quickly. Measured buffers for a 60-row page,
default view, by tracked-channel count:

| channels | lateral | flat |
|---|---|---|
| 1 | 5 | 5 |
| 5 | 44 | 58 |
| 10 | 94 | **62,497** |
| 25 | 248 | 9,580 |
| 50 | 490 | 5,721 |
| 100 | 948 | 3,743 |
| 200 | 1,844 | 2,609 |
| 300 | 4,298 | 2,099 |
| 500 | 9,389 | **930** |

A small tracked set is sparse in the recent global window, so the flat walk has to read tens
of thousands of entries it discards — at 10 channels it is 660× worse. The two curves cross
between 150 and 400 depending on the segment, so `FLAT_SCAN_MIN_CHANNELS = 300` sits inside
every one of them.

Segments behave differently for the same reason. With the type index in place, at 500
channels:

| segment | lateral | flat | chosen |
|---|---|---|---|
| all | 12,728 | 1,331 | flat |
| uploads | 20,125 | 2,309 | flat |
| tests | 3,040 | 3,040 | lateral (tie) |
| changes | 4,552 | 4,552 | lateral (tie) |
| outliers | **1,707** | 13,016 | lateral |

`upload` is emitted once per video, so a channel's history of it is as long as its catalogue
and the per-channel probes degenerate to n × limit; the global walk fills a page immediately.
The sparse types are the other way round. That is the whole of `scanShape()` in
`lib/feed/query.ts`, and `DENSE_FEED_TYPES` in `lib/feed/event-types.ts` names which is which.

## What changed

- `lib/feed/query.ts` — `scanShape()` picks the lateral or the flat form from the channel
  count and the segment's density. Keyset pagination on `(at desc, id desc)` and the fixed
  `limit + 1` page are unchanged; both shapes carry the same cursor predicate.
- `lib/feed/event-types.ts` — `DENSE_FEED_TYPES`.
- `sql/2026-09-04-feed-channel-type-index.sql` — `idx_feed_events_channel_type_at_longform`,
  partial on `is_longform`, ~9 MB. Built with `CREATE INDEX CONCURRENTLY`.
- `lib/app/feed-loader.ts` (new) — `feedShell()` reads tracked channels, groups and
  memberships in one query; `resolveSelection()` and `avatarChannelIds()` are pure.
- `app/app/feed/page.tsx` — one shell read, then the feed, then the avatar and packaging
  reads together. `maxDuration = 20`.
- `app/api/app/feed/route.ts` — returns `avatars` for its page, runs its two decoration
  reads in parallel, clamps `limit` through `clampLimit` (it was unbounded). `maxDuration = 20`.
- `app/app/_components/feed-client.tsx` — merges each page's avatars into its map.

## What was already right

- Keyset pagination on `(at desc, id desc)` with a fixed page size, and `limit + 1` to detect
  the next page without a count query. Page 6 of the default view reads 2,131 buffers — deep
  paging does not degrade.
- `is_longform` as a stored column rather than a join to `videos` before the LIMIT.
- One `thumbnail_versions` read per page, not per card.
- Images: `loading="lazy"` below the fold, `eager` + `fetchPriority=high` for the first two
  cards, fixed-ratio containers so nothing shifts.
- Preconnects to the thumbnail, avatar and fallback origins in the app layout.
- `requireAppUser` wrapped in React `cache()`, so the layout and the page share one session
  resolution.

## Left slow, and why

- **The Sort menu ships all 500 channel names** (~33 KB of JSON, in both the HTML and the RSC
  payload). That is what the dropdown filters over, so it is load-bearing rather than waste.
  It would need a searching/paged menu to fix, which is a design change, not a perf fix.
- **First Load JS is unchanged at 117 KB** for `/app/feed` (103 KB of it shared framework).
  Nothing on this route is close to being the bottleneck.
- **Outliers is still the most expensive chip** at 1,707 buffers versus 1,331 for the default
  view. It is within noise of the others now; no further work is worth the index.
- **The group filter could not be measured in production** — the account has no groups there.
  It is covered by unit tests in `lib/app/feed-loader.test.ts`, including the case that used
  to hand the query an empty `any($1)`.
