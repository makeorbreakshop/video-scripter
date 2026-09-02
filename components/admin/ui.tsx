import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { DayCount } from '@/lib/admin/queries';

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Spark({ series, width = 160, height = 32 }: { series: DayCount[]; width?: number; height?: number }) {
  if (!series.length) return <div style={{ width }} className="text-xs text-muted-foreground">no data</div>;
  const max = Math.max(...series.map((d) => d.n), 1);
  const bw = Math.min(8, Math.max(2, Math.floor(width / series.length) - 2));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <svg width={width} height={height} role="img" aria-label="daily series">
      {series.map((d, i) => {
        const h = Math.max(1, Math.round((d.n / max) * (height - 2)));
        return (
          <rect
            key={d.day}
            x={i * (bw + 2)}
            y={height - h}
            width={bw}
            height={h}
            rx={1}
            className={d.day === today ? 'fill-foreground' : 'fill-muted-foreground/35'}
          >
            <title>{`${d.day}: ${d.n.toLocaleString()}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right && <div className="text-xs text-muted-foreground">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('px-2 py-1.5 text-left text-xs font-medium text-muted-foreground', className)}>{children}</th>;
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('px-2 py-1.5 align-top text-sm', className)}>{children}</td>;
}

export function VideoLink({ id, title }: { id: string; title: string }) {
  return (
    <Link href={`/admin/videos/${id}`} prefetch={false} className="hover:underline" title={title}>
      {title.length > 70 ? title.slice(0, 70) + '…' : title}
    </Link>
  );
}

export function ChannelLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/admin/channels/${id}`} prefetch={false} className="text-muted-foreground hover:text-foreground hover:underline">
      {name || id}
    </Link>
  );
}

export function Yt({ id }: { id: string }) {
  return (
    <a href={`https://youtu.be/${id}`} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">
      yt ↗
    </a>
  );
}

export function TierBadge({ tier }: { tier: number | null }) {
  if (tier == null) return <span className="text-xs text-muted-foreground">–</span>;
  const cls = ['bg-emerald-500/20 text-emerald-400', 'bg-sky-500/20 text-sky-400', 'bg-muted', 'bg-muted', 'bg-muted'][tier] ?? 'bg-muted';
  return <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', cls)}>T{tier}</span>;
}
