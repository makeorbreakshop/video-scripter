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
No native `<select>` anywhere under `app/app` or `components/app` — `lib/app/no-native-select.test.ts` enforces it.
