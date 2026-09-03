# J5 metadata-only challenger

Status: stopped at the dev gate. Neither challenger qualifies for a new confirmation set. No held-out or confirmation tasks were run.

## Result

| Variant | Lower P@10 | Upper P@10 | Lower nDCG@20 | Direct application@10 | Unresolved top 10 | Hit both tasks | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cross_encoder | 0.150 | 0.150 | 0.223 | 0.850 | 0 | no | fail |
| purpose_mechanism | 0.200 | 0.250 | 0.140 | 0.750 | 1 | yes | fail |

The gate required lower-bound creative precision@10 >= 0.300, direct-application rate <= 0.200, at least one creative hit on each dev task, and zero unresolved top-10 items.

The local cross-encoder improved ordering for Make or Break Shop but returned no creative hit in the tech task and mostly copied the source niche. The purpose/mechanism verifier found a creative hit in both tasks, but mean creative precision was only 0.200, direct application remained 0.750, and one unresolved item entered the top 10.

## Cost and timing

- Cross-encoder: pinned local MS-MARCO MiniLM-L6-v2 on Apple MPS; warm full-pool batch p50 676.8 ms, p95 714.1 ms.
- Purpose/mechanism: 400,579 input and 72,220 output tokens; cost upper bound $0.059417, including $0.0105 reserved for five rejected malformed calls.
- Total semantic work through this stop: at most $0.426903 ($0.367486 frozen prior ledger plus this challenger).
- The API timing is a cold offline batch total across 63 calls, not endpoint latency. Cached frozen facets/rankings require no model call.

## Decision

There is no J5 challenger to promote. Stop before a confirmation set, corpus-wide facet extraction, endpoint work, or deployment. The metadata-only candidate pool contains useful creative ideas, but neither generic relevance nor the first purpose/mechanism prompt separates them from direct copying reliably enough.

The original v1 §10 experiment A (video document recipe) and D (query strategy) still have no valid winner: revision 4 deliberately reset the invalid provisional eval and did not authorize those bake-offs. This J5 test must not be relabeled as an A/D win.
