import Link from 'next/link';
import { overview, thumbnailHistories, describeHistory } from '@/lib/admin/queries';
import { n, compact, ago, etDateTime } from '@/lib/admin/format';
import { Stat, Spark, Section, Th, Td, VideoLink, ChannelLink } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const [o, changes] = await Promise.all([overview(), thumbnailHistories(15)]);
  const t = o.totals!;
  const today = new Date().toISOString().slice(0, 10);
  const todayN = (s: { day: string; n: number }[]) => s.find((d) => d.day === today)?.n ?? 0;
  const quotaTotal = o.quota.reduce((a, r) => a + r.units, 0);
  const due = o.tiers.reduce((a, r) => a + r.due, 0);

  return (
    <div>
      <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Totals are approximate (planner stats, refreshed every 10 min). Daily series are live. Times in ET.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Videos" value={compact(t.videos)} sub={`${n(t.videos_30d)} published in last 30d`} />
        <Stat label="Channels" value={compact(t.channels)} sub={`${n(t.channels_30d)} active in last 30d`} />
        <Stat label="View snapshots" value={compact(t.snapshots)} sub={`${n(todayN(o.snaps14))} today`} />
        <Stat
          label="Thumbnails watched"
          value={compact(t.watched)}
          sub={`${n(t.checked_24h)} checked in 24h · ${o.changes7} changes in 7d`}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Ingested today"
          value={n(todayN(o.ingest14))}
          sub={<Spark series={o.ingest14} />}
        />
        <Stat label="Snapshots / day" value={n(todayN(o.snaps14))} sub={<Spark series={o.snaps14} />} />
        <Stat
          label="Touch queue"
          value={n(o.queue?.pending)}
          sub={`${n(o.queue?.processed_24h)} processed in 24h${o.queue?.oldest ? ` · oldest ${ago(o.queue.oldest)}` : ''}`}
        />
        <Stat
          label="YouTube quota today"
          value={n(quotaTotal)}
          sub={o.quota.map((r) => `${r.category} ${n(r.units)}`).join(' · ') || 'no ledger rows yet'}
        />
      </div>

      <Section title="Tracking tiers" right={`${n(due)} due today or overdue`}>
        <div className="flex flex-wrap gap-2">
          {o.tiers.map((r) => (
            <div key={r.tier} className="rounded border border-border px-3 py-2 text-sm">
              <span className="font-medium">T{r.tier}</span>{' '}
              <span className="tabular-nums">{n(r.n)}</span>
              <span className="text-xs text-muted-foreground"> · {n(r.due)} due</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Latest thumbnail changes"
        right={<Link href="/admin/thumbnails" className="hover:underline">all changes →</Link>}
      >
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes detected yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Last change</Th>
                <Th>Video</Th>
                <Th>Channel</Th>
                <Th>History</Th>
                <Th className="text-right">Views</Th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => {
                const h = describeHistory(c.versions, c.is_live);
                return (
                  <tr key={c.video_id} className="border-t border-border/60">
                    <Td className="whitespace-nowrap text-muted-foreground">{etDateTime(c.last_change)}</Td>
                    <Td><VideoLink id={c.video_id} title={c.title} /></Td>
                    <Td><ChannelLink id={c.channel_id} name={c.channel_name} /></Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {h.pattern} <span className="text-xs text-muted-foreground">{h.kind}</span>
                    </Td>
                    <Td className="text-right tabular-nums">{compact(c.view_count)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
