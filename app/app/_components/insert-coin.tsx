import Link from 'next/link';

/** The feed's empty state: says what is missing and gives the one action that fixes it. */
export default function InsertCoin({
  title = 'Nothing to show yet',
  action = 'Add a channel',
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
      <div className="cs-coin-sub">{action}</div>
      <p>{children ?? 'Track a channel and every upload, thumbnail swap, title edit and outlier lands here.'}</p>
      <div style={{ marginTop: 18 }}>
        <Link className="cs-btn" data-variant="primary" href={href}>{action.toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Link>
      </div>
    </div>
  );
}
