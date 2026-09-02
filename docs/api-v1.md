# ChannelSmith Public API v1

Base URL: `https://channelsmith.com/api/v1` (locally `http://localhost:3000/api/v1`).

Everything here is the same data the app itself renders. Responses are JSON; every field is
stable — new fields may be added, existing ones are not renamed or removed within v1.

## Authentication

Every request needs a bearer API key:

```bash
curl -H "Authorization: Bearer $CHANNELSMITH_KEY" https://channelsmith.com/api/v1/channels
```

`X-Api-Key: <key>` is accepted as an alternative for tools that cannot set `Authorization`.

Keys look like `cs_live_…`, are shown exactly once at creation, and are stored only as a sha256
hash — a lost key must be revoked and replaced, not recovered. Create and revoke them in
Settings, or from the CLI:

```bash
npx tsx scripts/make-api-key.ts --email you@example.com --label "my agent"
# writes the plaintext to .secrets/api-key-you.txt (gitignored) and prints only the prefix
```

Missing, unknown, or revoked keys get `401`:

```json
{ "error": { "code": "unauthorized", "message": "Unknown or revoked API key." } }
```

## Rate limits

60 requests per minute per key, as a continuously refilling token bucket (one token back every
second, so a paused client recovers immediately rather than waiting out a window). Over the
limit returns `429` with `Retry-After`, `X-RateLimit-Limit` and `X-RateLimit-Remaining`:

```json
{ "error": { "code": "rate_limited", "message": "Rate limit exceeded: 60 requests per minute per key." } }
```

The bucket lives in the serving process, so in a multi-instance deployment the effective ceiling
is per instance. Treat 60/min as the number to design against, not a number to probe.

## Errors

| Status | `error.code` | When |
|---|---|---|
| 400 | `bad_request` | Malformed id or an unknown `sort` value |
| 401 | `unauthorized` | Missing, unknown, or revoked key |
| 404 | `not_found` | No such video |
| 429 | `rate_limited` | Over 60 req/min |
| 500 | `internal_error` | Our fault; retry |

---

## `GET /channels`

The channels the key's owner tracks.

```bash
curl -H "Authorization: Bearer $CHANNELSMITH_KEY" \
  https://channelsmith.com/api/v1/channels
```

```json
{
  "channels": [
    {
      "id": "UCxxxxxxxxxxxxxxxxxxxxxx",
      "name": "Make or Break Shop",
      "handle": "@makeorbreakshop",
      "thumbnail_url": "https://yt3.ggpht.com/...",
      "subscriber_count": 214000,
      "video_count": 412,
      "role": "self",
      "watched_closely": true,
      "added_at": "2026-09-01T14:22:10.412Z"
    }
  ]
}
```

`role` is `self` or `competitor`. `name`, `handle`, `thumbnail_url`, `subscriber_count` and
`video_count` are `null` for a channel we have not finished enriching yet.

## `GET /feed`

The activity stream across every channel the key's owner tracks, newest first.

| Query param | Default | Notes |
|---|---|---|
| `limit` | 50 | Max 200 |
| `cursor` | — | Opaque; pass back `next_cursor` from the previous page |
| `types` | all | Comma-separated or repeated; unknown values are ignored |

```bash
curl -H "Authorization: Bearer $CHANNELSMITH_KEY" \
  "https://channelsmith.com/api/v1/feed?limit=25&types=outlier,thumbnail_change"
```

```json
{
  "events": [
    {
      "id": "48213",
      "type": "ab_rotation",
      "at": "2026-09-02T17:03:37.666Z",
      "channel": { "id": "UCVLrS0f3K6GfwHywdS6jeMA", "name": "Fellowship Updates" },
      "video": {
        "id": "1240OKiYXZg",
        "title": "Why Helm's Deep Is Still the Greatest Battle Ever Filmed",
        "thumbnail_url": "https://i.ytimg.com/vi/1240OKiYXZg/maxresdefault.jpg",
        "published_at": "2026-08-31T14:06:19.000Z"
      },
      "payload": {
        "version": 3,
        "before_url": "https://.../1240OKiYXZg_v2.jpg",
        "after_url": "https://.../1240OKiYXZg_v3.jpg",
        "hours_since_publish": 27.1,
        "phash": "e4cc84b4d4d6b0ed"
      }
    }
  ],
  "next_cursor": "MjAyNi0wOS0wMlQxNzowMzozNy42NjZafDQ4MjEz",
  "types": ["upload", "thumbnail_change", "ab_rotation", "title_change", "outlier"]
}
```

Paginate until `next_cursor` is `null`:

```bash
CURSOR=""
while :; do
  PAGE=$(curl -s -H "Authorization: Bearer $CHANNELSMITH_KEY" \
    "https://channelsmith.com/api/v1/feed?limit=100&cursor=$CURSOR")
  echo "$PAGE" | jq -c '.events[]'
  CURSOR=$(echo "$PAGE" | jq -r '.next_cursor // empty')
  [ -z "$CURSOR" ] && break
done
```

Pagination is keyset on `(at, id)`, so events materialized while you are reading never shift a
page underneath you and deep pages cost the same as shallow ones.

### Event types and payloads

| `type` | Fires when | `payload` |
|---|---|---|
| `upload` | A tracked channel publishes, or we import a video published in the last 30 days | `title`, `published_at` |
| `thumbnail_change` | A new thumbnail version appears (v2+) | `version`, `before_url`, `after_url`, `hours_since_publish` |
| `ab_rotation` | The new thumbnail's perceptual hash matches an *earlier* version — the creator rotated back, i.e. an A/B test | same as above, plus `phash` |
| `title_change` | A new title version appears (v2+) | `version`, `old_title`, `new_title`, `hours_since_publish` |
| `outlier` | A video first reaches score ≥ 2 at `likely` or `confirmed` confidence | `score`, `est30`, `baseline`, `confidence` |

Each fires once per video-and-version: a video that keeps climbing does not emit a second
`outlier`, and re-running the materializer never duplicates a row.

`before_url` / `after_url` are `null` when that thumbnail version was never archived.

## `GET /videos/{id}`

Everything the video page shows.

```bash
curl -H "Authorization: Bearer $CHANNELSMITH_KEY" \
  https://channelsmith.com/api/v1/videos/1240OKiYXZg
```

```json
{
  "video": {
    "id": "1240OKiYXZg",
    "title": "Why Helm's Deep Is Still the Greatest Battle Ever Filmed",
    "channel": { "id": "UCVLrS0f3K6GfwHywdS6jeMA", "name": "Fellowship Updates" },
    "published_at": "2026-08-31T14:06:19.000Z",
    "duration": "PT24M58S",
    "is_short": false,
    "thumbnail_url": "https://i.ytimg.com/vi/1240OKiYXZg/maxresdefault.jpg",
    "view_count": 58636,
    "like_count": 689,
    "comment_count": 43
  },
  "score": {
    "model_version": "v3.0",
    "scored_at": "2026-09-02T16:59:54.255Z",
    "snapshot_day": 2.11,
    "views": 58296,
    "est30": 89135.4,
    "baseline": 41200.0,
    "n_baseline": 10,
    "score": 2.16,
    "same_age_ratio": 1.94,
    "n_same_age": 8,
    "confidence": "likely"
  },
  "curve": [{ "day": 0.91, "views": 45276, "source": "snapshot" }],
  "thumbnail_versions": [
    { "version": 1, "first_seen": "2026-09-01T18:34:39.601Z", "phash": "f7b2b070d0a496e5", "bytes": 22617, "url": "https://.../1240OKiYXZg_v1.jpg" }
  ],
  "title_versions": [
    { "version": 1, "title": "How the Greatest Battle in Movie History Was Made", "first_seen": "2026-09-02T15:49:30.097Z" }
  ],
  "events": [{ "id": "4230", "type": "ab_rotation", "at": "2026-09-02T17:03:37.666Z", "payload": {} }]
}
```

- `score` is `null` until the video has been scored. `score.score` is `est30 / baseline`, so
  `2.16` means "on track for 2.16× this channel's normal day-30 views". `confidence` is
  `insufficient` → `early` → `likely` → `confirmed`; `score` and `baseline` are `null` while the
  channel has too few priors to compare against.
- `curve` is view count against **days since publish**, ascending, from two sources: `snapshot`
  (daily truth) and `sample` (15-minute resolution during the launch window). Up to 2000 points.
- `events` are this video's feed events, newest first, up to 200 — the same objects as `/feed`
  minus the channel and video blocks.

## `GET /channels/{id}/videos`

| Query param | Default | Notes |
|---|---|---|
| `sort` | `published` | `score`, `published`, or `views` |
| `limit` | 50 | Max 200 |

```bash
curl -H "Authorization: Bearer $CHANNELSMITH_KEY" \
  "https://channelsmith.com/api/v1/channels/UCVLrS0f3K6GfwHywdS6jeMA/videos?sort=score&limit=10"
```

```json
{
  "channel_id": "UCVLrS0f3K6GfwHywdS6jeMA",
  "sort": "score",
  "videos": [
    {
      "id": "1240OKiYXZg",
      "title": "Why Helm's Deep Is Still the Greatest Battle Ever Filmed",
      "published_at": "2026-08-31T14:06:19.000Z",
      "view_count": 58636,
      "thumbnail_url": "https://i.ytimg.com/vi/1240OKiYXZg/maxresdefault.jpg",
      "duration": "PT24M58S",
      "is_short": false,
      "score": { "score": 2.16, "est30": 89135.4, "baseline": 41200.0, "same_age_ratio": 1.94, "confidence": "likely" }
    }
  ]
}
```

`sort=score` puts unscored videos last. `score` is `null` for a video we have not scored.

## Freshness

Feed events are materialized every 5 minutes from the watcher and scorer output, so a thumbnail
swap typically appears within about 10 minutes of us noticing it. Scores are recomputed hourly.
Polling `/feed` more than once a minute will not show you anything new.


## Added 2026-09-02 (evening)

- `GET /channels/:id/videos` now accepts `since` and `until` (ISO dates on publish time), returns the same `score` object as `/videos/:id`, and adds `packaging: { thumbnail_changes, title_changes, last_change }` per video. Shorts are excluded.
- `GET /feed` accepts `since=<ISO>` for polling clients.
- `GET /videos/:id` adds `experiments[]`: for each packaging change, views/hour before vs after and a verdict (`helped`, `hurt`, `no clear effect`, `too early`).
- `GET /search?q=` finds channels across the whole library.
- `GET /outliers?since=&min_score=&limit=&channels=` lists videos beating their channel baseline (likely/confirmed), library-wide or for a channel list. Default: last 90 days, score >= 2.

Example, "what is working in my niche this quarter":
```bash
curl -H "Authorization: Bearer $KEY" "https://www.channelsmith.com/api/v1/outliers?since=2026-06-01&min_score=2&limit=50"
```
