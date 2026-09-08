# Page benchmark — after (2026-09-08T23:43:19.759Z)

Blocks = shared_blks_read + shared_blks_hit for the channelsmith_app role, delta around one
request, caches bypassed (BENCH=1). Blocks is the primary metric; wall time on this instance
moves with whatever else is touching the disk. Best of 2 runs.

| page | blocks | disk blocks | db ms | wall ms | top statement |
|---|---:|---:|---:|---:|---|
| feed/all | 2215 | 0 | 8 | 465 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| feed/outliers | 10141 | 0 | 25 | 599 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| feed/tests | 2419 | 0 | 10 | 368 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| feed/uploads | 5653 | 0 | 11 | 486 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| channels | 90594 | 0 | 184 | 834 | select v.channel_id, v.published_at as t, s.baseline from videos v joi |
| channel/UCjWkNxpp3UHdEavpM_19--Q | 1367 | 0 | 3 | 420 | with page as ( select v.id, v.title, v.published_at, v.view_count, v.t |
| channel/UCGhyz7J9HmS0GT8Y_BR_crA | 721 | 0 | 2 | 359 | with page as ( select v.id, v.title, v.published_at, v.view_count, v.t |
| channel/UCBJycsmduvYEL83R_U4JriQ | 3996 | 0 | 33 | 411 | select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.chann |
| video/ANmTVYkEtLw | 1591 | 0 | 7 | 1328 | with target_videos as materialized ( select id, published_at from vide |
| video/fo-uubnajWM | 1691 | 0 | 5 | 1275 | with target_videos as materialized ( select id, published_at from vide |
| video/9mVaKmmhYFc | 890 | 0 | 3 | 688 | with target_videos as materialized ( select id, published_at from vide |
| video/W-AvIBUyHfQ | 762 | 0 | 3 | 615 | with target_videos as materialized ( select id, published_at from vide |

## Before / after

Same URLs, same pinned ids, caches bypassed in both runs. Blocks are the metric;
wall time moved with the disk and should be read as corroboration, not measurement.

| page | blocks before | blocks after | change | wall before | wall after |
|---|---:|---:|---:|---:|---:|
| feed/all | 2281 | 2215 | -3% | 675 ms | 465 ms |
| feed/outliers | 10141 | 10141 | 0% | 465 ms | 599 ms |
| feed/tests | 2398 | 2419 | 1% | 399 ms | 368 ms |
| feed/uploads | 5648 | 5653 | 0% | 463 ms | 486 ms |
| channels | 92630 | 90594 | -2% | 818 ms | 834 ms |
| channel/UCjWkNxpp3UHdEavpM_19--Q | 2659 | 1367 | -49% | 534 ms | 420 ms |
| channel/UCGhyz7J9HmS0GT8Y_BR_crA | 1063 | 721 | -32% | 337 ms | 359 ms |
| channel/UCBJycsmduvYEL83R_U4JriQ | 10368 | 3996 | -61% | 383 ms | 411 ms |
| video/ANmTVYkEtLw | 4843 | 1591 | -67% | 950 ms | 1328 ms |
| video/fo-uubnajWM | 4593 | 1691 | -63% | 854 ms | 1275 ms |
| video/9mVaKmmhYFc | 1434 | 890 | -38% | 521 ms | 688 ms |
| video/W-AvIBUyHfQ | 1320 | 762 | -42% | 556 ms | 615 ms |
| **total** | **139378** | **122040** | **-12%** | | |

## Top statements per page

### feed/all

- 1 call(s), 3 ms, 1560 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 489 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 106 blocks (0 from disk): `select channel_id, avatar_url from channel_meta where channel_id = any($1)`

### feed/outliers

- 1 call(s), 20 ms, 9505 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 489 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 146 blocks (0 from disk): `select channel_id, avatar_url from channel_meta where channel_id = any($1)`

### feed/tests

- 1 call(s), 5 ms, 1732 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 489 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 155 blocks (0 from disk): `select video_id, version, sha256, phash, first_seen from thumbnail_versions where video_id = any($1::text[]) order by video_id, version`

### feed/uploads

- 1 call(s), 6 ms, 5015 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 489 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 148 blocks (0 from disk): `select channel_id, avatar_url from channel_meta where channel_id = any($1)`

### channels

- 1 call(s), 173 ms, 89092 blocks (0 from disk): `select v.channel_id, v.published_at as t, s.baseline from videos v join video_scores s on s.video_id = v.id where v.channel_id = any($1::tex`
- 1 call(s), 10 ms, 1461 blocks (0 from disk): `select uc.channel_id, uc.role, uc.watched_closely, uc.notify, uc.added_at, ct.lane, ct.backfill_status, coalesce(cm.title, cs.name) as name,`
- 1 call(s), 0 ms, 18 blocks (0 from disk): `select u.plan, count(uc.channel_id) as tracked, count(*) filter (where uc.watched_closely) as watched from app_users u left join user_channe`

### channel/UCjWkNxpp3UHdEavpM_19--Q — Make or Break Shop (245 videos)

- 1 call(s), 2 ms, 619 blocks (0 from disk): `with page as ( select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url from videos v where v.channel_id = $1 and (coalesce(v.is_`
- 1 call(s), 1 ms, 521 blocks (0 from disk): `select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.channel_name)) as name, max(cm.avatar_url) as avatar_url, max(cm.subscriber`
- 1 call(s), 1 ms, 220 blocks (0 from disk): `select count(*)::int as n from videos v where v.channel_id = $1 and (coalesce(v.is_short, $2) = $3 and coalesce(v.duration, $4) <> $5 and no`

### channel/UCGhyz7J9HmS0GT8Y_BR_crA — wittworks (62 videos)

- 1 call(s), 2 ms, 566 blocks (0 from disk): `with page as ( select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url from videos v where v.channel_id = $1 and (coalesce(v.is_`
- 1 call(s), 0 ms, 89 blocks (0 from disk): `select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.channel_name)) as name, max(cm.avatar_url) as avatar_url, max(cm.subscriber`
- 1 call(s), 0 ms, 59 blocks (0 from disk): `select count(*)::int as n from videos v where v.channel_id = $1 and (coalesce(v.is_short, $2) = $3 and coalesce(v.duration, $4) <> $5 and no`

### channel/UCBJycsmduvYEL83R_U4JriQ — Marques Brownlee (1745 videos)

- 1 call(s), 22 ms, 1755 blocks (0 from disk): `select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.channel_name)) as name, max(cm.avatar_url) as avatar_url, max(cm.subscriber`
- 1 call(s), 7 ms, 1630 blocks (0 from disk): `select count(*)::int as n from videos v where v.channel_id = $1 and (coalesce(v.is_short, $2) = $3 and coalesce(v.duration, $4) <> $5 and no`
- 1 call(s), 4 ms, 604 blocks (0 from disk): `with page as ( select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url from videos v where v.channel_id = $1 and (coalesce(v.is_`

### video/ANmTVYkEtLw

- 1 call(s), 4 ms, 1094 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 1 ms, 236 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 1 ms, 98 blocks (0 from disk): `select c.video_id, c.obs from video_obs_cache c left join series_dirty d on d.video_id = c.video_id where c.video_id = any($1::text[]) and d`

### video/fo-uubnajWM

- 1 call(s), 3 ms, 1094 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 1 ms, 333 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 94 blocks (0 from disk): `select c.video_id, c.obs from video_obs_cache c left join series_dirty d on d.video_id = c.video_id where c.video_id = any($1::text[]) and d`

### video/9mVaKmmhYFc

- 1 call(s), 2 ms, 560 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 1 ms, 114 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 71 blocks (0 from disk): `select c.video_id, c.obs from video_obs_cache c left join series_dirty d on d.video_id = c.video_id where c.video_id = any($1::text[]) and d`

### video/W-AvIBUyHfQ

- 1 call(s), 2 ms, 464 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 0 ms, 83 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 71 blocks (0 from disk): `select c.video_id, c.obs from video_obs_cache c left join series_dirty d on d.video_id = c.video_id where c.video_id = any($1::text[]) and d`
