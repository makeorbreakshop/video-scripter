'use client';

// A timestamp the reader can check against the clock on their own wall.
//
// The rule this component exists to keep: a string formatted on the SERVER is formatted in the
// server's zone, and one formatted in the browser is formatted in the viewer's — so React would
// hydrate one over the other and the page would flicker between two different times. The server
// therefore never formats an app-facing timestamp at all. It passes epoch MILLISECONDS, which
// mean the same thing everywhere, and this renders them. (lib/app/local-time.ts is the format.)
//
// Admin pages and scripts keep ET: they have one reader, and he is in Georgia.

import { useEffect, useState } from 'react';
import { localDay, localDayYear, localDateTime, localDayRange } from '@/lib/app/local-time';

const FORMATS = {
  day: localDay,
  dayYear: localDayYear,
  dateTime: localDateTime,
} as const;

export type LocalTimeFormat = keyof typeof FORMATS;

/**
 * The first paint is server-side, where the zone is not the reader's. Rather than render a time
 * that is about to change, the element renders empty and fills in on mount — one frame, no
 * hydration mismatch, and never a wrong number on screen.
 */
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function LocalTime({ ms, format = 'dateTime', className }: {
  ms: number | null | undefined;
  format?: LocalTimeFormat;
  className?: string;
}) {
  const mounted = useMounted();
  if (ms == null || !Number.isFinite(ms)) return null;
  // suppressHydrationWarning: the server renders nothing here on purpose (see above).
  return (
    <span className={className} suppressHydrationWarning>
      {mounted ? FORMATS[format](ms) : ''}
    </span>
  );
}

/** "Aug 30 – Sep 1", collapsed when both ends land on one of the reader's days. */
export function LocalDayRange({ from, to, className }: { from: number; to: number; className?: string }) {
  const mounted = useMounted();
  return (
    <span className={className} suppressHydrationWarning>
      {mounted ? localDayRange(from, to) : ''}
    </span>
  );
}
