'use client';
// The add-channel box, shared by /app/channels and /app/onboarding.
// Free text searches the channels we already know (no YouTube quota); a URL, @handle,
// video link or UC id goes to /resolve (1-2 units) and comes back as a confirm card.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addChannelMode, addChannelError, markAlreadyTracked, type PickerItem,
} from '@/lib/app/channel-view';
import { compactNumber } from '@/lib/app/feed-format';

const DEBOUNCE_MS = 250;

interface Resolved {
  channel_id: string;
  name: string;
  handle: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  video_count: number | null;
  known: boolean;
}

export interface AddChannelProps {
  trackedIds: string[];
  role?: 'self' | 'competitor';
  /** Called with the new channel id once POST /api/app/channels succeeds. */
  onAdded: (channelId: string) => void | Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function AddChannel({ trackedIds, role = 'competitor', onAdded, placeholder, autoFocus }: AddChannelProps) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState<PickerItem[]>([]);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const requestId = useRef(0);

  const mode = addChannelMode(input);

  const post = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { res, body: await res.json().catch(() => null) as any };
  }, []);

  // Debounced lookup. Every response carries the id of the keystroke that asked for it,
  // so a slow early request cannot overwrite the answer to a later one.
  useEffect(() => {
    const raw = input.trim();
    setError(null);
    setUpgrade(false);
    if (mode === 'idle') { setResults([]); setResolved(null); setBusy(false); return; }

    const id = ++requestId.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        if (mode === 'search') {
          const { res, body } = await post('/api/app/channels/search', { q: raw });
          if (id !== requestId.current) return;
          if (!res.ok) throw Object.assign(new Error(), { status: res.status, body });
          setResolved(null);
          setResults(markAlreadyTracked(body?.results || [], trackedIds));
        } else {
          const { res, body } = await post('/api/app/channels/resolve', { input: raw });
          if (id !== requestId.current) return;
          if (!res.ok) throw Object.assign(new Error(), { status: res.status, body });
          setResults([]);
          setResolved(body?.channel || null);
          if (!body?.channel) setError('No channel found for that link.');
        }
      } catch (e: any) {
        if (id !== requestId.current) return;
        setResults([]); setResolved(null);
        setError(addChannelError(e?.status ?? 500, e?.body ?? null));
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // trackedIds is only read for the "already tracked" flag; joining keeps the effect stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, mode, post, trackedIds.join(',')]);

  async function add(channelId: string) {
    setAdding(channelId);
    setError(null);
    setUpgrade(false);
    try {
      const { res, body } = await post('/api/app/channels', { channel_id: channelId, role });
      if (!res.ok) {
        if (res.status === 402) setUpgrade(true);
        setError(addChannelError(res.status, body));
        return;
      }
      setInput(''); setResults([]); setResolved(null);
      await onAdded(channelId);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setAdding(null);
    }
  }

  const owned = new Set(trackedIds);

  return (
    <div>
      <input
        className="cs-input"
        value={input}
        autoFocus={autoFocus}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder || 'Channel name, @handle, or any YouTube URL'}
        aria-label="Add a channel"
      />
      <div className="cs-sub" style={{ minHeight: 18, marginTop: 6 }}>
        {busy ? 'Searching…' : mode === 'resolve' ? 'Looks like a channel link — we will look it up.' : ''}
      </div>

      {error && (
        <div className="cs-note" data-tone={upgrade ? 'accent' : 'bad'} style={{ marginTop: 8 }}>
          {error}
          {upgrade && (
            <>
              {' '}
              <a href="/app/settings" style={{ textDecoration: 'underline' }}>See plans</a>
            </>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="cs-picker">
          {results.map((r) => (
            <button
              key={r.channel_id}
              type="button"
              className="cs-pick"
              disabled={r.already || adding !== null}
              onClick={() => add(r.channel_id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cs-pick-name">{r.name}</div>
                <div className="cs-pick-meta">
                  {compactNumber(r.video_count)} videos
                  {r.tracked_lane ? ' · already in our corpus' : ''}
                </div>
              </div>
              {r.already
                ? <span className="cs-badge" data-tone="good">already tracked</span>
                : <span className="cs-badge" data-tone="accent">{adding === r.channel_id ? 'adding…' : 'add'}</span>}
            </button>
          ))}
        </div>
      )}

      {resolved && (
        <div className="cs-card" style={{ marginTop: 10 }}>
          <div className="cs-card-head">
            {resolved.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolved.thumbnail_url} alt="" width={48} height={48}
                   style={{ borderRadius: '50%', flex: 'none' }} referrerPolicy="no-referrer" />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="cs-card-name">{resolved.name}</p>
              <div className="cs-pick-meta">
                {resolved.handle ? `${resolved.handle} · ` : ''}
                {compactNumber(resolved.subscriber_count)} subscribers · {compactNumber(resolved.video_count)} videos
              </div>
              {!resolved.known && <div className="cs-pick-meta">New to us — we will sync it right after you add it.</div>}
            </div>
          </div>
          <div className="cs-card-foot">
            {owned.has(resolved.channel_id) ? (
              <span className="cs-badge" data-tone="good">already tracked</span>
            ) : (
              <button type="button" className="cs-btn" data-variant="primary"
                      disabled={adding !== null} onClick={() => add(resolved.channel_id)}>
                {adding ? 'Adding…' : `Track ${resolved.name}`}
              </button>
            )}
            <button type="button" className="cs-btn" onClick={() => { setInput(''); setResolved(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
