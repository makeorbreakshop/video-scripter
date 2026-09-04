# ChannelSmith project design rules

Project layer for the `brandon-ai-defaults-v1` lint profile. Invariant and personal-taste rules
still apply; these are the ChannelSmith-specific ones, plus the one narrow waiver.

## CS-001 — The group palette owns violet (waiver for TASTE-007)

**Scope:** `--cs-g-violet` in `app/app/theme.css`, and `'violet'` in `GROUP_COLORS`
(`components/app/chips.tsx`).

**Why it stands:** `GROUP_COLORS` is a categorical palette of eight keys a user assigns to their
own channel groups. It is not a brand or accent colour and never appears unassigned: a group
carries its colour on a dot, a chip and a tri-state box, and nowhere else. Eight distinguishable
hues on both grounds needs the violet slot; dropping it would leave seven groups, or two greens.

**Block condition:** violet appearing outside the group system — as an accent, a gradient, a
state colour, or a default fill on any surface. That remains a TASTE-007 blocker.

**Enforcement:** `lib/app/design-rules.test.ts` holds the accent to `--cs-accent`;
`app/app/theme.css` defines `--cs-g-violet` only inside the group block.

## CS-002 — Pixel face allowlist

`--font-pixel` (Press Start 2P) is set by exactly five selectors: `.cs-marquee`, `.cs-hiscore`,
`.cs-step`, `.cs-coin`, `.cs-coin-sub` — the wordmark, the high-score tag, the onboarding step
chips and the insert-coin screen. Never a label, a plan tier, a meter caption or a badge, and
never below 8px. Enforced by `lib/app/design-rules.test.ts`.

## CS-003 — One control height scale

22 / 30 / 36px, documented in `components/app/CONTROLS.md`. A page-level stylesheet may not
introduce a sixth control or a fourth "selected" treatment. Enforced by
`lib/app/design-rules.test.ts`.

## CS-004 — No blanket element reset outranking a component

Every `<class> <tag>` rule in `app/app/theme.css` wraps the tag in `:where()`. Written plainly
it scores (0,1,1) and silently beats every single-class component rule in the same file — this
cost the wordmark its contrast (3.4:1) and the channel table its column alignment. Enforced by
`lib/app/theme-cascade.test.ts`.

## CS-005 — Scratch routes are not public

Half-built pages, competing designs and `/test-*` probes live behind Clerk. The list is
`SCRATCH_ROUTES` in `lib/app/route-policy.ts`; enforced by `lib/app/public-routes.test.ts`.
