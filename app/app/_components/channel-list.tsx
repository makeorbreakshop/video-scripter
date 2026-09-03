'use client';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AddChannel from './add-channel';
import { ChannelAvatar } from '@/components/app/avatar';
import {
  channelStats, planLabel, roleLabel, usageView, type ChannelRowLike,
} from '@/lib/app/channel-view';
import type { PlanLimits, PlanName } from '@/lib/app/plans';

export interface ChannelsClientProps {
  channels: ChannelRowLike[];
  plan: PlanName;
  limits: PlanLimits;
  usage: { tracked: number; watched_closely: number };
  /** Read-only mode for previews; hides the mutating controls. */
  readOnly?: boolean;
}

export default function ChannelsClient({ channels, plan, limits, usage, readOnly }: ChannelsClientProps) {
  const router = useRouter();
  const [rows, setRows] = useState(channels);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const view = usageView(plan, limits, { tracked: rows.length, watched_closely: usage.watched_closely });

  const refresh = useCallback(async () => {
    const res = await fetch('/api/app/channels');
    if (!res.ok) return;
    const body = await res.json();
    setRows(body.channels || []);
    router.refresh();
  }, [router]);

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

  const trackedIds = rows.map((r) => r.channel_id);

  return (
    <>
      <div className="cs-page-head">
        <div>
          <h1 className="cs-h1">Channels</h1>
          <p className="cs-sub">Everything you track.</p>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="cs-hiscore">{planLabel(plan)} plan</div>
          <div className="cs-num" style={{ fontSize: 13 }}>{rows.length} channels</div>
        </div>
      </div>

      {!readOnly && (
        <div className="cs-section">
          {view.atTrackedLimit ? (
            <div className="cs-note" data-tone="accent">
              You are using all {limits.tracked} channels on the {planLabel(plan)} plan. Remove one, or upgrade to track more.
            </div>
          ) : (
            <AddChannel trackedIds={trackedIds} onAdded={refresh} />
          )}
        </div>
      )}

      {error && <div className="cs-note" data-tone="bad" style={{ marginBottom: 12 }}>{error}</div>}

      {rows.length === 0 ? (
        <div className="cs-empty">
          <div className="cs-coin">No channels yet</div>
          <div className="cs-coin-sub">Add one above</div>
          <p>Start with your own channel, then add the competitor you measure yourself against.</p>
        </div>
      ) : (
        <div className="cs-grid">
          {rows.map((c) => (
            <div className="cs-card" key={c.channel_id}>
              <div className="cs-card-head">
                <Link href={`/app/channels/${c.channel_id}`} aria-label={c.name || c.channel_id}>
                  <ChannelAvatar src={c.avatar_url} name={c.name} size={48} channelId={c.channel_id} />
                </Link>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link href={`/app/channels/${c.channel_id}`}>
                    <p className="cs-card-name">{c.name || c.channel_id}</p>
                  </Link>
                  <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                    <span className="cs-badge" data-case="sentence" data-tone={c.role === 'self' ? 'accent' : undefined}>{roleLabel(c.role)}</span>
                  </div>
                </div>
              </div>

              <div className="cs-stats">
                {channelStats(c).map((s) => (
                  <div key={s.label}>
                    <div className="cs-stat-v">{s.value}</div>
                    <div className="cs-stat-l">{s.label}</div>
                  </div>
                ))}
              </div>

              {!readOnly && (
                <div className="cs-card-foot">
                  <Link className="cs-btn" href={`/app/channels/${c.channel_id}`}>Open</Link>
                  <button type="button" className="cs-btn" data-variant="danger" style={{ marginLeft: 'auto' }}
                          disabled={pending === c.channel_id} onClick={() => remove(c.channel_id, c.name)}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
