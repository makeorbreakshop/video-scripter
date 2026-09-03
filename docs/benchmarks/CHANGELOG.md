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
