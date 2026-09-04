'use client';
// The import sheet: the channels this account already subscribes to on YouTube, ready to
// track. Anything already tracked is listed but unchecked; everything else starts checked.
//
// Native <dialog>, so the focus trap, Esc and the backdrop come for free — the same shape
// the app's other modal uses.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChannelAvatar } from '@/components/app/avatar';
import { compactNumber } from '@/lib/app/feed-format';
import { avatarAt } from '@/lib/app/channel-view';
import {
  importDefaults, importVisible, importButtonLabel, type SubscriptionLike,
} from '@/lib/app/groups-view';

interface Sub extends SubscriptionLike {
  avatar_url: string | null;
  subscriber_count: number | null;
}

export default function ImportSubscriptions({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: (tracked: number) => void | Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [account, setAccount] = useState<{ total: number; tracked: number } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; connect?: string } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setSubs(null); setError(null); setExpanded(false);
    (async () => {
      const res = await fetch('/api/app/subscriptions');
      const body = await res.json().catch(() => ({}));
      if (!live) return;
      if (!res.ok) {
        setError({ message: body?.error || 'Could not read your subscriptions.', connect: body?.connect_url });
        return;
      }
      const items: Sub[] = body.subscriptions || [];
      setSubs(items);
      setAccount({ total: body.total ?? items.length, tracked: body.tracked ?? 0 });
      setPicked(importDefaults(items));
    })();
    return () => { live = false; };
  }, [open]);

  const { shown, more } = useMemo(() => importVisible(subs || [], expanded), [subs, expanded]);

  function toggle(id: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function track() {
    setBusy(true);
    try {
      const res = await fetch('/api/app/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel_ids: Array.from(picked) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError({ message: body?.error || 'Could not import those channels.' }); return; }
      await onImported(body.tracked ?? 0);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="cs-dialog cs-sheet" onClose={onClose} aria-label="Import subscriptions">
      <div className="cs-sheet-head">
        <h2>Import subscriptions</h2>
        {account && (
          <div className="cs-sheet-acct">
            <b>{account.total}</b> subscriptions · <b>{account.tracked}</b> already tracked
          </div>
        )}
      </div>

      {error ? (
        <div style={{ padding: '0 28px 8px' }}>
          <div className="cs-note" data-tone="bad">{error.message}</div>
        </div>
      ) : subs === null ? (
        <div className="cs-sheet-list">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="cs-skel" style={{ height: 48 }} />)}
        </div>
      ) : subs.length === 0 ? (
        <div style={{ padding: '0 28px 8px' }}>
          <div className="cs-note">Nothing new to import.</div>
        </div>
      ) : (
        <div className="cs-sheet-list">
          {shown.map((s) => (
            <label key={s.channel_id} className="cs-sheet-row" data-tracked={s.tracked || undefined}>
              <input
                type="checkbox" className="cs-check"
                checked={picked.has(s.channel_id)}
                onChange={() => toggle(s.channel_id)}
              />
              <ChannelAvatar src={avatarAt(s.avatar_url, 48)} name={s.name} size={24} channelId={s.channel_id} />
              <span className="cs-sheet-name">{s.name}</span>
              <span className="cs-sheet-n">
                {s.tracked ? 'TRACKED' : s.subscriber_count == null ? '' : compactNumber(s.subscriber_count)}
              </span>
            </label>
          ))}
          {more > 0 && (
            <button type="button" className="cs-sheet-more" onClick={() => setExpanded(true)}>
              + {more} MORE
            </button>
          )}
        </div>
      )}

      <div className="cs-sheet-foot">
        <button type="button" className="cs-linkish" onClick={onClose}>Not now</button>
        <div className="cs-sheet-foot-right">
          {error?.connect ? (
            <a className="cs-btn" data-variant="primary" href={error.connect}>Connect YouTube</a>
          ) : (
            <>
              <button type="button" className="cs-linkish" disabled={!picked.size}
                      onClick={() => setPicked(new Set())}>Deselect all</button>
              <button type="button" className="cs-btn" data-variant="primary"
                      disabled={busy || !picked.size} onClick={track}>
                {busy ? 'Tracking…' : importButtonLabel(picked.size)}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
