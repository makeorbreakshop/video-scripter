# Page benchmark — after-sparkline (2026-09-09T00:12:29.389Z)

Blocks = shared_blks_read + shared_blks_hit for the channelsmith_app role, delta around one
request, caches bypassed (BENCH=1). Blocks is the primary metric; wall time on this instance
moves with whatever else is touching the disk. Best of 2 runs.

| page | blocks | disk blocks | db ms | wall ms | top statement |
|---|---:|---:|---:|---:|---|
| feed/all | 2315 | 0 | 8 | 339 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| feed/outliers | 10150 | 0 | 25 | 408 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| feed/tests | 2428 | 0 | 10 | 323 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| feed/uploads | 5560 | 0 | 11 | 381 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| channels | 1694 | 0 | 15 | 478 | select uc.channel_id, uc.role, uc.watched_closely, uc.notify, uc.added |
| channel/UCjWkNxpp3UHdEavpM_19--Q | 1369 | 0 | 4 | 331 | with page as ( select v.id, v.title, v.published_at, v.view_count, v.t |
| channel/UCGhyz7J9HmS0GT8Y_BR_crA | 721 | 0 | 3 | 298 | with page as ( select v.id, v.title, v.published_at, v.view_count, v.t |
| channel/UCBJycsmduvYEL83R_U4JriQ | 4004 | 0 | 11 | 337 | select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.chann |
| video/ANmTVYkEtLw | 4873 | 0 | 20 | 858 | with target_videos as materialized ( select id, published_at from vide |
| video/fo-uubnajWM | 4602 | 0 | 12 | 748 | with target_videos as materialized ( select id, published_at from vide |
| video/9mVaKmmhYFc | 895 | 0 | 3 | 526 | with target_videos as materialized ( select id, published_at from vide |
| video/W-AvIBUyHfQ | 767 | 0 | 4 | 429 | with target_videos as materialized ( select id, published_at from vide |

## Top statements per page

### feed/all

- 1 call(s), 3 ms, 1649 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 498 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 103 blocks (0 from disk): `select channel_id, avatar_url from channel_meta where channel_id = any($1)`

### feed/outliers

- 1 call(s), 20 ms, 9505 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 498 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 146 blocks (0 from disk): `select channel_id, avatar_url from channel_meta where channel_id = any($1)`

### feed/tests

- 1 call(s), 5 ms, 1732 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 498 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 155 blocks (0 from disk): `select video_id, version, sha256, phash, first_seen from thumbnail_versions where video_id = any($1::text[]) order by video_id, version`

### feed/uploads

- 1 call(s), 6 ms, 4915 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 498 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 146 blocks (0 from disk): `select channel_id, avatar_url from channel_meta where channel_id = any($1)`

### channels

- 1 call(s), 11 ms, 1470 blocks (0 from disk): `select uc.channel_id, uc.role, uc.watched_closely, uc.notify, uc.added_at, ct.lane, ct.backfill_status, coalesce(cm.title, cs.name) as name,`
- 1 call(s), 4 ms, 186 blocks (0 from disk): `select channel_id, spark from channel_stats where channel_id = any($1::text[]) and spark is not null`
- 1 call(s), 0 ms, 18 blocks (0 from disk): `select u.plan, count(uc.channel_id) as tracked, count(*) filter (where uc.watched_closely) as watched from app_users u left join user_channe`

### channel/UCjWkNxpp3UHdEavpM_19--Q — Make or Break Shop (245 videos)

- 1 call(s), 2 ms, 619 blocks (0 from disk): `with page as ( select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url from videos v where v.channel_id = $1 and (coalesce(v.is_`
- 1 call(s), 1 ms, 523 blocks (0 from disk): `select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.channel_name)) as name, max(cm.avatar_url) as avatar_url, max(cm.subscriber`
- 1 call(s), 1 ms, 220 blocks (0 from disk): `select count(*)::int as n from videos v where v.channel_id = $1 and (coalesce(v.is_short, $2) = $3 and coalesce(v.duration, $4) <> $5 and no`

### channel/UCGhyz7J9HmS0GT8Y_BR_crA — wittworks (62 videos)

- 1 call(s), 2 ms, 566 blocks (0 from disk): `with page as ( select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url from videos v where v.channel_id = $1 and (coalesce(v.is_`
- 1 call(s), 0 ms, 89 blocks (0 from disk): `select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.channel_name)) as name, max(cm.avatar_url) as avatar_url, max(cm.subscriber`
- 1 call(s), 0 ms, 59 blocks (0 from disk): `select count(*)::int as n from videos v where v.channel_id = $1 and (coalesce(v.is_short, $2) = $3 and coalesce(v.duration, $4) <> $5 and no`

### channel/UCBJycsmduvYEL83R_U4JriQ — Marques Brownlee (1745 videos)

- 1 call(s), 5 ms, 1763 blocks (0 from disk): `select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.channel_name)) as name, max(cm.avatar_url) as avatar_url, max(cm.subscriber`
- 1 call(s), 5 ms, 1630 blocks (0 from disk): `select count(*)::int as n from videos v where v.channel_id = $1 and (coalesce(v.is_short, $2) = $3 and coalesce(v.duration, $4) <> $5 and no`
- 1 call(s), 2 ms, 604 blocks (0 from disk): `with page as ( select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url from videos v where v.channel_id = $1 and (coalesce(v.is_`

### video/ANmTVYkEtLw

- 1 call(s), 19 ms, 4411 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 1 ms, 237 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 62 blocks (0 from disk): `select c.video_id, c.obs from video_obs_cache c left join series_dirty d on d.video_id = c.video_id where c.video_id = any($1::text[]) and d`

### video/fo-uubnajWM

- 1 call(s), 10 ms, 4036 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 1 ms, 334 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 62 blocks (0 from disk): `select c.video_id, c.obs from video_obs_cache c left join series_dirty d on d.video_id = c.video_id where c.video_id = any($1::text[]) and d`

### video/9mVaKmmhYFc

- 1 call(s), 2 ms, 560 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 1 ms, 114 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 76 blocks (0 from disk): `select c.video_id, c.obs from video_obs_cache c left join series_dirty d on d.video_id = c.video_id where c.video_id = any($1::text[]) and d`

### video/W-AvIBUyHfQ

- 1 call(s), 2 ms, 464 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 0 ms, 83 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 76 blocks (0 from disk): `select c.video_id, c.obs from video_obs_cache c left join series_dirty d on d.video_id = c.video_id where c.video_id = any($1::text[]) and d`
