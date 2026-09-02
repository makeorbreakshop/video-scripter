'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import AddChannel from './add-channel';
import {
  backfillNote, channelStats, roleLabel, usageView, type ChannelRowLike,
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

  async function setWatched(id: string, next: boolean) {
    const before = rows;
    setPending(id);
    setError(null);
    setRows((r) => r.map((c) => (c.channel_id === id ? { ...c, watched_closely: next } : c)));
    try {
      const row = before.find((c) => c.channel_id === id);
      const res = await fetch('/api/app/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel_id: id, role: row?.role || 'competitor', watched_closely: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Could not change that setting.');
      }
      router.refresh();
    } catch (e: any) {
      setRows(before);
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
          <p className="cs-sub">Everything you track. Watched-closely channels get denser sampling.</p>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="cs-hiscore">{plan} plan</div>
          <div className="cs-num" style={{ fontSize: 13 }}>{view.tracked} channels</div>
        </div>
      </div>

      {!readOnly && (
        <div className="cs-section">
          {view.atTrackedLimit ? (
            <div className="cs-note" data-tone="accent">
              You are using all {limits.tracked} channels on the {plan} plan. Remove one, or upgrade to track more.
            </div>
          ) : (
            <AddChannel trackedIds={trackedIds} onAdded={refresh} />
          )}
        </div>
      )}

      {error && <div className="cs-note" data-tone="bad" style={{ marginBottom: 12 }}>{error}</div>}

      {rows.length === 0 ? (
        <div className="cs-empty">
          <div className="cs-coin">NO CHANNELS</div>
          <div className="cs-coin-sub">&gt;&gt; ADD ONE ABOVE &lt;&lt;</div>
          <p>Start with your own channel, then add the competitor you measure yourself against.</p>
        </div>
      ) : (
        <div className="cs-grid">
          {rows.map((c) => {
            const note = backfillNote(c);
            return (
              <div className="cs-card" key={c.channel_id}>
                <div className="cs-card-head">
                  <div className="cs-card-thumb">
                    {c.thumbnail_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="cs-card-name">{c.name || c.channel_id}</p>
                    <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                      <span className="cs-badge" data-tone={c.role === 'self' ? 'accent' : undefined}>{roleLabel(c.role)}</span>
                      {c.lane && <span className="cs-badge">{c.lane} lane</span>}
                    </div>
                    {note && <div className="cs-pick-meta" style={{ marginTop: 5 }}>{note}</div>}
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
                    <label className="cs-switch">
                      <span className="cs-switch-track" data-on={c.watched_closely}><span className="cs-switch-knob" /></span>
                      <input type="checkbox" checked={c.watched_closely} disabled={pending === c.channel_id}
                             onChange={(e) => setWatched(c.channel_id, e.target.checked)}
                             style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
                      watched closely
                    </label>
                    <button type="button" className="cs-btn" data-variant="danger" style={{ marginLeft: 'auto' }}
                            disabled={pending === c.channel_id} onClick={() => remove(c.channel_id, c.name)}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
