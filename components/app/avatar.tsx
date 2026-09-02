// A channel's YouTube avatar, from channel_meta. Falls back to the channel's initial
// on a neutral disc so a missing avatar never leaves a hole in a row or a card.
export function ChannelAvatar({
  src, name, size = 28, className,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const style: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%', flex: 'none',
    objectFit: 'cover', background: 'var(--cs-surface-2)', border: '1px solid var(--cs-line)',
  };
  if (!src) {
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
    <img className={className} src={src} alt="" width={size} height={size} loading="lazy"
         referrerPolicy="no-referrer" style={style} />
  );
}
