---
title: Audience profile from YouTube analytics and comment mining
status: active
artifact_readiness: implementation-ready
execution: code
owner: brandon@makeorbreakshop.com
---

# Audience profile from YouTube analytics and comment mining

## September 14 content decision

Brandon approved the first 200-comment themes as representative enough to proceed with the full run. The three screenshots discussed in the originating conversation were from **another tool**; their example claims about garage builds, repair beliefs, and nostalgia are wrong for this channel. Use only their structural idea: core beliefs, emotional drivers, specific topic interests, and content buckets with 1–2 real winning owned-video links, editable by the owner. The source-backed first draft is in `2026-09-14-audience-profile-brief-review.md`.

This decision supersedes the earlier Idea Heist-style section example below where it conflicts. The seven visible brief sections are summary, demographics, core beliefs, emotional drivers, specific interests, content buckets, and creator-stated transformation. Theme lists and presentation feedback appear separately. Comments about pacing/filler remain useful feedback but must not become audience traits. A theme's distinct `video_count` and `author_count` are shown and only themes recurring across at least two videos and two authors may support inferred beliefs, drivers, or interests. One-video clusters can still be visible as topic feedback. Inferred lines keep exact quote/video evidence; measured facts come from Analytics and stated fields from the owner.

Sonnet 5 is the settled extraction model. Generic praise is discarded in code; purchase intent is `desire`, not `tool_ownership`. No screenshot example content may be copied into prompts or records.

The full run is complete: 2,153 of 2,153 comments mined across 46 videos, 1,923 stored observations, and 62 themes. The full evidence receipt is in `2026-09-14-audience-profile-full.md`; quote-span and distinct video/author-count audits both found zero mismatches. The seven-section profile is assembled and the owner-only `/app/audience` page is live locally. Two rendered design revision passes removed the count strip, chart wall, bordered theme cards, repeated source tags, and open editor; the durable UI review is in `.codex/design-runs/20260914-163721-app-app-audience/`.

## Outcome

Build a data-derived audience profile for a connected YouTube channel. Instead of interviewing
the creator about who watches them, the app reads the channel's own analytics (who they are, how
they watch, how they arrive), mines the channel's comments into typed, quoted observations, and
clusters those into themes. A profile record assembles the result into seven sections, every field
tagged with where it came from. That profile becomes the context the app hands to any future
idea generation or outlier-translation step, so the model reasons about a real audience rather
than a generic one.

The brief has a summary, measured demographics, core beliefs, emotional drivers, specific
interests, content buckets with owned winning-video links, and creator-stated transformation.
Each line is measured, inferred from evidence, or stated by the creator. Inferred lines link
to comments or owned videos that support them.

## Scope for this build

**Owner-only.** Every job, page, and API route in this PRD runs only for accounts that pass
`isOwner()` in `lib/app/flags.ts`. Other users see nothing and no data is pulled for their
channels. Do not add a plan gate, a nav entry for non-owners, or any signup-time trigger.

**One channel.** The owner's connected channel from `youtube_connections`. Design tables keyed
by `channel_id` so multi-channel works later, but do not build group-level profiles.

**Not in scope:** generating video ideas from the profile, mining competitor or outlier channels,
a conversational coach UI beyond a small form, any user-facing billing or quota handling,
migrating the legacy `comments` table.

## Non-goals and protected behavior

- Do not touch scoring, the feed, channel pages' existing analytics, or `daily_analytics`.
- Do not use supabase-js anywhere in this work. Direct Postgres only via `q`/`one` in
  `lib/admin/db.ts` (see the 2026-08-31 egress incident note in that file).
- Do not reuse the legacy `comments` table or the legacy routes under `app/api/youtube/comments*`
  and `app/api/youtube/fetch-comments`. Those belong to the old dashboard. New tables, new code
  under `lib/app/audience/`.
- Do not create a second Google Cloud project or a second OAuth client. All YouTube calls use the
  existing project's `YOUTUBE_API_KEY` (public data) and the existing OAuth refresh token in
  `youtube_connections` (analytics).
- Never store raw author channel IDs or display names on observations. Hash the author id.
- No explainer copy in the UI. Headings stand alone; show data, not descriptions of data.

## Existing code to build on

- `lib/app/youtube-connect.ts`: OAuth, token refresh, `fetchDaily` against
  `https://youtubeanalytics.googleapis.com/v2/reports`. Copy the request pattern; scopes already
  include `yt-analytics.readonly` and `youtube.readonly`.
- `lib/app/analytics-queue.ts` and `app/api/youtube/analytics/backfill/route.ts`: how analytics
  jobs are planned and triggered today.
- `lib/app/channels.ts`: `YOUTUBE_API_KEY` usage for Data API calls.
- `lib/app/flags.ts`: `isOwner()`.
- `lib/app/inspiration.ts`: how an LLM call with a model manifest is wired in this app.
- `videos` table: per-video rows with `channel_id`, used to pick which videos to mine.
- Migrations live in `supabase/migrations/` with a `YYYYMMDDHHMMSS_name.sql` filename.

## Data model

Five new tables. All timestamps `timestamptz`. All keyed for direct-Postgres access.

### `channel_audience`

Channel-level analytics facts, one row per dimension value per window.

| column | type | notes |
|---|---|---|
| channel_id | text | FK-less, matches `videos.channel_id` |
| dimension | text | `age_gender`, `country`, `device`, `traffic_source`, `subscribed_status` |
| key | text | e.g. `age25-34|male`, `US`, `TV`, `YT_SEARCH`, `subscribed` |
| value | numeric | percentage for `age_gender`; views for the rest |
| window_days | int | 90 |
| window_end | date | |
| fetched_at | timestamptz | |

Primary key `(channel_id, dimension, key, window_end)`.

### `audience_comments`

Raw comment text pulled for mining. Separate from the legacy `comments` table.

| column | type | notes |
|---|---|---|
| comment_id | text PK | YouTube comment id |
| video_id | text | |
| channel_id | text | the channel the video belongs to |
| parent_id | text null | for replies |
| author_hash | text | sha256 of the author channel id with a server salt; never the raw id |
| text | text | `textOriginal` |
| like_count | int | |
| published_at | timestamptz | |
| fetched_at | timestamptz | |
| mined_at | timestamptz null | set when extraction has run |

Index on `(channel_id, mined_at)` and `(video_id)`.

### `audience_observations`

One row per signal the extractor found. A comment can yield zero or several.

| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| channel_id | text | |
| comment_id | text | FK to `audience_comments` |
| video_id | text | |
| type | text | enum below |
| quote | text | verbatim span from the comment, 200 chars max |
| summary | text | one-line normalized restatement |
| confidence | numeric | 0 to 1 from the extractor |
| theme_id | bigint null | set by clustering |
| created_at | timestamptz | |

Observation `type` values: `question`, `frustration`, `desire`, `identity`, `tool_ownership`,
`request`, `praise`, `objection`.

### `audience_themes`

Clusters over observations, rebuilt on each profile refresh.

| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| channel_id | text | |
| profile_version | int | which rebuild produced it |
| type | text | same enum as observations |
| label | text | short theme name |
| description | text | one or two sentences |
| observation_count | int | |
| video_count | int | distinct owned videos represented in the theme |
| author_count | int | distinct keyed author hashes represented in the theme |
| sample_observation_ids | bigint[] | up to 5 |
| created_at | timestamptz | |

### `audience_profile`

One row per rebuild. The latest version is the live profile.

| column | type | notes |
|---|---|---|
| channel_id | text | |
| version | int | |
| name | text null | avatar name, stated by the creator or proposed |
| sections | jsonb | shape below |
| stated | jsonb | creator-entered answers, carried forward across versions |
| built_at | timestamptz | |

Primary key `(channel_id, version)`.

`sections` shape:

```json
{
  "summary": { "text": "...", "source": "inferred", "theme_ids": [12] },
  "demographics": [
    { "field": "age", "value": "...", "source": "measured" },
    { "field": "gender", "value": "...", "source": "measured" },
    { "field": "location", "value": "...", "source": "measured" },
    { "field": "income", "value": null, "source": "stated" }
  ],
  "core_beliefs": [ { "text": "...", "source": "inferred", "theme_ids": [12, 15] } ],
  "emotional_drivers": [ { "text": "...", "source": "inferred", "theme_ids": [7] } ],
  "specific_interests": [ { "text": "...", "source": "inferred", "theme_ids": [9] } ],
  "content_buckets": [ { "title": "...", "text": "...", "source": "inferred", "video_ids": ["owned_video_id"] } ],
  "transformation": { "before": { "text": "...", "source": "stated" }, "after": { "text": "...", "source": "stated" } }
}
```

`source` is one of `measured` (straight from analytics), `inferred` (model output grounded in
themes or catalog performance, must carry `theme_ids` or `video_ids`), `stated` (creator typed it).

## Pipeline

All code under `lib/app/audience/`. Pure functions (report parsing, comment batching, prompt
building, profile assembly) separated from network and database functions so they can be unit
tested the way `youtube-connect.ts` does it.

### Step 1: Channel analytics pull

`pullChannelAudience(channelId)`:

1. Refresh the access token from the owner's `youtube_connections` row.
2. Run five Analytics API reports, `ids=channel==MINE`, 90-day window ending yesterday:
   - `dimensions=ageGroup,gender` `metrics=viewerPercentage`
   - `dimensions=country` `metrics=views` `sort=-views` `maxResults=25`
   - `dimensions=deviceType` `metrics=views`
   - `dimensions=insightTrafficSourceType` `metrics=views`
   - `dimensions=subscribedStatus` `metrics=views`
3. Upsert into `channel_audience`.

Analytics API quota is separate from Data API quota and is not a concern at this volume.

### Step 2: Comment fetch

`fetchAudienceComments(channelId, opts)`:

1. Select candidate videos from `videos` for the channel: the 50 with the highest comment count
   plus any published in the last 90 days. Dedupe.
2. For each, call Data API `commentThreads.list` with `part=snippet,replies`,
   `order=relevance`, `maxResults=100`, `textFormat=plainText`, using `YOUTUBE_API_KEY`.
   Page until the video's comments are exhausted or the per-video cap is hit.
3. Caps: 300 comments per video, 3,000 per channel on the first pull. Incremental pulls only
   fetch videos with no rows in `audience_comments`.
4. Hash authors, upsert into `audience_comments`. Skip comments under 15 characters.

Cost: 1 Data API unit per page. The owner's first pull used 51 pages/units.

### Step 3: Extraction

`mineComments(channelId)`:

1. Select unmined comments, batch by video, 20 comments per Sonnet call with bounded
   concurrency; split any response that exceeds the output limit.
2. Prompt (`claude-sonnet-5`) returns a JSON array of observations:
   `{ comment_id, type, quote, summary, confidence }`. Instruct it to return nothing for comments
   with no signal (pure praise like "great video" is `praise` only if it names what was good).
   Quote must be a verbatim substring of the comment; reject any that is not. Code also rejects
   generic praise and ownership labels that lack possessed or in-use language.
3. Insert into `audience_observations`, set `mined_at` on the comments.

### Step 4: Clustering

`buildThemes(channelId, version)`:

1. For each observation type with at least 5 observations, send bounded 40-summary batches
   (id plus summary, no quotes) to `claude-sonnet-5` for candidate clusters, then consolidate
   candidate themes across batches. Cap at 8 final themes per type and 50 observations per
   candidate cluster. Split a batch again if the model still reaches its output cap. Singletons
   are dropped. Batching avoids the output cap hit by a single 546-question response.
2. Insert `audience_themes` rows with distinct video and author counts, set `theme_id` on members.

### Step 5: Profile assembly

`buildProfile(channelId)`:

1. Read `channel_audience`, the latest themes with distinct video/author counts, and owned
   videos with at least 1,000 views in the measured 90-day window, ranked by views with
   subscriber yield available as a second signal.
2. Measured fields are filled in code, not by the model.
3. The model (`claude-sonnet-5`) receives breadth-filtered themes, top-video titles and
   performance, and the creator's `stated` answers. It returns summary, core beliefs,
   emotional drivers, specific interests, and content buckets. Beliefs, drivers, and interests
   cite themes present across at least two videos and two authors. Buckets cite 1–2 actual owned
   winning videos. Drop any inferred line with an invalid or missing citation.
4. Carry `stated` forward from the previous version. Insert the new `audience_profile` row.

### Orchestration

- `POST /api/app/audience/rebuild` (owner only): runs steps 1 through 5 in sequence and returns
  the new version. Long-running is fine for now; this is one channel.
- `POST /api/app/audience/stated` (owner only): saves the stated answers and rebuilds step 5 only.
- No cron in this build. The owner triggers rebuilds from the page.

## UI

One page, `/audience`, owner only, nav entry visible only to the owner (follow how Inspiration
gates its nav entry).

- **Profile brief** at the top: name, summary, and seven sections in the order above. Each line
  shows a small source mark for measured, inferred, or stated. Inferred
  lines expand to show their supporting quotes. Measured demographics render as bars or a short
  table, not prose.
- **Themes** below, grouped by type, each theme showing its label, observation, distinct-video,
  and distinct-author counts plus sample quotes. Presentation feedback is separate from the brief.
- **Stated answers** form: name, income, occupation, before, after, beliefs, drivers, interests,
  and owner buckets with 1–2 winning owned-video URLs each. Save triggers the
  stated route.
- **Rebuild** button with a version stamp and built-at time in Eastern. Last-run counts
  (comments fetched, observations, themes) on one line.

## Acceptance

1. Running rebuild for the owner's channel fills all five `channel_audience` dimensions.
2. `audience_comments` holds at least 1,000 rows for the owner's channel after the first pull
   with no raw author ids present.
3. Every `audience_observations.quote` is a verbatim substring of its comment's text.
4. Every inferred profile line references at least one existing theme or video id.
5. A second rebuild produces version 2 and preserves the stated answers.
6. A non-owner account gets a 404 from both API routes and sees no nav entry.
7. Unit tests cover report row parsing, comment batching and caps, quote verification, and
   profile assembly validation. Follow the `*.test.ts` convention next to each module.
8. Total Data API spend for a first rebuild is under 100 units, verified by counting pages.

## Sequencing for the implementer

Build in this order and show output after each step before moving on:

1. Migration and the comment fetch. Run it. Report row counts and unit cost.
2. Extraction on a 200-comment sample. Paste 30 observations for review before running the rest.
3. Clustering. Paste the themes.
4. Channel analytics pull.
5. Profile assembly and the page.

Steps 2 and 3 were reviewed by Brandon on September 14; he approved proceeding with the full
corpus while adding breadth counts and the quality corrections above.

## Settled and deferred questions

- Extraction uses `claude-sonnet-5`; Brandon approved its sample quality.
- Keep replies. Creator replies without audience signal are ignored during extraction.
- "Other channels your audience watches" remains deferred; the Analytics API does not expose it.
