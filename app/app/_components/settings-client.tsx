'use client';
import { useRef, useState } from 'react';
import { planLabel, usageView } from '@/lib/app/channel-view';
import { ChannelAvatar } from '@/components/app/avatar';
import { relativeTime } from '@/lib/app/feed-format';
import type { PlanLimits, PlanName } from '@/lib/app/plans';

export interface KeyRow {
  id: string;
  prefix: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface SettingsClientProps {
  profile: { name: string | null; email: string | null; imageUrl: string | null };
  plan: PlanName;
  limits: PlanLimits;
  usage: { tracked: number; watched_closely: number };
  keys: KeyRow[];
  /** Channels the user has connected with Google OAuth (owner analytics). */
  youtube?: { channel_id: string; channel_title: string | null; avatar_url?: string | null; connected_at: string; last_synced_at: string | null; last_error: string | null;
              sync?: { label: string; detail: string; tone: 'good'|'bad'|'accent'|'muted'; percent: number | null } }[];
  youtubeStatus?: string | null;
  readOnly?: boolean;
}

export default function SettingsClient({ profile, plan, limits, usage, keys, readOnly, youtube = [], youtubeStatus }: SettingsClientProps) {
  const [rows, setRows] = useState(keys);
  const ytInfo = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState('');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = usageView(plan, limits, usage);

  async function create() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/app/keys', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not create a key.');
      setRows((r) => [body.row, ...r]);
      setPlaintext(body.key); // the only time this value exists anywhere but the user's clipboard
      setLabel('');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this key? Anything using it stops working immediately.')) return;
    const before = rows;
    setRows((r) => r.map((k) => (k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k)));
    try {
      const res = await fetch(`/api/app/keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not revoke that key.');
    } catch (e: any) { setRows(before); setError(e.message); }
  }

  return (
    <>
      <div className="cs-page-head">
        <div>
          <h1 className="cs-h1">Settings</h1>
        </div>
      </div>

      <section className="cs-section">
        <h2>Profile</h2>
        <div className="cs-card">
          <div className="cs-card-head" style={{ alignItems: 'center' }}>
            {profile.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.imageUrl} alt="" width={44} height={44} style={{ borderRadius: '50%', flex: 'none' }} />
            )}
            <div>
              <p className="cs-card-name">{profile.name || 'Signed in'}</p>
              <div className="cs-pick-meta">{profile.email || '—'}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="cs-section">
        <h2>Plan</h2>
        <div className="cs-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="cs-badge" data-tone="accent">{planLabel(plan)}</span>
            <span className="cs-pick-meta">current plan</span>
          </div>
          <div className="cs-kv" style={{ marginTop: 10 }}>
            <span className="cs-kv-l">Tracked channels</span><span className="cs-num">{view.tracked}</span>
          </div>
          {!view.unlimited && (
            <div className="cs-meter"><div className="cs-meter-fill" style={{ width: `${view.trackedPct}%` }} /></div>
          )}
          {!view.unlimited && (
            <div className="cs-card-foot">
              <button type="button" className="cs-btn" disabled title="Stripe coming">Manage billing</button>
              <span className="cs-pick-meta">Stripe coming — plans are set by hand for now.</span>
            </div>
          )}
        </div>
      </section>

      <section className="cs-section">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h2>YouTube</h2>
          <button type="button" className="cs-linkbtn" onClick={() => ytInfo.current?.showModal()}>
            What we collect
          </button>
        </div>
        <p className="cs-sub" style={{ marginBottom: 10 }}>Private analytics from channels you own.</p>

        <div className="cs-card">
        {youtubeStatus === 'connected' && <div className="cs-note" data-tone="good" style={{ marginTop: 10 }}>Connected. Importing your history now.</div>}
        {youtubeStatus && youtubeStatus !== 'connected' && (
          <div className="cs-note" data-tone="bad" style={{ marginTop: 10 }}>
            {youtubeStatus === 'denied' ? 'You cancelled the Google prompt.'
              : youtubeStatus === 'nochannel' ? 'That Google account does not own a channel.'
              : 'Could not finish connecting. Try again.'}
          </div>
        )}

        {youtube.map((c) => (
          <div key={c.channel_id} className="cs-conn">
            <ChannelAvatar src={c.avatar_url} name={c.channel_title} size={36} channelId={c.channel_id} eager />
            <div className="cs-conn-body">
              <div className="cs-conn-name">
                {c.channel_title || c.channel_id}
                {c.sync && <span className="cs-badge" data-tone={c.sync.tone}>{c.sync.label}</span>}
              </div>
              <div className="cs-conn-meta">{c.sync ? c.sync.detail : 'Not synced yet'}</div>
              {c.sync?.percent != null && c.sync.percent < 100 && (
                <span className="cs-meter" aria-hidden><span style={{ width: `${c.sync.percent}%` }} /></span>
              )}
            </div>
            {!readOnly && (
              <button type="button" className="cs-btn" data-variant="danger"
                      onClick={async () => {
                        if (!confirm(`Disconnect ${c.channel_title || c.channel_id}? This deletes the analytics we stored for it.`)) return;
                        await fetch('/api/app/youtube/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel_id: c.channel_id }) });
                        location.reload();
                      }}>
                Disconnect
              </button>
            )}
          </div>
        ))}

        {!readOnly && (
          <div className="cs-card-foot">
            <a className="cs-btn" data-variant={youtube.length ? undefined : 'primary'} href="/api/app/youtube/connect">
              {youtube.length ? 'Connect another channel' : 'Connect a channel'}
            </a>
          </div>
        )}
        </div>

        <dialog ref={ytInfo} className="cs-dialog" onClick={(e) => { if (e.target === ytInfo.current) ytInfo.current?.close(); }}>
          <div className="cs-dialog-head">
            <h3>Connecting a channel</h3>
            <button type="button" className="cs-linkbtn" onClick={() => ytInfo.current?.close()}>Close</button>
          </div>
          <div className="cs-dialog-body">
            <dl className="cs-deflist">
              <dt>We read</dt>
              <dd>Per-day views, average view duration, and subscribers gained, for each of your videos.</dd>
              <dt>We do not read</dt>
              <dd>Revenue, earnings, or anything about your viewers as individuals.</dd>
              <dt>Who sees it</dt>
              <dd>Only you. Aggregates across connected channels are used to calibrate benchmarks, and never identify a channel.</dd>
              <dt>History</dt>
              <dd>Imported once when you connect, then updated daily. YouTube publishes about two days behind.</dd>
              <dt>Leaving</dt>
              <dd>Disconnecting deletes the analytics we stored for that channel.</dd>
            </dl>
          </div>
        </dialog>
      </section>

      <section className="cs-section">
        <h2>API keys</h2>
        <p className="cs-sub" style={{ marginBottom: 10 }}>
          Bearer keys for <span className="cs-num">/api/v1</span>. The key is shown once, at creation.
        </p>

        {plaintext && (
          <div className="cs-note" data-tone="accent" style={{ marginBottom: 10 }}>
            <strong>Copy this now — it will not be shown again.</strong>
            <div className="cs-code" style={{ marginTop: 8 }}>{plaintext}</div>
            <button type="button" className="cs-btn" style={{ marginTop: 8 }}
                    onClick={() => { navigator.clipboard?.writeText(plaintext); setPlaintext(null); }}>
              Copy and dismiss
            </button>
          </div>
        )}
        {error && <div className="cs-note" data-tone="bad" style={{ marginBottom: 10 }}>{error}</div>}

        {!readOnly && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input className="cs-input" value={label} maxLength={60} placeholder="Label (e.g. my agent)"
                   onChange={(e) => setLabel(e.target.value)} />
            <button type="button" className="cs-btn" data-variant="primary" disabled={busy} onClick={create}>
              {busy ? 'Creating…' : 'Create key'}
            </button>
          </div>
        )}

        <div className="cs-card">
          {rows.length === 0 ? (
            <div className="cs-pick-meta">No keys yet.</div>
          ) : rows.map((k) => (
            <div className="cs-kv" key={k.id}>
              <span>
                <span className="cs-num">{k.prefix}…</span>
                {k.label ? <span className="cs-kv-l"> · {k.label}</span> : null}
                <span className="cs-kv-l"> · created {relativeTime(k.created_at)} ago</span>
                {k.last_used_at
                  ? <span className="cs-kv-l"> · used {relativeTime(k.last_used_at)} ago</span>
                  : <span className="cs-kv-l"> · never used</span>}
              </span>
              {k.revoked_at
                ? <span className="cs-badge">revoked</span>
                : !readOnly && (
                  <button type="button" className="cs-btn" data-variant="danger" onClick={() => revoke(k.id)}>Revoke</button>
                )}
            </div>
          ))}
        </div>
      </section>

      <section className="cs-section">
        <h2>Danger zone</h2>
        <div className="cs-card">
          <div className="cs-card-foot">
            <a className="cs-btn" data-variant="danger"
               href={`mailto:brandon@makeorbreakshop.com?subject=${encodeURIComponent('Delete my ChannelSmith account')}`}>
              Request account deletion
            </a>
            <span className="cs-pick-meta">We delete accounts by hand, usually within a day.</span>
          </div>
        </div>
      </section>
    </>
  );
}
