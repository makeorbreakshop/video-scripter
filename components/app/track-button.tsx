'use client';

// Track / untrack this channel. POST and DELETE against /api/app/channels, which is the same
// pair the channels list uses; a plan-limit refusal (402) is shown as-is rather than swallowed.

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export function TrackButton({ channelId, tracked }: { channelId: string; tracked: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(tracked);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setError(null);
    setSaving(true);
    try {
      const res = on
        ? await fetch(`/api/app/channels/${channelId}`, { method: 'DELETE' })
        : await fetch('/api/app/channels', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ channel_id: channelId }),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `request failed (${res.status})`);
        return;
      }
      setOn(!on);
      start(() => router.refresh());
    } catch {
      setError('network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="cs-btn"
        data-variant={on ? undefined : 'primary'}
        disabled={saving || busy}
        onClick={toggle}
      >
        {saving || busy ? 'Saving…' : on ? 'Untrack' : 'Track channel'}
      </button>
      {error && <span className="cs-note" data-tone="bad" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  );
}
