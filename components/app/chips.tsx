'use client';

// A row of chips: one exclusive filter, chosen from a short flat list. Chips are not tabs —
// a tab changes what the page shows, a chip narrows the one thing it is already showing.
//
// Counts sit in mono so the numbers line up down a column of rows; a group chip carries its
// colour dot. Narrow viewports scroll the row sideways rather than wrapping it into a block,
// so the row stays one line no matter how many groups exist.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createOnceGuard } from '@/lib/app/import-batch';

export interface Chip {
  key: string;
  label: ReactNode;
  count?: number;
  /** A group colour token, e.g. `var(--cs-g-teal)`. */
  color?: string;
  /** A link chip: rendered by `renderLink` so the filter stays a URL. */
  href?: string;
}

export interface ChipsProps {
  items: Chip[];
  value: string;
  onChange?: (key: string) => void;
  ariaLabel: string;
  /** Render a chip as a link (the server keeps doing the filtering). Wins over `onChange`. */
  renderLink?: (chip: Chip, props: { className: string; 'data-on'?: boolean; children: ReactNode }) => ReactNode;
  /** Show the trailing dashed "+ New" chip, which becomes an inline field. */
  onCreate?: (name: string) => void;
  createLabel?: string;
  className?: string;
}

export function Chips({
  items, value, onChange, ariaLabel, renderLink, onCreate, createLabel = 'New', className,
}: ChipsProps) {
  return (
    <div className={`cs-chips${className ? ` ${className}` : ''}`} role="group" aria-label={ariaLabel}>
      {items.map((chip) => {
        const on = chip.key === value;
        const inner = (
          <>
            {chip.color && <span className="cs-dot" style={{ background: chip.color }} />}
            <span className="cs-chip-label">{chip.label}</span>
            {chip.count !== undefined && <span className="cs-num cs-chip-count">{chip.count}</span>}
          </>
        );
        if (renderLink && chip.href !== undefined) {
          return (
            <span key={chip.key} className="cs-chip-slot">
              {renderLink(chip, { className: 'cs-chip', 'data-on': on, children: inner })}
            </span>
          );
        }
        return (
          <button
            key={chip.key}
            type="button"
            className="cs-chip"
            data-on={on || undefined}
            aria-pressed={on}
            onClick={() => onChange?.(chip.key)}
          >
            {inner}
          </button>
        );
      })}
      {onCreate && <NewChip label={createLabel} onCreate={onCreate} />}
    </div>
  );
}

/** The trailing dashed chip. Clicking it turns the chip itself into the field. */
export function NewChip({ label, onCreate }: { label: string; onCreate: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  // Enter commits and closes the field, which fires blur, which commits again — two creates
  // and a "You already have a group called …" the user never asked for. One guard per open
  // field: whichever trigger arrives first is the one that counts.
  const guard = useRef(createOnceGuard());

  useEffect(() => {
    if (!editing) return;
    guard.current = createOnceGuard();
    input.current?.focus();
  }, [editing]);

  const commit = () => {
    guard.current.run(() => {
      const name = text.trim();
      setEditing(false);
      setText('');
      if (name) onCreate(name);
    });
  };

  if (!editing) {
    return (
      <button type="button" className="cs-chip cs-chip-new" onClick={() => setEditing(true)}>
        + {label}
      </button>
    );
  }
  return (
    <span className="cs-chip cs-chip-new" data-editing="true">
      <input
        ref={input}
        className="cs-chip-input"
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') {
            e.preventDefault();
            guard.current.run(() => { setEditing(false); setText(''); });
          }
        }}
      />
    </span>
  );
}

/** The eight group colours, in the order a new group should take them. */
export const GROUP_COLORS = ['green', 'amber', 'teal', 'red', 'violet', 'blue', 'brown', 'slate'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/** `var(--cs-g-teal)` for a group colour key, falling back to slate for an unknown one. */
export function groupColor(key: string | null | undefined): string {
  return `var(--cs-g-${(GROUP_COLORS as readonly string[]).includes(key ?? '') ? key : 'slate'})`;
}
