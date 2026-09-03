'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import FeedCard from './feed-card';
import InsertCoin from './insert-coin';
import { TestRow } from '@/components/app/test-row';
import { cardKind, dayDividerLabel, groupCards, type FeedEventLike, type FeedSegment } from '@/lib/app/feed-format';
import type { TestRowModel } from '@/lib/app/test-row';

const PAGE = 60;

export interface FeedClientProps {
  initialEvents: FeedEventLike[];
  initialCursor: string | null;
  /** video_id -> the packaging test that video's thumbnail history reads as. */
  initialTests: Record<string, TestRowModel>;
  /** Which segment the page was rendered for; paging keeps it. Filtering itself is URL state. */
  segment: FeedSegment;
  channelId: string | null;
  /** False when the user tracks no channels — then no amount of paging will help. */
  hasChannels: boolean;
  /** channel_id -> avatar url. Every event comes from a tracked channel, so one map covers every page. */
  avatars?: Record<string, string>;
}

export default function FeedClient({
  initialEvents, initialCursor, initialTests, segment, channelId, hasChannels, avatars = {},
}: FeedClientProps) {
  const [events, setEvents] = useState(initialEvents);
  const [tests, setTests] = useState(initialTests);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (nextCursor: string | null) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (nextCursor) p.set('cursor', nextCursor);
      if (segment !== 'all') p.set('seg', segment);
      if (channelId) p.set('channel', channelId);
      const res = await fetch(`/api/app/feed?${p.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error(body?.error || 'Could not load the feed.');
      const page: FeedEventLike[] = body.events || [];
      setEvents((prev) => [...prev, ...page]);
      setTests((prev) => ({ ...prev, ...(body.tests || {}) }));
      setCursor(body.next_cursor ?? null);
      // Only a page that came back genuinely empty proves there is nothing older; a
      // null cursor alongside rows just means this page was the last one we asked for.
      if (!page.length && !body.next_cursor) setExhausted(true);
    } catch (e: any) {
      if (id === requestId.current) setError(e.message || 'Could not load the feed.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [segment, channelId]);

  // Infinite scroll: fetch the next page when the sentinel comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || loading) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) load(cursor);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, load]);

  if (!hasChannels) return <InsertCoin />;

  return (
    <>
      {error && <div className="cs-note" data-tone="bad" style={{ marginBottom: 12 }}>{error}</div>}

      {events.length === 0 && !loading ? (
        <InsertCoin title="Nothing here yet" action="Add a channel">
          {segment !== 'all'
            ? 'Nothing of that kind yet. Clear the filter, or give the watcher a day.'
            : 'Your channels have not moved yet. New events land here as they are detected.'}
        </InsertCoin>
      ) : (
        <div className="cs-feed">
          {groupCards(events).map((day, di) => (
            <section key={day.key}>
              <h2 className="cs-day">{dayDividerLabel(day.cards[0].at)}</h2>
              {day.cards.map((c, ci) => {
                // A day of thumbnail activity on one video is one experiment, so it is one
                // TestRow. Uploads, titles and outliers keep their cards.
                const test = c.video_id ? tests[c.video_id] : undefined;
                if (test && cardKind(c) === 'thumb') {
                  return <TestRow key={c.key} row={test} avatarUrl={c.channel_id ? avatars[c.channel_id] : null} priority={di === 0 && ci < 2} />;
                }
                return <FeedCard key={c.key} card={c} avatarUrl={c.channel_id ? avatars[c.channel_id] : null} priority={di === 0 && ci < 2} />;
              })}
            </section>
          ))}
          {loading && [0, 1, 2].map((i) => <div key={`sk-${i}`} className="cs-skel" />)}
        </div>
      )}

      <div ref={sentinel} />
      {cursor && !loading && (
        <div className="cs-center">
          <button type="button" className="cs-btn" onClick={() => load(cursor)}>Load more</button>
        </div>
      )}
      {exhausted && events.length > 0 && (
        <div className="cs-center"><span className="cs-hiscore">nothing older</span></div>
      )}
    </>
  );
}
