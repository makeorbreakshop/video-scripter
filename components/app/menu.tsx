'use client';

// The app's one popover. Every dropdown in /app is this component in one of three modes —
// a native select element cannot hold a checkmark row, a tri-state box, a colour dot or a
// destructive row, and it cannot be made to look like the rest of the controls.
//
//   single  — sort, range, the feed's channel picker. Checkmark on the chosen row; picking closes.
//   multi   — add-to-group. Tri-state boxes; the panel stays open.
//   actions — the row "…". Plain rows, destructive ones in --cs-bad; picking closes.
//
// The panel is a fixed-position plate in a portal, so a chip row that scrolls horizontally or a
// table cell with overflow cannot clip it. It is measured on open and flipped above the trigger
// (or pulled in from the edge) when there is no room below. Escape and a click outside close it
// and focus returns to the trigger; arrow keys walk the rows.

import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type MenuMode = 'single' | 'multi' | 'actions';

export interface MenuItem {
  /** Identity of the row, and what `onSelect`/`onToggle` is handed. */
  key: string;
  label: ReactNode;
  /** Rendered right-aligned in mono. */
  count?: number;
  /** A colour dot before the label — a group colour, e.g. `var(--cs-g-teal)`. */
  color?: string;
  /** multi only. Defaults to 'off'. */
  state?: 'on' | 'off' | 'mixed';
  /** actions only: paints the row in --cs-bad. */
  destructive?: boolean;
  disabled?: boolean;
}

export interface MenuProps {
  mode: MenuMode;
  items: MenuItem[];
  /** Trigger content. A bare string gets the label + caret treatment. */
  label: ReactNode;
  /** Accessible name when `label` is not text (an icon trigger). */
  ariaLabel?: string;
  /** single: the chosen key — that row gets the checkmark. */
  value?: string | null;
  /** single | actions. */
  onSelect?: (key: string) => void;
  /** multi. The panel stays open. */
  onToggle?: (key: string) => void;
  /** Which trigger edge the panel lines up with. */
  align?: 'start' | 'end';
  /** Trigger register: the standard control, a quiet inline button, or a bare 22px square. */
  variant?: 'control' | 'quiet' | 'icon';
  /** Hide the caret (icon triggers). */
  caret?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** An extra strip under the rows — the "New group…" field. Given `close`. */
  footer?: (close: () => void) => ReactNode;
}

const GAP = 6;

export function Menu({
  mode, items, label, ariaLabel, value, onSelect, onToggle,
  align = 'end', variant = 'control', caret = variant !== 'icon', disabled, title, className, footer,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const id = useId();

  useEffect(() => setMounted(true), []);

  const close = useCallback((focus = true) => {
    setOpen(false);
    setPos(null);
    if (focus) trigger.current?.focus();
  }, []);

  // Measure once the panel is in the DOM: below-right by default, flipped above when the
  // viewport has no room, and always pulled back inside both edges.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const place = () => {
      const t = trigger.current?.getBoundingClientRect();
      const p = panel.current?.getBoundingClientRect();
      if (!t || !p) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const below = t.bottom + GAP;
      const flip = below + p.height > vh - 8 && t.top - GAP - p.height > 8;
      const top = flip ? t.top - GAP - p.height : below;
      let left = align === 'end' ? t.right - p.width : t.left;
      left = Math.min(Math.max(8, left), Math.max(8, vw - p.width - 8));
      setPos({ top, left, width: t.width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, items.length]);

  // Opening moves focus into the panel: the chosen row in single mode, else the first row.
  useEffect(() => {
    if (!open) return;
    const start = mode === 'single' ? items.findIndex((i) => i.key === value) : 0;
    const el = rows.current[start >= 0 ? start : 0];
    el?.focus();
  }, [open, mode, items, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const move = (from: number, step: number) => {
    const n = items.length;
    if (!n) return;
    for (let i = 1; i <= n; i++) {
      const next = (from + step * i + n * n) % n;
      if (!items[next]?.disabled) { rows.current[next]?.focus(); return; }
    }
  };

  const onRowKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
    else if (e.key === 'Home') { e.preventDefault(); move(-1, 1); }
    else if (e.key === 'End') { e.preventDefault(); move(0, -1); }
    else if (e.key === 'Tab') { close(false); }
  };

  const pick = (item: MenuItem) => {
    if (item.disabled) return;
    if (mode === 'multi') { onToggle?.(item.key); return; }
    onSelect?.(item.key);
    close();
  };

  const panelRole = mode === 'single' ? 'listbox' : 'menu';
  const rowRole = mode === 'single' ? 'option' : mode === 'multi' ? 'menuitemcheckbox' : 'menuitem';

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`cs-menu-trigger${variant === 'control' ? ' cs-control' : ''}${className ? ` ${className}` : ''}`}
        data-variant={variant}
        data-open={open || undefined}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup={mode === 'single' ? 'listbox' : 'menu'}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); }
        }}
      >
        {typeof label === 'string' ? <span className="cs-menu-trigger-label">{label}</span> : label}
        {caret && <Caret />}
      </button>

      {open && mounted && createPortal(
        <div
          ref={panel}
          id={id}
          className="cs-menu-panel cs-plate"
          role={panelRole}
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          data-mode={mode}
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? 'visible' : 'hidden',
            minWidth: pos?.width,
          }}
        >
          {items.map((item, i) => {
            const on = mode === 'single' ? item.key === value : item.state === 'on';
            return (
              <button
                key={item.key}
                ref={(el) => { rows.current[i] = el; }}
                type="button"
                role={rowRole}
                className="cs-menu-item"
                data-on={on || undefined}
                data-bad={item.destructive || undefined}
                disabled={item.disabled}
                tabIndex={-1}
                aria-selected={mode === 'single' ? on : undefined}
                aria-checked={mode === 'multi' ? (item.state === 'mixed' ? 'mixed' : on) : undefined}
                onKeyDown={(e) => onRowKey(e, i)}
                onClick={() => pick(item)}
              >
                {mode === 'multi' && (
                  <span
                    className="cs-menu-box"
                    data-state={item.state ?? 'off'}
                    style={item.color ? ({ ['--cs-dot' as string]: item.color } as React.CSSProperties) : undefined}
                  />
                )}
                {mode !== 'multi' && item.color && (
                  <span className="cs-dot" style={{ background: item.color }} />
                )}
                <span className="cs-menu-label">{item.label}</span>
                {item.count !== undefined && <span className="cs-menu-count cs-num">{item.count}</span>}
                {mode === 'single' && <Check on={on} />}
              </button>
            );
          })}
          {footer && <div className="cs-menu-foot">{footer(close)}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}

export interface SortOption { key: string; label: string; color?: string; count?: number }

/**
 * A Menu in single mode whose trigger says what is currently chosen. Sort, range and the feed's
 * channel picker are all this.
 */
export function Sort({
  value, options, onChange, ariaLabel, prefix, align = 'end', variant = 'control',
}: {
  value: string;
  options: SortOption[];
  onChange: (key: string) => void;
  ariaLabel: string;
  /** A word before the value on the trigger, e.g. "Sort". */
  prefix?: string;
  align?: 'start' | 'end';
  variant?: 'control' | 'quiet';
}) {
  const current = options.find((o) => o.key === value) ?? options[0];
  return (
    <Menu
      mode="single"
      ariaLabel={ariaLabel}
      align={align}
      variant={variant}
      value={current?.key ?? null}
      items={options}
      onSelect={onChange}
      label={
        <span className="cs-menu-trigger-label">
          {prefix && <span className="cs-menu-prefix">{prefix}</span>}
          {current?.color && <span className="cs-dot" style={{ background: current.color }} />}
          {current?.label ?? ''}
        </span>
      }
    />
  );
}

export function Caret({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" className="cs-caret">
      <path d="m2.5 4 2.5 2.5L7.5 4" fill="none" stroke="currentColor" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="cs-menu-check"
         style={{ opacity: on ? 1 : 0 }}>
      <path d="m2.5 6.2 2.4 2.4L9.6 3.9" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
