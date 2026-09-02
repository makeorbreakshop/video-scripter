'use client';

// A thumbnail that fails quietly.
//
// Archived versions live in R2, but the earliest versions of a video the watcher only started
// following after publish were never captured, so some URLs 404. A broken <img> shows its alt
// text in a jagged box, which reads as a bug; this falls back to the local archive route and
// then to an empty plate that keeps the 16:9 slot.
//
// The load error usually happens before React hydrates the server-rendered <img>, and React
// does not replay that event — so the mount effect also checks for an image that finished
// loading with no pixels, which is what a 404 leaves behind.

import { useCallback, useEffect, useRef, useState } from 'react';

export function Thumb({
  src, fallbackSrc, alt, caption, className, style,
}: {
  src?: string | null;
  fallbackSrc?: string | null;
  alt: string;
  caption?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [cur, setCur] = useState(src ?? null);
  const [dead, setDead] = useState(!src);
  const ref = useRef<HTMLImageElement | null>(null);

  const onFail = useCallback(() => {
    setCur((c) => {
      if (fallbackSrc && c !== fallbackSrc) return fallbackSrc;
      setDead(true);
      return c;
    });
  }, [fallbackSrc]);

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) onFail();
  }, [cur, onFail]);

  return (
    <span className={`cs-thumb ${className ?? ''}`} style={{ display: 'block', ...style }}>
      {!dead && cur ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={ref} src={cur} alt={alt} onError={onFail} />
      ) : null}
      {caption && <span className="cs-thumb-cap">{caption}</span>}
    </span>
  );
}
