'use client';

// "Load more" used to be a link to ?n=120, which re-ran the whole server page from offset 0
// and re-rendered every tile the reader was already looking at. It now fetches only the next
// page and appends it under the server-rendered grid; the ?n= parameter is kept in sync with
// history.replaceState so a reload (or a shared link) still returns the same number of rows.

import { useState } from 'react';
import type { GridVideo, SortKey } from '@/lib/app/channel-page';
import type { RangeKey } from '@/lib/app/channel-page';
import { VideoTile } from './video-tile';
import { installThumbFallback } from './thumb-runtime';

export function LoadMoreClient({
  channelId, sort, range, initial, pageSize, maxRows,
}: {
  channelId: string;
  sort: SortKey;
  range: RangeKey;
  /** How many rows the server already rendered. */
  initial: number;
  pageSize: number;
  maxRows: number;
}) {
  const [extra, setExtra] = useState<GridVideo[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = initial + extra.length;

  async function loadMore() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const limit = Math.min(pageSize, Math.max(0, maxRows - shown));
      const url = `/api/app/channels/${encodeURIComponent(channelId)}/videos`
        + `?sort=${sort}&range=${range}&limit=${limit}&offset=${shown}`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data = (await res.json()) as { videos: GridVideo[]; hasMore: boolean };
      const next = data.videos ?? [];
      setExtra((cur) => [...cur, ...next]);
      setHasMore(Boolean(data.hasMore) && shown + next.length < maxRows);
      // The appended tiles are ordinary <img>s, so they need the delegated error listener too;
      // it is a no-op when the page's inline script already installed it.
      installThumbFallback();
      const q = new URLSearchParams(window.location.search);
      q.set('n', String(shown + next.length));
      window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
    } catch (e) {
      setError('Could not load more videos.');
      console.error('load more:', e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {extra.length > 0 && (
        <ul className="vg-grid" style={{ marginTop: 24 }}>
          {extra.map((v) => <VideoTile key={v.id} v={v} />)}
        </ul>
      )}
      {hasMore && shown < maxRows && (
        <div className="cs-center">
          <button type="button" className="cs-btn" onClick={loadMore} disabled={busy}>
            {busy ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      {error && <p className="vg-meta cs-center" style={{ color: 'var(--cs-warn)' }}>{error}</p>}
    </>
  );
}
