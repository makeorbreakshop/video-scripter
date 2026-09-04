# Video chart v2: one continuous view

Date: 2026-09-04. Owner: Brandon. Method: test-first. Scope: the video page chart, its header,
tooltip, markers, and the packaging strip link. No scoring changes.

## Principles

1. One continuous view. Publish on the left, a data-driven forecast horizon on the right. No
   "First 72h / Since publish" buttons. Click-drag to zoom the x-axis, double-click to reset.
2. Fewer things visible at rest, more on demand.
3. The test is the unit. Markers group packaging changes by test (the packaging strip's
   grouping), never by raw version change.
4. Layers agree: the chart, the strip, the header, and the tooltip all read the same series.

## Domain and horizon

- Left edge: publish.
- Right edge (forecast horizon) from age: `horizon = clamp(3 * ageDays, 3, 365)` rounded to a
  sensible tick (3d, 7d, 14d, 30d, 60d, 90d, 180d, 365d). An 18h video shows 3 days; a 5-day
  video shows 15 -> 14 days; a 12-day video shows 30; a 60-day video shows 180; older shows 365.
- The forecast median and INNER ribbon (q25..q75) run to the horizon. The outer ribbon
  (q10..q90) is not drawn; its values appear in the tooltip only.
- Past day 30 the forecast continues on the fitted long-tail curve (lib/scoring/core longtail)
  from the last measurement; the day-30 estimate stays as a labeled point on the median.
- Zoom is a viewport over the same series; no separate 72h series. Default viewport = full domain.

## Layers at rest

- this video, measured: solid accent line, no dots at rest, dot on hover at the nearest
  measurement only.
- this video, estimated before tracking: dotted accent, reduced opacity, no band.
- expected from here: dashed accent + inner ribbon only. No dots on ribbon edges (kill
  recharts activeDot on Areas).
- typical for this channel: plain grey dashed line, no band.
- tracking began: thin vertical rule with label, clamped inside the plot.
- tests and swaps: see below.
- Legend: hand-drawn, four entries, same order as above. Scale toggle "linear / log" at the
  legend's right end; default linear.

## Tests and swaps on the chart

- Source: the same grouping the packaging strip uses (lib/app/packaging or wherever the strip
  builds "TEST · N thumbnails" from thumbnail_versions / feed_events). Put the grouping in one
  pure module both consumers import.
- A TEST (A/B/A rotation) draws as a shaded window spanning first rotation to settle/last
  rotation, with a small chip "A/B" (or "A/B/C") at the top. A single SWAP draws as one thin
  rule with a chip "swap". A title change draws as a thin rule with chip "title".
- Hover a window/rule: highlight it, show variant thumbnails in the tooltip (tiny). Click:
  the strip scrolls to and expands that test; the strip's expand no longer opens on hover, only
  on click, so the two do not fight.
- Overlapping windows within the current zoom collapse into one chip "N tests" that expands on
  zoom-in.

## Header

One metadata line under the title: channel, published (ET), age, exact views, YouTube link.
One verdict line: `2.0x` · on pace for 186K by day 30 · typical 92K · early read.
Remove "84K views at 35h" (duplicate of metadata). Past day 30 the verdict line reads
`0.9x` · 565K vs typical 596K by now · settled (or the confidence word).

## Tooltip

Three lines max: `Sep 23, 10:14 PM ET`, `179K views · typical 88K`, `likely 148K–258K` (inner);
the outer range as a fourth muted line `range 127K–395K`. The "half of videos / 4 in 5" wording
moves to a one-line footnote under the legend, shown once.

## Tests (write first; Jest, node env; visual decisions live in pure helpers)

- horizonFor(ageDays) table cases and monotonicity; clamp; tick rounding.
- buildSeries over the full domain: covers every day to horizon; forecast values exist past
  day 30 on the long-tail path; inner band present, outer band present in data but flagged
  `display: false`.
- groupPackaging(): the Matt Wolfe fixture Po_Dh7WLgmM (8 versions, two hashes alternating
  2026-09-03 19:10–20:50 ET) yields ONE test with 2 variants and a window; a single v2 yields
  one swap; a title_versions v2 yields one title marker; the strip and the chart get identical
  groups from the same call.
- markerLayout(zoomDomain): overlapping windows collapse; chips clamp inside the plot.
- legendEntries order and the scale toggle state; activeDot disabled on Area series (assert
  the props object).
- headerLines(video): the two-line output for young and past-30 videos; no duplicated views.
- tooltipLines(point): at most four lines, inner then outer.

## Verification

Screenshots (own dev server on a free port, cs_preview cookie, repo puppeteer) of:
PpwewkOCFuE (18h), Po_Dh7WLgmM (1d, one A/B test), XplV_L7gx6w (6d, swap + title), a ~33d video
(BPS "Sharpest Nosecone Ever?"), and a ~290d video (BPS "I Broke 100 Epoxy Bonds"), light and
dark. Then a drag-zoom into the Matt Wolfe test window and a screenshot of the highlighted
test + expanded strip.

## Out of scope

Scoring, bands fit, feed cards, channel page.
