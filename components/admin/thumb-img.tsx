'use client';

import { useState } from 'react';

// Archived thumbnail with a labeled placeholder when the archive isn't available on this host
// (the watcher stores image files on the machine that runs it, not in the deployed app).
export function ThumbImg({ src, fallbackSrc, alt, dim = false }: { src: string; fallbackSrc?: string; alt: string; dim?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [cur, setCur] = useState(src);
  if (failed) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">
        not archived on this host
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={cur} alt={alt} onError={() => { if (fallbackSrc && cur !== fallbackSrc) setCur(fallbackSrc); else setFailed(true); }} className={`aspect-video w-full rounded object-cover ${dim ? 'opacity-60' : ''}`} />
  );
}
