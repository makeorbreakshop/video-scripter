# Design Brief — /app/inspiration

## Design read

For a creator looking for the next useful idea, make it easy to choose their target channel,
control how far outside its content territory to explore, and judge why each result surfaced,
while keeping the experiment private, programmatic, reversible, and honest about its bounded
one-year outlier corpus.

## Primary path

1. Choose one tracked channel and Near, Balanced, or Far.
2. Scan real video ideas with thumbnails and titles.
3. Inspect three pieces of evidence: title pattern, subject distance, and measured outlier score.
4. Save useful ideas or dismiss poor ones; either choice can be changed.

## Costliest failure

A polished-looking result whose evidence does not support the recommendation, or a vector outage
that takes down the authenticated app. Either would make an experimental search tool look more
certain than it is.

## Success evidence

The selected target and distance are URL-addressable; 24 results render from the bounded local
corpus; every card exposes the ranking evidence without calling document affinity a pure topic
measure; save/dismiss survives refresh; Qdrant-offline,
target-not-indexed, empty, loading, wide, and narrow states remain truthful and operable.

## Preservation contract

- Preserve: authenticated `/app` shell, existing theme tokens, tracked-channel ownership, video
  and YouTube links, thumbnail fallback behavior, and direct-Postgres-only data access.
- Improve: turn the failed evaluator into an inspectable learning surface; collect natural
  save/dismiss behavior instead of asking users to label abstract rubric categories.
- Remove only with evidence: none; this is a new route. Do not expose evaluator-only
  creative/direct/unresolved buckets.
- Unknowns: whether 1,500 nearest candidates provide enough usable range for Far, and whether
  title-form signals alone are explanatory enough without transcripts or runtime LLM calls.

## Redesign continuity where applicable

- Routes and anchors: add `/app/inspiration`; preserve every existing route and link.
- SEO metadata and structured data: not applicable to this authenticated app route.
- Analytics identifiers: none are added; feedback rows are explicit product data, not analytics.
- Form names, order, and behavior: channel, distance, then Explore; feedback is scoped to the
  signed-in user, target, and video.
- Legal, consent, brand voice, and accessibility behavior: existing ChannelSmith theme and focus
  behavior; fieldsets, labels, native controls, non-color state text, and reversible feedback.
