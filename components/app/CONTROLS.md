# Controls

| control | job | component | notes |
|---|---|---|---|
| Tab | switch what a page shows | `.cs-tab` in `.cs-tabbar` | text + 2px underline on the active one; count in `.cs-num` |
| Chip | exclusive filter within a row | `<Chips>` — `components/app/chips.tsx` | pill; on = ink fill + ground text; counts in mono; optional colour dot; scrolls sideways when narrow |
| Menu | popover of choices anchored to a trigger | `<Menu>` — `components/app/menu.tsx` | one plate, 10px radius, 40px rows; `mode="multi"` tri-state, `mode="actions"` plain/destructive |
| Sort | Menu in single-choice mode | `<Sort>` — `components/app/menu.tsx` | trigger shows the current value + caret; checkmark on the chosen row, no checkboxes |
| Toggle | per-row boolean | `<Coin>` — `components/app/coin.tsx` | 22px; on = accent fill + light glyph, off = outline + muted glyph; `aria-pressed` |

Shared rules live in one place: `.cs-control` and `.cs-plate` in `app/app/theme.css`.
Radius 8px for controls, 10px for plates. Border `--cs-line`, hover `--cs-line-strong`,
focus `2px solid var(--cs-accent)` inset, shadow `--cs-shadow`.
Group colours are `--cs-g-<key>` for the eight keys in `GROUP_COLORS`.

## Heights

Three, and no others:

| height | for |
|---|---|
| 22px | the per-row coin — a boolean inside a table row, sized to the row |
| 30px | filters and menus: `.cs-control`, `.cs-chip`, `.cs-menu-trigger`, `.cs-icon-btn` |
| 36px | things you press to commit: `.cs-btn`, and the wordmark plate that shares its line |

Anything else is a one-off. Inspiration grew a 38px segmented radio this way — a sixth control
type at a sixth height with a sixth "selected" treatment, for the job `<Chips>` already does on
the feed. Enforced by `lib/app/design-rules.test.ts`.

## Selected

Three treatments, one per structurally different job:

- **on, within a filter row** — ink fill, ground text (`.cs-chip[data-on]`)
- **on, as a boolean** — accent fill, `--cs-accent-on` glyph (`.cs-coin-toggle[data-on]`)
- **where you are** — ink underline for a tab, `--cs-surface-2` pill for nav

A page-level stylesheet must not invent a fourth. In particular, no accent-tinted
(`--cs-accent-soft` background) selected state outside the coin: a button that commits and
stays on takes `data-variant="primary"`, which is a treatment the system already has.

## Never

No native `<select>` anywhere under `app/app` or `components/app` —
`lib/app/no-native-select.test.ts` enforces it. No segmented switch: that is a chips row.
