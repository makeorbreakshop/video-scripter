---
title: Audience profile from YouTube analytics and comment mining
status: draft
artifact_readiness: prd
execution: code
owner: brandon@makeorbreakshop.com
---

# Audience profile from YouTube analytics and comment mining

## Outcome

Build a data-derived audience profile for a connected YouTube channel. Instead of interviewing
the creator about who watches them, the app reads the channel's own analytics (who they are, how
they watch, how they arrive), mines the channel's comments into typed, quoted observations, and
clusters those into themes. A profile record assembles the result into seven sections, every field
tagged with where it came from. That profile becomes the context the app hands to any future
idea generation or outlier-translation step, so the model reasons about a real audience rather
than a generic one.

Reference for the shape of the output: John Malecki's Idea Heist "Audience Avatar" card
(name, one-paragraph summary, demographics, identity + values, behavioral specifics,
frustrations, desires, before/after transformation). Ours has the same sections but each line
is measured, inferred from evidence, or stated by the creator, and inferred lines link to the
comments that support them.

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

Four new tables. All timestamps `timestamptz`. All keyed for direct-Postgres access.

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
  "summary": { "text": "...", "source": "inferred" },
  "demographics": [
    { "field": "age", "value": "45-64 (58%)", "source": "measured" },
    { "field": "gender", "value": "male (81%)", "source": "measured" },
    { "field": "location", "value": "US 64%, UK 8%, CA 6%", "source": "measured" },
    { "field": "income", "value": null, "source": "stated" }
  ],
  "identity_values": [ { "text": "...", "source": "inferred", "theme_ids": [12, 15] } ],
  "behaviors": [ { "text": "Watches on TV, evenings", "source": "measured" }, { "text": "...", "source": "inferred", "theme_ids": [3] } ],
  "frustrations": [ { "text": "...", "source": "inferred", "theme_ids": [7] } ],
  "desires": [ { "text": "...", "source": "inferred", "theme_ids": [9] } ],
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

Cost: 1 Data API unit per page. A full first pull is about 30 to 40 units.

### Step 3: Extraction

`mineComments(channelId)`:

1. Select unmined comments, batch by video, 40 comments per LLM call.
2. Prompt (cheap model, `claude-haiku-4-5-20251001`) returns a JSON array of observations:
   `{ comment_id, type, quote, summary, confidence }`. Instruct it to return nothing for comments
   with no signal (pure praise like "great video" is `praise` only if it names what was good).
   Quote must be a verbatim substring of the comment; reject any that is not.
3. Insert into `audience_observations`, set `mined_at` on the comments.

### Step 4: Clustering

`buildThemes(channelId, version)`:

1. For each observation type with at least 5 observations, send all summaries for that type
   (id plus summary, no quotes) to the strong model (`claude-sonnet-5`) and ask for clusters:
   `{ label, description, observation_ids }`. Cap at 8 themes per type. Singletons are dropped.
2. Insert `audience_themes` rows, set `theme_id` on member observations.

### Step 5: Profile assembly

`buildProfile(channelId)`:

1. Read `channel_audience`, the latest themes, and the top 20 videos by average view percentage
   and by subscribers gained per view from `daily_analytics` joined to `videos`.
2. Measured fields are filled in code, not by the model.
3. The model (`claude-sonnet-5`) receives the measured facts, the themes with counts, the top-video
   titles, and the creator's `stated` answers, and returns `summary`, `identity_values`,
   the inferred `behaviors`, `frustrations`, and `desires`. Every inferred item must cite
   `theme_ids` or `video_ids` that exist; drop any that does not.
4. Carry `stated` forward from the previous version. Insert the new `audience_profile` row.

### Orchestration

- `POST /api/app/audience/rebuild` (owner only): runs steps 1 through 5 in sequence and returns
  the new version. Long-running is fine for now; this is one channel.
- `POST /api/app/audience/stated` (owner only): saves the stated answers and rebuilds step 5 only.
- No cron in this build. The owner triggers rebuilds from the page.

## UI

One page, `/audience`, owner only, nav entry visible only to the owner (follow how Inspiration
gates its nav entry).

- **Profile card** at the top: name, summary, and the seven sections, in the order of the
  reference card. Each line shows a small source mark for measured, inferred, or stated. Inferred
  lines expand to show their supporting quotes. Measured demographics render as bars or a short
  table, not prose.
- **Themes** below, grouped by type, each theme showing its label, count, and sample quotes.
- **Stated answers** form: avatar name, income, occupation, before, after. Save triggers the
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

Steps 2 and 3 are where the quality risk sits. Do not build the page until the themes read as
real to Brandon.

## Open questions

- Model choice for extraction can move to `claude-sonnet-5` if Haiku's observations are noisy on
  the sample. Decide after step 2.
- Whether to keep replies. Default is yes, since replies from the creator often draw out the
  specific frustration.
- Whether "other channels your audience watches" is worth adding by hand as a stated field, since
  the Analytics API does not expose it.
