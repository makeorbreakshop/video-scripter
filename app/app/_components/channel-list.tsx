'use client';
// /app/channels — a list, not a gallery. One row per channel: avatar, name, day-30 baseline.
// One box at the top does both jobs: it filters what is already tracked as you type, and
// hands off to the add flow (AddChannel, controlled) the moment the text names a channel we
// do not track — a @handle, a URL, or a name nothing matches.
import { Suspense, use, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AddChannel from './add-channel';
import { ChannelCardsSkeleton } from '@/components/app/skeletons';
import { ChannelAvatar } from '@/components/app/avatar';
import {
  baselineLabel, filterChannels, planLabel, shouldOfferAdd, sortChannels, usageView,
  type ChannelRowLike,
} from '@/lib/app/channel-view';
import type { PlanLimits, PlanName } from '@/lib/app/plans';

export interface ChannelsClientProps {
  /**
   * The rows, as a promise. The page hands the unawaited read down so the head and the
   * search box paint immediately and only the list waits (React 19 `use()` inside the
   * Suspense boundary below). Passing a resolved array still works — it just never suspends.
   */
  channels: ChannelRowLike[] | Promise<ChannelRowLike[]>;
  /** Ids already tracked, read cheaply on the server so AddChannel need not wait for the list. */
  trackedIds: string[];
  plan: PlanName;
  limits: PlanLimits;
  usage: { tracked: number; watched_closely: number };
  /** Read-only mode for previews; hides the mutating controls. */
  readOnly?: boolean;
}

export default function ChannelsClient({ channels, trackedIds, plan, limits, usage, readOnly }: ChannelsClientProps) {
  const router = useRouter();
  const view = usageView(plan, limits, { tracked: usage.tracked, watched_closely: usage.watched_closely });
  const [query, setQuery] = useState('');

  // The list re-reads itself from the server; nothing here needs the rows.
  const refresh = useCallback(async () => { setQuery(''); router.refresh(); }, [router]);

  return (
    <>
      <div className="cs-page-head">
        <h1 className="cs-h1">Channels</h1>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="cs-hiscore">{planLabel(plan)} plan</div>
          <div className="cs-num" style={{ fontSize: 13 }}>{usage.tracked} channels</div>
        </div>
      </div>

      {!readOnly && (
        <div className="cs-section">
          <input
            className="cs-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or add a channel"
            aria-label="Search or add a channel"
          />
          {view.atTrackedLimit && (
            <div className="cs-note" data-tone="accent" style={{ marginTop: 10 }}>
              You are using all {limits.tracked} channels on the {planLabel(plan)} plan. Remove one, or upgrade to track more.
            </div>
          )}
        </div>
      )}

      <Suspense fallback={<ChannelCardsSkeleton />}>
        <ChannelRows
          channels={channels}
          readOnly={readOnly}
          query={query}
          onQueryChange={setQuery}
          trackedIds={trackedIds}
          onAdded={refresh}
          canAdd={!readOnly && !view.atTrackedLimit}
        />
      </Suspense>
    </>
  );
}

interface ChannelRowsProps {
  channels: ChannelRowLike[] | Promise<ChannelRowLike[]>;
  readOnly?: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  trackedIds: string[];
  onAdded: (channelId: string) => void | Promise<void>;
  canAdd: boolean;
}

/** The list, the filter over it, and the optimistic remove that edits it. */
function ChannelRows({ channels, readOnly, query, onQueryChange, trackedIds, onAdded, canAdd }: ChannelRowsProps) {
  const router = useRouter();
  const initial = Array.isArray(channels) ? channels : use(channels);
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const sorted = useMemo(() => sortChannels(rows), [rows]);
  const shown = useMemo(() => filterChannels(sorted, query), [sorted, query]);
  const offerAdd = canAdd && shouldOfferAdd(query, shown.length);

  async function remove(id: string, name: string | null) {
    if (!confirm(`Stop tracking ${name || id}?`)) return;
    const before = rows;
    setPending(id);
    setError(null);
    setRows((r) => r.filter((c) => c.channel_id !== id)); // optimistic
    try {
      const res = await fetch(`/api/app/channels/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not remove that channel.');
      router.refresh();
    } catch (e: any) {
      setRows(before); // put it back — the server still has it
      setError(e.message);
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      {error && <div className="cs-note" data-tone="bad" style={{ marginBottom: 12 }}>{error}</div>}

      {offerAdd && (
        <div style={{ marginBottom: 14 }}>
          <AddChannel trackedIds={trackedIds} onAdded={onAdded} value={query} onValueChange={onQueryChange} />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="cs-empty">
          <div className="cs-coin">No channels yet</div>
          <div className="cs-coin-sub">Add one above</div>
        </div>
      ) : shown.length === 0 ? null : (
        <ul className="cs-chan-list">
          {shown.map((c) => (
            <li className="cs-chan" key={c.channel_id}>
              <Link className="cs-chan-link" href={`/app/channels/${c.channel_id}`}>
                <ChannelAvatar src={c.avatar_url} name={c.name} size={28} channelId={c.channel_id} />
                <span className="cs-chan-name">{c.name || c.channel_id}</span>
                {c.role === 'self' && <span className="cs-chan-you">You</span>}
                <span className="cs-chan-baseline cs-num">{baselineLabel(c)}</span>
              </Link>
              {!readOnly && (
                <button
                  type="button"
                  className="cs-chan-remove"
                  disabled={pending === c.channel_id}
                  aria-label={`Stop tracking ${c.name || c.channel_id}`}
                  onClick={() => remove(c.channel_id, c.name)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
