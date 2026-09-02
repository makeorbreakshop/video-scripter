import Link from 'next/link';

/** The feed's empty state: a cabinet attract screen instead of a shrug. */
export default function InsertCoin({
  title = 'INSERT COIN',
  action = 'ADD A CHANNEL',
  href = '/app/channels',
  children,
}: {
  title?: string;
  action?: string;
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="cs-empty">
      <div className="cs-coin">{title}</div>
      <div className="cs-coin-sub">&gt;&gt; {action} &lt;&lt;</div>
      <p>{children ?? 'Track a channel and every upload, thumbnail swap, title edit and outlier lands here.'}</p>
      <div style={{ marginTop: 18 }}>
        <Link className="cs-btn" data-variant="primary" href={href}>{action.toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Link>
      </div>
    </div>
  );
}
