# Scoring benchmark changelog

One entry per accepted scoring change. A change is accepted only when
`npx tsx scripts/benchmark-scores.ts --compare <run.json>` says the target cells improved,
no cell regressed past the threshold, and held-out band calibration
(`npx tsx scripts/check-band-calibration.ts`) stayed within tolerance.
The protocol lives in the `outlier-score` skill (`~/shared-memory/skills/outlier-score/SKILL.md`).

## 2026-09-08 — v5.3: the channel curve estimates instead of going silent

**The defect, in Brandon's words:** "we should always be able to estimate that line even if we
don't have priors for that channel at that age. Something seems wrong." He is right.

`channelCurve` returned `typical: null` at every age where fewer than three priors could
CONTRIBUTE. In practice that is every age under about a day on any channel whose priors predate
launch sampling (which began 2026-09-01): a prior has no reading in its own first hours, and the
sub-day rule correctly refuses to stand a day-17 snapshot or a lifetime count in for hour five.
The consequence was not a missing prior, it was a missing ANSWER — the video page's "typical for
this channel" line began at day 1 with nothing to its left, and every sub-day score was null.

But a channel that has a level at day 3 has a level at hour 12. The shape of the first day is
what the global growth curve is FOR. Refusing to say so is not caution; it is silence wearing the
same face as ignorance, and the reader cannot tell them apart.

**The rule (v5.3).** Measured where measured — unchanged, and it still reports `measuredShare`.
Otherwise ESTIMATED: read C at the nearest rung of a fixed ladder (`ALL_BUCKETS` + day 30 +
`LONGTAIL_AGES`, nearest-first in log age) where the channel does have three contributions, and
slide it to the target, `C(anchor) x exp(growthLog(anchor, target))`. The channel's own
anchor→target ratio is blended in by n/(n+2) when at least five priors have a reading at BOTH
ends, else the global shape. The result carries `kind`, `anchorAge` and `measuredShare = 0`, so
the weaker claim is visible rather than hidden: dotted on the chart, `typical_kind` on the row.
Null survives for exactly one case — a channel with no level at ANY age, i.e. no scored priors.

The score is also no longer withheld below `AGE_FLOOR_HOURS`. G's reconstruction error there is
large and that is worth saying, but the way to say it is a word on the number (`confidence:
'early'`), not a blank where the number goes.

### The case that started it, on real priors

`npx tsx scripts/diagnose-curve.ts KFVqHUvp-0w --age 0.22 --params-version v5.2` — 3D Printing
Nerd, five hours old, the video the v5.2 sub-day work was written against. Its fifteen priors were
all first seen at day 17 or later, so nothing can be measured at hour five and nothing may be slid
there under `SUBDAY_SLIDE_MAX_AGE`.

| | v5.2 | v5.3 |
|---|---|---|
| C(0.22d) | null | 6,742, ESTIMATED from age 1.0d (n=15, neff=10.7, measuredShare 0) |
| score | null | 3.38, confidence `early` |

The old page-path number — `C(30) x exp(-logToRef(0.22))`, the line
`lib/admin/video-curve.expectedAtAge` used to draw — is 5,147, a factor of 1.31 below the
estimate. Both are the same growth curve; the difference is the lever arm. v5.3 anchors one rung
away (day 1) instead of thirty days away, which is the whole reason the ladder is nearest-first.

### Evidence, and what it is worth

**NOT ACCEPTED YET.** The gates in the header could not be run on 2026-09-08, and one of them
would not have measured this change even if it had.

**`benchmark-scores.ts` is blind to v5.3, structurally.** It replays `core.scoreVideo` — the v3
mechanism — not `scoreV5`, and it never calls `channelCurve`. A `--compare` against
`v3.0-2026-09-04` is therefore a wash BY CONSTRUCTION: it cannot show the sub-day coverage this
change adds, and a wash from it is evidence of no leak into `core`, not evidence of accuracy. Two
attempts also failed to complete: the 18-month population query over `view_snapshots` ran past
600s both times (the pool's `set statement_timeout` is issued on the `connect` event and does not
reliably beat the first statement, so it never fired). Cells before/after: **none measured**.

**The validation that does bear on the change** is new:
`backtest-baseline-trend.ts --estimate-coverage`. On channels that DO have launch samples, hide
every prior reading under a day — the exact starvation the rest of the corpus is in — and compare
the resulting ESTIMATE of C(0.5) against the C(0.5) those channels can actually measure:
`err = log(C_est / C_measured)`, reported as medALE, signed bias, and the share inside ±0.3 log.
Same priors, same kernel, same weights, one input removed; it measures the SLIDE and nothing
else, and it is not an outcome backtest.

### Outstanding before this ships

- Run `--estimate-coverage` to completion and record medALE / bias / within-±0.3 at t=0.5.
  It did not finish on 2026-09-08: the target query
  (`with recent as ... join view_samples`) ran >45 min and was observed RESTARTING under
  `pg_stat_activity` (a fresh `query_start` on a new pid while the client still waited), so it
  never returns. Cancelled server-side. The database was IO-bound all session —
  `wait_event = DataFileRead` on every backend — which is also what killed the two
  `benchmark-scores` attempts. Re-run when the database is quiet, or precompute the target list
  into a table first.
- `check-band-calibration.ts --params-version v3.0` — not run.
- Fit v5.3 params (`score_params` has no v5.3 row; the app needs `SCORE_READ_VERSION=v5.2` until
  it does) and rescore `--since 3`.
- Apply `sql/scoring-v5-3.sql` — NOT applied.
- Fix the harnesses' `statement_timeout`: set it in the connection string, not on `connect`.

## 2026-09-07 (review pass) — v5.2 corrections: k = 1.5, and rows that say which math wrote them

Four things the review found, all fixed on `scoring/v5.2-cadence`.

**1. `k = 2` was outside the F1 gate; shipped `k = 1.5`.** The −0.04 at t=7 sparse is real. It is
not the seed (there is none: the Jul–Aug 2025 holdout is the entire eligible population, 2,222
videos, and no other month has both an early and a day-30 snapshot — `--limit 3000` returns all of
it every time), and it is not the coverage confound (`--dump` on the cadence backtest now writes
one line per age/rule/video; restricted to the rows `tw30` and `cad2` both cover the F1s are
unchanged to three decimals, because every row the wider kernel newly covers is a true negative).

| slice | tw30 | k=1.25 | k=1.5 | k=1.75 | k=2 |
|---|---|---|---|---|---|
| t=3 sparse (n=141) | .653 | .625 | .625 | .625 | .625 |
| t=7 sparse (n=151) | .767 | .746 | **.746** | .733 | .733 |

k = 1.5 is inside the 0.03 gate at both ages; k = 2 is not, at t=7 (−0.034). What it costs: on
250 videos from tracked channels publishing slower than weekly, scored through the production
loader at each half-life, k = 1.5 recovers **56%** of the rows the fixed 30-day kernel starves
against k = 2's **61%** — 91% of the coverage, for half the F1 deficit. Said plainly, at t=7 the
whole difference between k=1.5 and k=2 is one video moving from true positive to false positive on
33 positives; neither is separable from noise, and honouring the gate is nearly free.
`--channels-min-gap`'s no-op boundary moves from a 15-day to a 20-day median gap.

**2. `video_scores.model_version` said `v5.1-rss` for v5.2 rows.** The writer used
`OBSERVATION_SCORE_VERSION` — the observation contract's tag — so the whole rescore claimed to be
v5.1 and sat indistinguishable beside the v5.0 rows it replaced. It also broke the refresh
watermark: `scoreRefreshSql` compares the stored label to the current one, so bumping
`MODEL_VERSION` without moving the written label meant nothing was ever due for rescore.
`SCORE_ROW_VERSION = MODEL_VERSION` now, at both write sites, the watermark and `FINAL_VERSION`;
the observation contract keeps its provenance in `video_score_history.extra.observation_version`.

**3. The equality test failed against production.** `lib/app/typical-curve.db.test.ts` compared
stored C(t) to a recomputation and came out 4.3× apart. The invariant is fine; the row selection
was not — `order by scored_at desc` lands on the corpus's oldest videos, whose priors predate
tracking and reach the curve through a LIFETIME count read at `now()`. That number grows between
write and read, and C(t) is a weighted MEDIAN, so a hair of movement snaps the answer to a
different prior's value (two failing rows returned exactly the neighbouring video's stored C(t)).
Restricted to `typical_measured_share = 1` and ages 1–60 days it is exact on 12 of 12 rows.

**4. Cadence and a change of speed.** `cadenceHalfLifeDays` reads the priors' gaps only. That is
right, and for a reason now pinned in `curve.test.ts`: `neff = (Σw)²/Σw²` is scale-free, so
pushing every prior uniformly further into the past leaves it untouched. A weekly channel that
stops for four months keeps its baseline; a channel sliding from weekly to monthly keeps it through
every step. What starves a channel is the SPREAD of its gaps, not their size.

### Still outstanding

- **The rescore must be redone.** All 101,825 rows were written at k = 2 and labelled `v5.1-rss`.
  No production run overlapped it (0 rows written between its end at 12:44:42Z and this review),
  so nothing is corrupted — but nothing carries the v5.2 label either, and the math has moved.
- **`channel_stats.baseline` is stale on 5,530 of 6,406 channels.** The refresh reached the ~500
  tracked ones; `channel_stats` covers `user_channels ∪ channel_tracking`. The header does
  `coalesce(max(cs.baseline), <newest scored C(30)>)`, so the stale STORED value wins and the
  majority of channel pages still show the lifetime median. One unscoped
  `npx tsx scripts/refresh-channel-stats.ts` fixes it.
- **Fit and mechanism moved together.** `score_params` was refitted under `v5.2` (26,480 videos)
  in the same hour as the kernel change, so the rescore's numbers cannot attribute a movement to
  the kernel. The backtests and leak checks were run on `v3.0` params and are unaffected.

## 2026-09-07 — v5.2: the baseline half-life is the channel's own cadence

"Normal for this channel" is judged in the channel's own rhythm. `lib/scoring/curve.channelCurve`
now weights priors with `halfLife = max(30, 1.5 x median publish gap of the priors)` instead of a
fixed 30 days (`cadenceHalfLifeDays`). `MIN_BASELINE_PRIORS` and `MIN_BASELINE_NEFF` are unchanged;
`MODEL_VERSION` -> `v5.2`. Backtest scripts still pass an explicit half-life, so they stay controls.

The problem (`~/shared-memory/knowledge/projects/video-scripter/2026-09-07-baseline-coverage-audit.md`):
a monthly channel's own previous video weighs half, the one before it a quarter, so `neff` falls
under 2 and the channel has NO baseline despite a full history. 12,379 corpus rows (38% of every
missing baseline) and 149 of 500 tracked channels. Steve Ramsey's 2026-01-20 video: `n_baseline 7,
typical_neff 1.43, baseline NULL`.

k = 2, not 3 or 4: it is the only value that is free on the slices the holdout can measure.

`scripts/scratch/backtest-baseline-cadence.ts --params-version v3.0 --limit 3000 --n-tw 15
--half-lives 30 --cadence-k 2 --no-trend` — 2,222 holdout videos, Jul-Aug 2025, centered oracle,
strict walk-forward censoring. `tw30` is the shipped kernel, `cad2` the candidate.

| t | slice | rule | n | cov | bias | base_medALE | score_medALE | F1 |
|---|---|---|---|---|---|---|---|---|
| 3 | all | tw30 | 1554 | 0.99 | 0.013 | 0.144 | 0.230 | 0.70 |
| 3 | all | cad2 | 1554 | 0.99 | 0.013 | 0.144 | 0.231 | 0.70 |
| 3 | weekly | tw30 / cad2 | 759 | 0.99 | -0.002 | 0.127 | 0.240 | 0.68 |
| 3 | sparse | tw30 | 141 | 0.96 | -0.000 | 0.145 | 0.247 | 0.65 |
| 3 | sparse | cad2 | 141 | 0.99 | -0.000 | 0.147 | 0.248 | 0.63 |
| 7 | all | tw30 / cad2 | 1669 | 1.00 | 0.006 | 0.131 | 0.166 | 0.76 |
| 7 | weekly | tw30 / cad2 | 816 | 1.00 | -0.000 | 0.122 | 0.166 | 0.76 |
| 7 | sparse | tw30 | 151 | 0.98 | -0.000 | 0.122 | 0.171 | 0.77 |
| 7 | sparse | cad2 | 151 | 1.00 | -0.000 | 0.135 | 0.175 | 0.73 |

Daily and weekly are byte-identical (2 x gap < 30 for anything published more often than
fortnightly). Sparse buys +2-4pp coverage for +0.002 base_medALE at t=3 and +0.013 at t=7.
**Recorded, not hidden: F1 on the sparse slice moves -0.02 at t=3 (inside the skill's 0.03 gate)
and -0.04 at t=7 (marginally outside it, on n=151).** The audit called that thin enough to want a
second cut; Brandon accepted the trade to fix the coverage. The measurable holdout also cannot see
the benefit at all — it requires >= 3 centered oracle neighbours, which selects for dense channels,
so the 12,379 starved rows are almost entirely outside it. k=3/k=4 fail the gate outright
(sparse t=3 F1 .65 -> .57 / .53).

Leak checks — the v3/v4 `core.scoreVideo` path must not move, and does not:
- `scripts/benchmark-scores.ts --params-version v3.0 --compare docs/benchmarks/v3.0-2026-09-04.json`
  — **0 better / 42 wash / 0 worse => wash**, every cell delta exactly 0.000.
- `scripts/check-band-calibration.ts --params-version v3.0` — 1,522 checks, inner **50.7%**
  (claims 50), outer **79.6%** (claims 80). Unchanged and calibrated.

BASELINE.json not moved: this is a v5-path change and the reference run is v3.0.

### Shipped alongside it (display, no scoring math)

- **The channel header baseline** was a lifetime median of every `video_scores.baseline` on the
  channel, in `channel_stats.baseline` and in the page's inline fallback alike. Both now read
  C(30) from the newest scored long-form video (`lib/app/channel-baseline.ts`, one shared SQL
  fragment). Karpathy 312,038 -> 5,782,654; Morley Kert 12,172 -> 899,262; Myers Woodshop
  8,486 -> 43; Steve Ramsey 121,367 -> 26,697. `refresh-channel-stats.ts` applied to all 500
  tracked channels; the plan is index-driven (`idx_video_scores_channel` + `videos_pkey`, a
  sort over ~130 rows per channel).
- **The video page's dashed "typical for this channel" line** is `channelCurve` at every age on
  the chart's grid, over the prior set the scorer uses (`lib/scoring/prior-load.ts`, factored out
  of `score-videos.ts`'s v5Batch). It was C(30) x the global growth shape, which is a different
  function and was therefore drawn as nothing at all for v5 rows. Ages with no curve leave a gap.
  `lib/app/typical-curve.db.test.ts` asserts `views / line(age) == the stored score` within 1% on
  live rows.

### Rescore

`score-videos.ts --channels-min-gap 15 --all --force` — 1,714 channels, 101,995 selected,
101,825 written. Videos that are `confidence='insufficient'` with `n_baseline >= 3` on tracked
channels: **1,492 -> 498**. Any baseline missing on tracked channels: 3,222 -> 2,228. Steve
Ramsey's six unscorable videos (2025-04-16 .. 2026-01-20) all score; his 2026-01-20 video went
from `neff 1.43, baseline NULL` to `neff 4.83, C(30) 48,252, 0.63x`. Channels publishing more
often than fortnightly were deliberately not rescored: the kernel is byte-identical there.

## 2026-09-04 — Shorts repair: 1,289 long-form videos returned to the corpus (BASELINE not moved)

Not a model change. `trigger_set_video_is_short` on `videos` was recomputing `is_short` from
duration (<= 180 s => Short) on every INSERT and on every title/description UPDATE, overwriting the
`/shorts/<id>` routing verdict the ingest path had just written — while `shorts_checked_at = now()`
was stamped beside it, so `longform.ts` trusted the wrong value and nothing ever re-checked it. The
trigger and `set_video_is_short()` were dropped (`sql/2026-09-04-drop-is-short-trigger.sql`);
`lib/ingest/is-short-trigger.test.ts` now fails if any trigger on `videos` touches `is_short`.

Re-verified the whole 61-180 s band stamped since 2026-09-03: **66,445 rows re-asked, 1,282
short->long, 65,163 confirmed short, 0 unknown, 0 gone**, plus 7 title-change stragglers outside the
window (all 7 long-form — the UPDATE-OF-title re-fire). A live spot check of 40 random flipped rows
agreed 40/40. Long-form videos published in the last 60 days: 68,052 -> 70,904. Channels whose
median stored baseline moved more than 10%: 310 of 5,440.

Benchmark after `--fit` + the incremental pass: `docs/benchmarks/v5.0-2026-09-04.json`, compared
against BASELINE (`v3.0-2026-09-04.json`) — **10 better / 30 wash / 2 worse => worse**. The gains are
F1: heldout t=2 .560->.667, t=3 .645->.769, t=5 .791->.837; time t=1 .507->.548, t=2 .633->.667.
The two `worse` cells are heldout medALE at t=0.5 (.568 -> .591, n=23), the smallest and already
worst cell in the table and the one the open sub-day/`logMultTo30` finding owns.

**BASELINE.json was NOT moved**, for two reasons. (1) The rule: not every cell is wash-or-better.
(2) More importantly this is not a controlled comparison — the reference is a v3.0 run and the
candidate is v5.0 (production moved to v5.0 in a concurrent session while this repair was running),
and the corpus population changed underneath both. Model change and population change are confounded
here, so no cell in this table should be read as the effect of either one alone. The next clean
v5.0-vs-v5.0 run is the one that should move the pointer.

## 2026-09-04, 2:10-3:00 PM ET — v5.0 DEPLOYED

Brandon approved the merge, rescore and deploy explicitly. The v5 build entry below stands as the
record of what was verified; this entry is what shipping it actually cost.

**Migration.** `video_score_history` + `video_scores_by_version` + the v5 `video_scores` columns,
DDL in one transaction, then every current `video_scores` row copied into history verbatim.
187,344 rows in, 187,344 out, 187,344 distinct `video_id`, **95,164** still carrying
`v3.1-semantic-backfill-2026-09`.

**The migration was wrong the first time, and the way it was wrong is worth keeping.**
`scripts/migrate-score-history.ts` paged `video_scores` on a `video_id` keyset but took each
page's maximum with a JavaScript `reduce`. This database is `en_US.UTF-8`, whose text ordering is
not codepoint order; JS string comparison is. The keyset ranges therefore overlapped and the first
apply wrote **193,545 rows for 186,743 videos** — nothing skipped (the distinct count matched
exactly), 6,802 duplicated. Caught by comparing history against `video_scores` per
`model_version` mid-run, killed, table truncated, re-applied clean. Collating the scan `"C"` to
match JS was the obvious fix and the wrong one — it costs a full sort per batch instead of the
`video_scores_pkey` index scan. The page keeps the index's own order and the cursor moved into
SQL (`max(video_id)` over the page). **Any keyset page whose cursor is computed outside the
database must be collated the way the database collates, or computed by it.**

**Merge.** `git merge --no-ff scoring/v5-same-age` into `main` at `f5bfb47`. One conflict,
`lib/app/video-page.ts`, and it was two imports both sides needed. No stash: the chart WIP that
stopped the previous attempt had been committed (`b102b77`) before this session started, and the
tree's remaining dirt was untracked scratch.

`main`'s `longform-guard` test — added after this branch was cut — failed on the merge:
`scripts/loo-paired.ts` filtered Shorts with a hand-rolled `coalesce(is_short,false) = false`,
which re-admits the 63-180s clips ingest never flagged. Migrated to `longformSql` rather than
allowlisted. Gates after that: jest `lib/scoring lib/app lib/semantic` **73 suites / 942 tests
green**; `tsc --noEmit` **zero** errors in `lib/scoring`, `lib/app`, `scripts/score-videos.ts`
(the repo's 1,662 pre-existing legacy errors and its `scripts/` TS1378 noise are unchanged).

**Fit.** `score_params` **id 30**, `v5.0`, n=22,883, 18:27:40Z. The past-30 half of G again found
**zero** (day-30, >=60d) snapshot pairs inside 12 months and fell back to all time, logging it —
the long tail is still not temporal, as the build entry predicted.

**Rescore.** 695,156 videos. The first `--all` died silently at ~7,700 rows with no error and no
completion line. It is now run as bounded passes (`scripts/scratch/rescore-loop.sh`,
`--all --limit 20000`): `--all` selects videos whose stored score is older than their latest
reading, so each pass converges on the remainder and a killed pass costs one pass, not the run.
~26 videos/s, so roughly 7 hours. **In progress at the time of writing.**

**What the history table bought, measured.** As the rescore overwrites `video_scores`, the
`v3.1-semantic-backfill-2026-09` count there falls (95,164 -> 95,107 within the first twenty
minutes) while `video_score_history` holds all **95,164**, and
`select count(*) from video_scores_by_version where model_version = '...'` returns **95,164**.
That is the whole point of the migration, and it is now demonstrated rather than argued.

**Deployed.** Vercel production build Ready. Feed and video page verified signed-in: the video
page reads *"1.2x — typical 7K at 2d old · on pace for 17K by day 30 · early read"*. Same-age
leads, the age is on the line, day 30 is the secondary number.

**Two defects found on the deployed page, both fixed here.**
1. `app/app/_components/feed-card.tsx` was never touched by the v5 branch and still printed
   `"1.1M by day 30 · typical 458K"` — day 30 first, and an unlabelled `typical` that `cec3b48`
   had just redefined as C(30). Beside a day-30 projection that reads as a day-30 number, and it
   contradicted the video page's verdict, which the card's own comment says it must match.
   `typical_at_age` now comes out of `video_scores` through `lib/feed/query.ts` and the card leads
   with it; a row the rescore has not reached has no `typical_at_age`, so the old line remains as
   the fallback. `lib/app/age-words.ts` holds the age words so the two surfaces cannot drift.
2. `lib/app/feed-format.ts` labelled `baseline` "at this age". After `cec3b48` that column is
   C(30). It says "by day 30".

**The corpus is being rescored while the model is being changed, and that is a real problem.**
Three commits landed on `main` from another session during the rescore that alter what a v5 row
means: `cec3b48` (`baseline` = C(30), not C(t)), `d2d9a57` (the video page reads
`typical_at_age`), and `2aa381c` (a genuine bug — `curve.contributionAt` applied the forward
blend when sliding a prior BACKWARD, giving a 3.6x too-high `typical_at_age` on sparse channels
sub-day). Each pass spawns a fresh `tsx` and picks up whatever is committed then, so **the corpus
will carry mixed semantics**: rows written before a fix keep the old meaning and `--all` will not
reselect them, because their `scored_at` is newer than their latest reading. The 828 rows written
before `cec3b48` were corrected by rolling their `scored_at` back so the loop re-picked them; the
rows written before `2aa381c` have not been. **Once the model stops changing, the corpus needs one
more full pass** — `update video_scores set scored_at = '2000-01-01' where model_version like
'v5%'` and let the loop run — or the sub-day scores on sparse channels stay wrong for as long as
their next snapshot takes to arrive.

**Still true, and unchanged by shipping it:** v5's own projection band calibration fails (inner
15.4% / outer 61.5% at T=30 on n=13). `PROJECTION_MAX_DAYS = 30` caps the blast radius. Do not
present the projection range as calibrated.

## 2026-09-04 — v5.0 same-age score: BUILT AND VERIFIED, not accepted, not deployed

Worktree `vs-v5-same-age`, branch `scoring/v5-same-age`, cut from the accepted v4 branch.
Spec: `~/shared-memory/knowledge/projects/video-scripter/v5-same-age-score-spec.md`.
Main checkout confirmed on `main` before every DB step. **Zero `v5.0` rows in `video_scores`** —
`scripts/score-videos.ts` refuses to run its v4 write paths under a v5 `MODEL_VERSION`, and the
`--v5` mode writes a CSV. Two `score_params` rows keyed `v5.0` written (harmless: production
reads `v3.0`).

**What changed.** `score(t) = v(t) / C(t)` at true age; day 30 is no longer the anchor and the
day-30 number becomes a projection at a selectable horizon.
- `lib/scoring/growth.ts` — ONE growth function. `logToRef(params, age)` is a single cumulative
  curve from the first launch bucket to the last long-tail age, so the v3/v4 sub-day disagreement
  (`logMultTo30`'s day-1 clamp ~2.4× vs `scoreVideo`'s fitted ladder ~3.24×) no longer exists.
  `growthLog(from, to)` is its difference: identity at `from == to`, monotone, continuous at the
  day-1 and day-30 seams, exactly antisymmetric. The channel blend and the per-video Q correction
  ride as a positive scale chosen so `anchor → 30` reproduces v3's `remaining` term.
- `lib/scoring/curve.ts` — `C(t)`, the v4 time-weighted log median read at ANY age. Each prior
  contributes a real sample at `t`, else its nearest sample slid along G, else its lifetime count
  slid back. Every contribution carries kind and log-distance, so a score reports its measured
  share.
- `scripts/benchmark-v5.ts` — the spec's parts 1–7. `docs/benchmarks/v5.0-2026-09-04.verification.{md,json}`.

**Verdicts** (5,000 target videos, 87,835 neighbours, 18-month window; every n in the report).
- **1 G accuracy (leave-one-out), PASS.** Gate: medALE ≤ .10 within 30d at distance ≤ 1 bucket —
  **.013 on n=2,774**. By distance: .011 / .041 / .112 / .180 at ≤.35 / .35–.7 / .7–1.4 / >1.4.
- **1b where G is weakest.** Below 4 hours it is not usable: medALE **1.60 (n=55) under 1h** and
  **1.06 (n=139) 1h–4h**, against .048 at 3–7d and .010 at 60–180d. The 365d–1500d bucket is the
  other weak spot (**.171, n=8,272**). The fitted ladder says a video has 69× its 1-hour count
  still to come by day 30; that number is chained through day 1 from 1,167 pairs and it is the
  single largest error source in the model.
- **2 C accuracy.** Interpolated vs real-only: medALE .088/.125/.090/.132/.115 at t=1/3/7/30/90
  (n 399–909), bias 0.000 everywhere. Censored vs centered oracle: .320/.323/.318/.347/.355
  (n=968), bias ≈ −.007 — the trailing rule is unbiased but noisy, unchanged in character from v4.
- **3 score accuracy.** On rows where the ratio is fully measured, medALE is **0.000 in 15 of 17
  cells** — but read that correctly: `C` is a weighted MEDIAN, so adding interpolated
  contributions to three real ones usually does not move it. Spearman .90–.99, F1@2× .89–1.00
  (time split n 35–156, heldout n 3–24). The cells that move are the low-measured-share ones.
- **4 projection.** medALE .061 (14→30, n=100), .147 (7→30, n=57), .204 (3→30, n=35), .357
  (1→30, n=34); to 365d, .236 (from 30d, n=145) up to .615 (from 1d, n=143). Band calibration on
  held-out: inner **38–56%**, outer **63–67%** against 50/80 nominal, on n=9–76 per horizon.
  **Not passing, and n is too small to call.** The projection bands need their own fit.
- **5 stability.** .148 (0.5→1), .102 (1→2), .072, .046, .029, .042, .056, .034. The 1→2 step is
  **.102 against v4's .208** — halved, because the denominator no longer moves with a forecast.
- **6 backfill fidelity.** Lifetime slid back to a real reading: medALE .246 at 30d (n=5,041),
  .147 at 90d (n=8,788), bias −.08/−.09. Weak, and the reason `measured_share` exists.
- **7 regression to v4 at t=30.** medALE **.002**, Spearman **.999**, **97.8% within ±10%**,
  **100% same outlier call** on n=368. Nothing silently changed at the one age both models define.
- **8 gates.** Leak query returns zero v5 rows. Prod on `main`. Rescore + deploy NOT done.

**Controls on the v4 path, which v5 does not touch.** `benchmark-scores.ts --params-version v3.0`
reproduces the accepted v4 verdict exactly: **10 better / 32 wash / 0 worse → better**. Run at
`--params-version v4.0` instead it reads **10 / 30 / 2 → worse** on the two sub-day cells — the
launch-ladder confound the v4 round documented, reproduced here as a control.
`check-band-calibration.ts --params-version v3.0`: inner **50.6%**, outer **79.5%** on 1,522
held-out checks.

**Two defects found and fixed during the build.**
1. `blendScale` indexed the channel multiplier and Q bins by the RAW age (`params.mult[3.0082]`),
   so both terms were silently dropped for every reading not landing exactly on a bucket. Caught
   on a real video: v5 projected 797,287 at day 30 against v4's stored `est30` of 1,105,421.
   Now bucketed via `bucketFor`, and pinned by two tests.
2. Fitting projection bands over `BAND_AGES` collapsed the whole table to zero width (a thin
   first bucket carries forward as zeros, and `fitBands` then forces width non-increasing),
   reporting 0%/0% coverage. Fit over the ages actually present instead.

**One thing the spec asked for that the data cannot supply.** The past-30 half of G was to be
refit from snapshot pairs in a trailing 12-month window. There are **ZERO** same-video
(day-30, ≥60d) snapshot pairs inside 12 months — the snapshot store starts 2025-06-30 and every
video with a recent day-30 reading is either under 60 days old or was never re-snapshotted past
60. All 26,447 such pairs in the corpus come from the first weeks of tracking. The fit falls back
to an all-time window and logs it. **The long tail is not temporal.**

**Cost of the old-video revisit.** v5 drops the 60-day ceiling, so a video is rescored whenever a
new snapshot lands. **No extra YouTube API calls** — it consumes snapshots the tracker already
takes. DB: ~53,700 snapshots/day land on videos past 30 days (against ~17,900/day under 30), and
the scorer runs at ~27 videos/s measured on a 2,000-video pass, so the revisit adds ~33 min/day
spread across the hourly ticks. A full-corpus v5 pass is 693,806 videos ≈ 7.1 hours.

## 2026-09-03 — v3.0 baseline recorded

First run of `scripts/benchmark-scores.ts`. No model change; this establishes
`docs/benchmarks/BASELINE.json` -> `v3.0-2026-09-03.json` as the reference every future
candidate is compared against.

Headline (time split, pooled): medALE .334/.231/.192/.142/.100/.037 and outlier F1
.521/.642/.710/.792/.864/.908 at t = 1/2/3/5/7/14. Day-3 outlier call: precision .846,
recall .611, F1 .710 (time, n=314) and precision .846, recall .579, F1 .688 (heldout, n=102).

Two findings recorded in the run's notes:
- `core.logMultTo30` and `scoreVideo` disagree below day 1 — the former clamps to the day-1
  multiplier, the latter uses the fitted launch ladder. The forecast is ~18% high at t=0.5 by
  this benchmark and ~22% low by the band fit, for that reason.
- The F1 gap against the Python harness (`harness-v2/baseline_v3.csv`) is the price of baseline
  coverage: 87% of the median row's baseline priors are derived rather than measured, where the
  harness dropped those rows entirely.

## 2026-09-04 — v4.0 channel baseline: time-weighted median in log space

The channel baseline stops being a plain median of the priors' day-30 estimates and becomes an
exponentially time-weighted median in LOG space:

```
w_i      = 2^(-ageDays_i / 30)          ageDays = target publish - prior publish
baseline = exp( weightedMedian( log v30_i, w_i ) )    over <= PRIOR_WINDOW (15) fresh priors
```

with two floors: `>= 3` priors AND effective n `(sum w)^2 / sum w^2 >= 2`, else the baseline is
null and confidence is `insufficient`. `PRIOR_WINDOW_SPARSE` no longer applies to the baseline —
the kernel down-weights a sparse channel's old priors instead of truncating them by count — but
it still governs the est30 side, which is byte-for-byte unchanged (`priorMultLogs`,
`priorSameAge`, and `core.priorV30`'s real/lifetime/projected estimation are untouched).

Proposed by `scripts/backtest-baseline-trend.ts` against a *centered* oracle
(`docs/benchmarks/baseline-trend-run3-controls.txt`), which is a different and stricter test than
`backtest-baseline.ts`, whose oracle is the trailing rule's own prior set.

**What moved** (`v4.0-pv3.0-2026-09-04.json` vs `v3.0-2026-09-04.json`, 10 better / 32 wash /
0 worse). `no_change` equals `pooled` on this population — packaging coverage starts 2026-09-01,
so the cells below are the model's own error, read on `no_change`:

| split | t | F1 v4.0 | F1 v3.0 | Δ | recall v4.0 | recall v3.0 |
|---|---|---|---|---|---|---|
| heldout | 2 | 0.667 | 0.560 | **+0.107** | 0.615 | 0.500 |
| heldout | 3 | 0.769 | 0.645 | **+0.124** | 0.667 | 0.526 |
| heldout | 5 | 0.837 | 0.791 | **+0.047** | 0.783 | 0.680 |
| time | 1 | 0.541 | 0.507 | **+0.033** | 0.488 | 0.400 |
| time | 2 | 0.667 | 0.633 | **+0.034** | 0.596 | 0.500 |

The gain is recall: a denominator that tracks the channel's current level stops hiding real
outliers behind stale history. Precision gives back a little at t=5/7 heldout (.944 -> .900,
.952 -> .846) and F1 still nets positive or wash everywhere.

**What did not move, by construction.** medALE is a pure `est30` metric and the baseline is not
in `est30`, so every medALE cell is a wash (|Δ| <= 0.004, median per-row |log(est30 ratio)| =
0.000000 at t=2 and t=3). Bias keeps `q50 ≈ 0` from day 2 on (.030/-.008/.030/.018/.003/.001
heldout). Stability is a wash: 1->2 churn .203 -> .208, 2->3 .104 -> .103, 3->5 .106 -> .107,
5->7 .069 -> .067, 7->14 .080 -> .082, 0.5->1 .057 -> .049.

Held-out band calibration (against the last banded v3.0 params row): inner 50.7% / outer 79.6%
on 1,522 checks — target 50/80, and unchanged by this candidate since the bands measure
`logMultTo30`, which a baseline-only change does not touch.

**Two harness defects found and fixed while running this.**

1. `benchmark-scores.ts` and `check-band-calibration.ts` read the long tail and the sub-day
   launch ladder from `score_params` keyed on `MODEL_VERSION`, and neither can be refit from
   train rows. So a MODEL_VERSION bump *silently also swaps in a freshly fitted launch ladder*,
   and the sub-day cells move for a reason unrelated to the change under test. The first v4.0
   run showed exactly this: t=0.5 heldout medALE .568 -> .588 (a `worse` verdict) purely because
   the new ladder puts 3.25x at half a day where the champion's row had 3.18x; every cell from
   day 1 on was identical. Both scripts gained `--params-version` (default: this build's
   `MODEL_VERSION`), and the accepted comparison above is `--params-version v3.0`, i.e. the same
   carried-over tables as the reference. **Any future MODEL_VERSION bump must be compared this
   way, or the ladder drift will be read as the candidate's doing.**
2. `check-band-calibration.ts` took the newest `score_params` row for its version, but the
   nightly `--fit` rewrites that row *without* bands (`fit-forecast-bands.ts` is a separate job),
   so the check had been exiting with "score_params has no bands" since this morning's fit — on
   the champion too. It now takes the newest row that actually carries bands.

Not rescored and not deployed; both need Brandon's approval. `BASELINE.json` still points at
`v3.0-2026-09-04.json`.

## v5.0 — deploy build, 2026-09-04 (NOT DEPLOYED; stopped at the pre-flight)

Branch `scoring/v5-same-age`. The build asked for by the deploy plan is complete and gated; the
deploy was **stopped at Phase 2a** because the production checkout was being edited live (see
"Why this is not deployed" below). No migration was applied, nothing was merged, nothing pushed.

**Score history.** `video_score_history` (append-only, one row per video per write) plus
`video_scores_by_version` (the latest history row per (video, model_version)). `video_scores`
keeps its role as the current answer. Every write path — hourly, `--all`, `--final`, and the
semantic backfill — appends to history in the same batch. This is what makes a rescore
reversible in evidence, and it is what stops the v5 pass from erasing the 95,164
`v3.1-semantic-backfill-2026-09` rows the semantic eval reads by that exact label; the two
scripts that pin the label now read the view.

**One place that says which version the app reads.** `scoreReadVersion` / `scoreParamsQuery`
replace the hardcoded `'v3.0'` in `lib/app/video-page.ts` and `lib/admin/queries.ts`. Those were
already wrong at v4 and would have drawn v3 growth curves under v5 scores. `SCORE_READ_VERSION`
overrides for a rollback.

**Sub-day ladder refit — a NULL RESULT.** The ladder is refitted in `growth.ts` (one G, one fit)
from `view_samples` since 2026-08-01, samples only on the hour-h side, minRows 200, winsorised
at the 5th/95th per bucket, and a starved bucket carries the younger one forward instead of
being skipped for `logToRef` to interpolate across.

Re-running the full harness read <1h 1.602 → 1.166 and 1h–4h 1.063 → 1.431. **Neither number is
real** — the harness resamples its 5,000 targets each run, so that is two samples, not two
models. `scripts/loo-paired.ts` reconstructs the SAME hidden readings under both params rows,
on 5,697 videos with sub-day readings:

| bucket | n | medALE old | medALE new | Δ |
|---|--:|--:|--:|--:|
| <1h | 147 | 2.756 | 2.816 | +0.061 |
| 1h–4h | 196 | 1.724 | 1.725 | +0.001 |
| 4h–12h | 499 | 0.414 | 0.408 | −0.006 |

Nothing moved. The old 30-day publish window already covered the launch-tracker era, so every
hour bucket already exceeded 200 rows and none was ever carried, and winsorising barely moves a
median. The refit buys provenance and a failure mode, not accuracy. **The sub-day error is not a
ladder-fit problem.** Any future before/after on this harness must be paired.

**`AGE_FLOOR_HOURS = 4`** is what actually addresses the sub-day error: below it G's own
reconstruction error is 170%+, so the score is null with confidence `early` and only the raw
views are stored. The +0.061 regression at <1h sits under the floor, so no shipped score rests
on it.

**`PROJECTION_MAX_DAYS = 30`** with the v4 bands; 90/365 stay measured but behind
`LONG_HORIZONS_ENABLED = false`. `project()` itself still answers any horizon.

**Write paths are v5.** The guard is gone. `score()`, `final()` and the `--v5` dry run share one
`v5Batch`, so the CSV and production cannot answer differently. The v3/v4 column names are
remapped rather than left null, because the app, the API and the extension read them:
`score` = v(t)/C(t), `baseline` = C(t), `n_baseline` = contributing priors, `est30` = the 30-day
projection. `--all` drops the 60-day ceiling.

**Copy.** Two surfaces printed the denominator unlabelled next to a day-30 projection
("on pace for 186K by day 30 · typical 92K"), which reads as a day-30 baseline — the one thing
C(t) is not. The age is on the line now.

**Controls, all passing.**
- `npx jest lib/scoring lib/app lib/semantic` — 65 suites, 750 tests, green.
- `npx tsc --noEmit` — no new errors on any touched file.
- `benchmark-scores.ts --params-version v3.0 --compare v3.0-2026-09-04.json` — **0 better / 42
  wash / 0 worse**. The T=30 cells did not move; this run exercises the untouched v3 path and is
  the control that says so.
- `check-band-calibration.ts --params-version v3.0` — inner **50.6%**, outer **79.5%**, n=1,522,
  against 50/80 nominal.

**Known and unfixed:** v5's own projection band calibration (verification part 4) still fails —
inner 15.4% / outer 61.5% at T=30 on n=13. Capping the shipped horizon at 30 does not fix it; it
limits the blast radius. Do not present the projection range as calibrated.

**Why this is not deployed.** Phase 2a requires the production checkout at
`~/video-scripter-v2/video-scripter` to be clean apart from a known set of untracked files.
At 14:05 ET it held a commit from 13:53 (`ecba5bc`, chart zoom) and uncommitted edits to
`components/app/video-chart-plot.tsx`, `lib/app/chart-style.ts`, `lib/app/chart-zoom.ts` plus new
untracked `lib/app/chart-brush.ts` and `lib/app/chart-copy.test.ts`, last written 2–7 minutes
earlier. Someone is working in that checkout right now, in `lib/app` and `components/app` — the
exact area the merge was flagged to conflict in. Merging into a tree with live uncommitted work,
and pushing a `main` carrying a commit that was not part of the approved set, is not a thing to
do on my own judgement. Stopped, nothing applied.

`BASELINE.json` still points at `v3.0-2026-09-04.json`. **Leak check clean: zero `v5.0` rows in
`video_scores`.** Two more `score_params` rows written for `v5.0` (id 29 carries the new ladder)
— harmless, production reads `v3.0`.
