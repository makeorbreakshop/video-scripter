'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import FeedCard from './feed-card';
import InsertCoin from './insert-coin';
import { FILTER_CHIPS, dayDividerLabel, feedQuery, groupCards, type FeedEventLike } from '@/lib/app/feed-format';

const PAGE = 60;

export interface FeedClientProps {
  initialEvents: FeedEventLike[];
  initialCursor: string | null;
  /** False when the user tracks no channels — then no amount of paging will help. */
  hasChannels: boolean;
  /** channel_id -> avatar url. Every event comes from a tracked channel, so one map covers every page. */
  avatars?: Record<string, string>;
}

export default function FeedClient({ initialEvents, initialCursor, hasChannels, avatars = {} }: FeedClientProps) {
  const [events, setEvents] = useState(initialEvents);
  const [cursor, setCursor] = useState(initialCursor);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  // Guards against a stale filter's response overwriting a newer one.
  const requestId = useRef(0);

  const load = useCallback(async (nextTypes: string[], nextCursor: string | null, replace: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/app/feed${feedQuery({ cursor: nextCursor, limit: PAGE, types: nextTypes })}`);
      const body = await res.json().catch(() => ({}));
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error(body?.error || 'Could not load the feed.');
      const page: FeedEventLike[] = body.events || [];
      setEvents((prev) => (replace ? page : [...prev, ...page]));
      setCursor(body.next_cursor ?? null);
      // Only a page that came back genuinely empty proves there is nothing older; a
      // null cursor alongside rows just means this page was the last one we asked for.
      if (!page.length && !body.next_cursor) setExhausted(true);
    } catch (e: any) {
      if (id === requestId.current) setError(e.message || 'Could not load the feed.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  /** Chips are single-select; clicking the active one (or ALL) clears the filter. */
  const applyTypes = (next: string[]) => {
    setTypes(next);
    setEvents([]);
    setCursor(null);
    setExhausted(false);
    load(next, null, true);
  };
  const onChip = (type: string) =>
    applyTypes(types.length === 1 && types[0] === type ? [] : [type]);

  // Infinite scroll: fetch the next page when the sentinel comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || loading) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) load(types, cursor, false);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, types, load]);

  if (!hasChannels) return <InsertCoin />;

  return (
    <>
      <div className="cs-chips" role="group" aria-label="Filter events by type">
        <button type="button" className="cs-chip" data-on={types.length === 0} onClick={() => applyTypes([])}>
          ALL
        </button>
        {FILTER_CHIPS.map((c) => (
          <button key={c.type} type="button" className="cs-chip" data-on={types.includes(c.type)} onClick={() => onChip(c.type)}>
            {c.label}
          </button>
        ))}
      </div>

      {error && <div className="cs-note" data-tone="bad" style={{ marginBottom: 12 }}>{error}</div>}

      {events.length === 0 && !loading ? (
        <InsertCoin title="Nothing here yet" action="Add a channel">
          {types.length
            ? 'Nothing of that kind yet. Clear the filter, or give the watcher a day.'
            : 'Your channels have not moved yet. New events land here as they are detected.'}
        </InsertCoin>
      ) : (
        <div className="cs-feed">
          {groupCards(events).map((day, di) => (
            <section key={day.key}>
              <h2 className="cs-day">{dayDividerLabel(day.cards[0].at)}</h2>
              {day.cards.map((c, ci) => (
                <FeedCard key={c.key} card={c} avatarUrl={c.channel_id ? avatars[c.channel_id] : null} priority={di === 0 && ci < 2} />
              ))}
            </section>
          ))}
          {loading && [0, 1, 2].map((i) => <div key={`sk-${i}`} className="cs-skel" />)}
        </div>
      )}

      <div ref={sentinel} />
      {cursor && !loading && (
        <div className="cs-center">
          <button type="button" className="cs-btn" onClick={() => load(types, cursor, false)}>Load more</button>
        </div>
      )}
      {exhausted && events.length > 0 && (
        <div className="cs-center"><span className="cs-hiscore">nothing older</span></div>
      )}
    </>
  );
}
