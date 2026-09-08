# Page benchmark — before (2026-09-08T23:05:19.459Z)

Blocks = shared_blks_read + shared_blks_hit for the channelsmith_app role, delta around one
request, caches bypassed (BENCH=1). Blocks is the primary metric; wall time on this instance
moves with whatever else is touching the disk. Best of 2 runs.

| page | blocks | disk blocks | db ms | wall ms | top statement |
|---|---:|---:|---:|---:|---|
| feed/all | 2281 | 0 | 8 | 675 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| feed/outliers | 10141 | 0 | 25 | 465 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| feed/tests | 2398 | 0 | 11 | 399 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| feed/uploads | 5648 | 0 | 11 | 463 | select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.pay |
| channels | 92630 | 0 | 190 | 818 | select v.channel_id, v.published_at as t, s.baseline from videos v joi |
| channel/UCjWkNxpp3UHdEavpM_19--Q | 2659 | 0 | 10 | 534 | select count(*)::int as n from ( select v.id from videos v left join t |
| channel/UCGhyz7J9HmS0GT8Y_BR_crA | 1063 | 0 | 3 | 337 | with page as ( select v.id, v.title, v.published_at, v.view_count, v.t |
| channel/UCBJycsmduvYEL83R_U4JriQ | 10368 | 0 | 33 | 383 | select count(*)::int as n from ( select v.id from videos v left join t |
| video/ANmTVYkEtLw | 4843 | 0 | 21 | 950 | with target_videos as materialized ( select id, published_at from vide |
| video/fo-uubnajWM | 4593 | 0 | 12 | 854 | with target_videos as materialized ( select id, published_at from vide |
| video/9mVaKmmhYFc | 1434 | 0 | 4 | 521 | with target_videos as materialized ( select id, published_at from vide |
| video/W-AvIBUyHfQ | 1320 | 0 | 4 | 556 | with target_videos as materialized ( select id, published_at from vide |

## Top statements per page

### feed/all

- 1 call(s), 3 ms, 1621 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 489 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 109 blocks (0 from disk): `select channel_id, avatar_url from channel_meta where channel_id = any($1)`

### feed/outliers

- 1 call(s), 20 ms, 9505 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 489 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 146 blocks (0 from disk): `select channel_id, avatar_url from channel_meta where channel_id = any($1)`

### feed/tests

- 1 call(s), 5 ms, 1723 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 489 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 1 ms, 146 blocks (0 from disk): `select video_id, version, sha256, phash, first_seen from thumbnail_versions where video_id = any($1::text[]) order by video_id, version`

### feed/uploads

- 1 call(s), 6 ms, 5010 blocks (0 from disk): `select e.id::text as id, e.type, e.at, e.channel_id, e.video_id, e.payload, v.title as video_title, v.thumbnail_url, v.channel_name, v.publi`
- 1 call(s), 5 ms, 489 blocks (0 from disk): `select (select coalesce(json_agg(t order by t.name nulls last), $2::json) from ( select uc.channel_id, coalesce(cm.title, cs.name) as name f`
- 1 call(s), 0 ms, 148 blocks (0 from disk): `select channel_id, avatar_url from channel_meta where channel_id = any($1)`

### channels

- 1 call(s), 173 ms, 89120 blocks (0 from disk): `select v.channel_id, v.published_at as t, s.baseline from videos v join video_scores s on s.video_id = v.id where v.channel_id = any($1::tex`
- 1 call(s), 16 ms, 3472 blocks (0 from disk): `select uc.channel_id, uc.role, uc.watched_closely, uc.notify, uc.added_at, ct.lane, ct.backfill_status, coalesce(cm.title, cs.name) as name,`
- 1 call(s), 0 ms, 18 blocks (0 from disk): `select u.plan, count(uc.channel_id) as tracked, count(*) filter (where uc.watched_closely) as watched from app_users u left join user_channe`

### channel/UCjWkNxpp3UHdEavpM_19--Q — Make or Break Shop (245 videos)

- 1 call(s), 5 ms, 1278 blocks (0 from disk): `select count(*)::int as n from ( select v.id from videos v left join thumbnail_versions t on t.video_id = v.id left join title_versions n on`
- 1 call(s), 3 ms, 626 blocks (0 from disk): `with page as ( select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url from videos v where v.channel_id = $1 and (coalesce(v.is_`
- 1 call(s), 2 ms, 531 blocks (0 from disk): `select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.channel_name)) as name, max(cm.avatar_url) as avatar_url, max(cm.subscriber`

### channel/UCGhyz7J9HmS0GT8Y_BR_crA — wittworks (62 videos)

- 1 call(s), 2 ms, 566 blocks (0 from disk): `with page as ( select v.id, v.title, v.published_at, v.view_count, v.thumbnail_url from videos v where v.channel_id = $1 and (coalesce(v.is_`
- 1 call(s), 1 ms, 343 blocks (0 from disk): `select count(*)::int as n from ( select v.id from videos v left join thumbnail_versions t on t.video_id = v.id left join title_versions n on`
- 1 call(s), 0 ms, 91 blocks (0 from disk): `select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.channel_name)) as name, max(cm.avatar_url) as avatar_url, max(cm.subscriber`

### channel/UCBJycsmduvYEL83R_U4JriQ — Marques Brownlee (1745 videos)

- 1 call(s), 18 ms, 6300 blocks (0 from disk): `select count(*)::int as n from ( select v.id from videos v left join thumbnail_versions t on t.video_id = v.id left join title_versions n on`
- 1 call(s), 6 ms, 1804 blocks (0 from disk): `select v.channel_id, coalesce(max(cm.title), max(cs.name), max(v.channel_name)) as name, max(cm.avatar_url) as avatar_url, max(cm.subscriber`
- 1 call(s), 7 ms, 1656 blocks (0 from disk): `select count(*)::int as n from videos v where v.channel_id = $1 and (coalesce(v.is_short, $2) = $3 and coalesce(v.duration, $4) <> $5 and no`

### video/ANmTVYkEtLw

- 1 call(s), 20 ms, 4450 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 1 ms, 236 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 60 blocks (0 from disk): `select id, coalesce(view_count,$2) as views, extract($3 from (now() - published_at))/$4 as age from videos where id = any($1)`

### video/fo-uubnajWM

- 1 call(s), 10 ms, 4091 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 1 ms, 333 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 60 blocks (0 from disk): `select id, coalesce(view_count,$2) as views, extract($3 from (now() - published_at))/$4 as age from videos where id = any($1)`

### video/9mVaKmmhYFc

- 1 call(s), 3 ms, 1175 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 0 ms, 114 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 60 blocks (0 from disk): `select id, coalesce(view_count,$2) as views, extract($3 from (now() - published_at))/$4 as age from videos where id = any($1)`

### video/W-AvIBUyHfQ

- 1 call(s), 3 ms, 1093 blocks (0 from disk): `with target_videos as materialized ( select id, published_at from videos where id = any($1) ) select x.video_id, x.at, x.views, x.source, x.`
- 1 call(s), 0 ms, 83 blocks (0 from disk): `select at, views, time_basis as "timeBasis", received_at as "receivedAt" from rss_samples where video_id = $1 and views is not null and not `
- 1 call(s), 0 ms, 60 blocks (0 from disk): `select id, coalesce(view_count,$2) as views, extract($3 from (now() - published_at))/$4 as age from videos where id = any($1)`
