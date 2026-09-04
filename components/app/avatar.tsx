'use client';
// A channel's YouTube avatar, hotlinked from YouTube's CDN: fast, always current, no API.
// YouTube rotates those URLs occasionally, so when the hotlink fails the component switches
// to our copy in R2 (avatars/{channelId}.jpg, filled nightly by scripts/avatar-cache-sync.ts),
// and if that is missing too, to the channel's initial on a neutral disc. No network call
// beyond the two image requests.
import { useEffect, useState } from 'react';
import { avatarCacheUrl } from '@/lib/thumbs/storage';
import { sizedAvatarUrl } from '@/lib/app/avatar-url';


export function ChannelAvatar({
  src, name, size = 28, className, eager, channelId,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  /** Fetch immediately (search results the user is looking at) instead of lazily (long lists). */
  eager?: boolean;
  /** Enables the R2 fallback copy when the hotlink fails. */
  channelId?: string | null;
}) {
  const fallback = channelId ? avatarCacheUrl(channelId) : null;
  const sized = src ? sizedAvatarUrl(src, size) : null;
  const [cur, setCur] = useState<string | null>(sized ?? fallback);
  useEffect(() => { setCur(sized ?? fallback); }, [sized, fallback]);

  function onError() {
    setCur((c) => (fallback && c !== fallback ? fallback : null));
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
