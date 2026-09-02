import { recentOutliers, confidenceForDay } from '@/lib/admin/queries';
import { compact, ago, n } from '@/lib/admin/format';
import { Th, Td, VideoLink, ChannelLink, Yt } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

const CONF_CLS: Record<string, string> = {
  early: 'bg-muted text-muted-foreground',
  likely: 'bg-sky-500/15 text-sky-400',
  confirmed: 'bg-emerald-500/15 text-emerald-400',
};

export default async function Outliers({ searchParams }: { searchParams: Promise<{ days?: string; min?: string }> }) {
  const { days, min } = await searchParams;
  const d = Math.min(30, Math.max(1, parseInt(days ?? '14', 10) || 14));
  const minMedian = Math.max(0, parseInt(min ?? '100', 10) || 0);
  const rows = await recentOutliers(d, 60, minMedian);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Outliers</h1>
        <form className="flex items-center gap-2 text-xs text-muted-foreground">
          last <input name="days" defaultValue={d} className="w-12 rounded border border-border bg-transparent px-2 py-1 text-sm" /> days ·
          channel median ≥ <input name="min" defaultValue={minMedian} className="w-16 rounded border border-border bg-transparent px-2 py-1 text-sm" /> views
          <button className="rounded border border-border px-2 py-1 hover:bg-muted">go</button>
        </form>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Same-age ratio: this video's latest snapshot divided by the median of the channel's last 10 videos at the same age
        (at least 3 comparables). Backtested: ranks videos at 0.87 correlation with the day-30 outcome by day 3, 0.93 by day 7.
        Confidence follows age: early under 3 days, likely 3 to 6, confirmed from day 7. Cached 15 min.
      </p>

      {rows.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No scored videos in this window yet (needs snapshots on the video and on its channel's prior videos).</p>}

      <table className="mt-6 w-full">
        <thead>
          <tr>
            <Th className="text-right">Ratio</Th>
            <Th>Confidence</Th>
            <Th>Video</Th>
            <Th>Channel</Th>
            <Th className="text-right">Day</Th>
            <Th className="text-right">Views</Th>
            <Th className="text-right">Channel median @ same age</Th>
            <Th className="text-right">n</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const c = confidenceForDay(v.day);
            return (
              <tr key={v.id} className="border-t border-border/60">
                <Td className="text-right font-semibold tabular-nums">{v.ratio.toFixed(1)}×</Td>
                <Td><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CONF_CLS[c]}`}>{c}</span></Td>
                <Td><VideoLink id={v.id} title={v.title} /> <Yt id={v.id} /></Td>
                <Td><ChannelLink id={v.channel_id} name={v.channel_name} /></Td>
                <Td className="text-right tabular-nums">{v.day}</Td>
                <Td className="text-right tabular-nums">{compact(v.views)}</Td>
                <Td className="text-right tabular-nums text-muted-foreground">{compact(v.ch_median)}</Td>
                <Td className="text-right tabular-nums text-muted-foreground">{n(v.n)}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-6 text-xs text-muted-foreground">
        Published {ago(new Date(Date.now() - d * 86400000).toISOString())} and later. The legacy temporal score column is no longer shown here.
      </p>
    </div>
  );
}
