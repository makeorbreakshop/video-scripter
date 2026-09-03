'use client';
// A channel's YouTube avatar, hotlinked from YouTube's CDN (we deliberately do not host
// copies). YouTube rotates avatar URLs occasionally; when one fails to load, the component
// asks the server for the current URL once (1 unit, throttled per channel per day) and
// retries. Falls back to the channel's initial on a neutral disc so a missing avatar never
// leaves a hole in a row or a card.
import { useEffect, useRef, useState } from 'react';

export function ChannelAvatar({
  src, name, size = 28, className, eager, channelId,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  /** Fetch immediately (search results the user is looking at) instead of lazily (long lists). */
  eager?: boolean;
  /** When given, a failed load asks the server to refresh this channel's avatar URL. */
  channelId?: string | null;
}) {
  const [cur, setCur] = useState<string | null>(src ?? null);
  const tried = useRef(false);
  useEffect(() => { setCur(src ?? null); tried.current = false; }, [src]);

  async function onError() {
    if (tried.current || !channelId) { setCur(null); return; }
    tried.current = true;
    try {
      const res = await fetch('/api/app/channels/avatar', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel_id: channelId }),
      });
      const body = await res.json().catch(() => null);
      const next = body?.avatar_url;
      setCur(next && next !== cur ? next : null);
    } catch { setCur(null); }
  }

  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const style: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%', flex: 'none',
    objectFit: 'cover', background: 'var(--cs-surface-2)', border: '1px solid var(--cs-line)',
  };
  if (!cur) {
    return (
      <span
        aria-hidden
        className={className}
        style={{
          ...style,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--cs-muted)', fontSize: Math.max(10, Math.round(size * 0.45)), fontWeight: 650,
        }}
      >
        {initial}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={cur} alt="" width={size} height={size} loading={eager ? 'eager' : 'lazy'} decoding="async"
         referrerPolicy="no-referrer" onError={onError} style={style} />
  );
}
