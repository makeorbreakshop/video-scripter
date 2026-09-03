# J5 metadata-only challenger

Status: stopped at the dev gate. Neither challenger qualifies for a new confirmation set. No held-out or confirmation tasks were run.

## Result

| Variant | Lower P@10 | Upper P@10 | Lower nDCG@20 | Direct application@10 | Unresolved top 10 | Hit both tasks | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cross_encoder | 0.200 | 0.250 | 0.184 | 0.700 | 1 | yes | fail |
| purpose_mechanism | 0.150 | 0.150 | 0.161 | 0.850 | 0 | yes | fail |

The gate required lower-bound creative precision@10 >= 0.300, direct-application rate <= 0.200, at least one creative hit on each dev task, and zero unresolved top-10 items.

The challengers used the exact title, channel, and description shown in the blind judgment pools. The target context used only the frozen task intent and channel identity. Artifact hashes, upstream links, rankings, and metrics are revalidated when this report is generated. The original per-judgment hash covers the candidate payload rather than the entire task-and-rubric view; the frozen blind-pool and assignment hashes preserve that surrounding context, but this remains a residual provenance limitation.

The primary purpose/mechanism pass emitted 38 internally inconsistent creative labels. The single repair pass produced valid decisions for 37; 1 remained invalid and the deterministic safety rule demoted it to the bottom as low-confidence output. 0 fallback results appeared across the two tasks' top 20s.

## Cost and timing

- Cross-encoder: pinned local MS-MARCO MiniLM-L6-v2 on Apple MPS; warm full-pool batch p50 613.5 ms, p95 677.7 ms.
- Purpose/mechanism: requested gpt-5-nano; provider returned gpt-5-nano-2025-08-07. The completion run used 238,318 input and 48,282 output tokens and cost $0.031229.
- The withdrawn mismatched-input run remains charged at $0.059417. Its 400,579 input and 72,220 output tokens cover metered accepted and rejected calls; the upper bound also includes an extra conservative allowance for malformed responses.
- The interrupted corrected-input run had unpersisted transfer usage and is conservatively charged the entire remaining original cap: $0.440583. Challenger spend is therefore at most $0.531229.
- Total semantic work through this stop: at most $0.898715 ($0.367486 frozen prior ledger plus all challenger attempts).
- The API timing is a cold offline batch total across 67 calls, not endpoint latency. Cached frozen facets/rankings require no model call.

## Decision

There is no J5 challenger to promote. Stop before a confirmation set, corpus-wide facet extraction, endpoint work, or deployment. The metadata-only candidate pool contains useful creative ideas, but neither generic relevance nor the first purpose/mechanism prompt separates them from direct copying reliably enough.

The original v1 §10 experiment A (video document recipe) and D (query strategy) still have no valid winner: revision 4 deliberately reset the invalid provisional eval and did not authorize those bake-offs. This J5 test must not be relabeled as an A/D win.
