# Scoring benchmark changelog

One entry per accepted scoring change. A change is accepted only when
`npx tsx scripts/benchmark-scores.ts --compare <run.json>` says the target cells improved,
no cell regressed past the threshold, and held-out band calibration
(`npx tsx scripts/check-band-calibration.ts`) stayed within tolerance.
The protocol lives in the `outlier-score` skill (`~/shared-memory/skills/outlier-score/SKILL.md`).

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
