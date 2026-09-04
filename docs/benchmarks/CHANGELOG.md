# Scoring benchmark changelog

One entry per accepted scoring change. A change is accepted only when
`npx tsx scripts/benchmark-scores.ts --compare <run.json>` says the target cells improved,
no cell regressed past the threshold, and held-out band calibration
(`npx tsx scripts/check-band-calibration.ts`) stayed within tolerance.
The protocol lives in the `outlier-score` skill (`~/shared-memory/skills/outlier-score/SKILL.md`).

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
