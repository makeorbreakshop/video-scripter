# Design Decision — evidence-led result stream

## Exploration decision

Exploration was skipped. The user explicitly selected the private sandbox direction after the
offline programmatic experiment failed its evaluator gate: channel target, Near/Balanced/Far,
transparent evidence, and natural save/dismiss feedback. Visual invention would add risk without
answering an open product question; this route extends the established ChannelSmith app grammar.

## Selected direction

One compact control region followed by a single-column evidence-led result stream. A thumbnail
and title establish the real artifact; title pattern, subject distance, and outlier proof explain
the ranking underneath. Feedback actions live on the candidate they affect.

## Rejected directions and reasons

- A three-column lane board was rejected because it would imply simultaneous comparison when the
  actual decision is one distance mode at a time and would allocate equal space by concept.
- A card dashboard with score gauges was rejected because it would turn internal normalized
  features into false product precision.
- Runtime LLM verification was rejected by the user because it makes every browse request heavy;
  any later LLM interpretation belongs in an optional caller-owned skill.

## Remaining risks

- The frozen corpus covers scored one-year outliers, not every video in the million-row library.
- Far quality may be bounded by retrieving the nearest 1,500 before programmatic reranking.
- Save/dismiss is directional evidence, not a relevance gold label; learning logic is out of scope.
