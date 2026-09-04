'use client';

// The per-row boolean, as a 22px coin: on is an accent fill with a light glyph, off is a line
// outline with a muted one. It is a button with aria-pressed, not a checkbox — nothing here is
// submitted with a form, and a switch that reads as "pressed" is what the row lane wants.

import type { ReactNode } from 'react';

export function Coin({
  on, onToggle, label, glyph, disabled, title,
}: {
  on: boolean;
  onToggle: () => void;
  /** Accessible name — "Notify for Make or Break Shop". */
  label: string;
  /** What sits inside the coin. Defaults to a bell. */
  glyph?: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="cs-coin-toggle"
      data-on={on || undefined}
      aria-pressed={on}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
    >
      {glyph ?? <Bell />}
    </button>
  );
}

function Bell() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.6a2.6 2.6 0 0 0-2.6 2.6c0 2.2-.8 3-1.1 3.3h7.4c-.3-.3-1.1-1.1-1.1-3.3A2.6 2.6 0 0 0 6 1.6Z"
            fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M4.9 9.4a1.2 1.2 0 0 0 2.2 0" fill="none" stroke="currentColor" strokeWidth="1.2"
            strokeLinecap="round" />
    </svg>
  );
}
