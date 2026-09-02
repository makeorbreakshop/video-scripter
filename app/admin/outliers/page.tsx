import { recentOutliers } from '@/lib/admin/queries';
import { compact, ago, n } from '@/lib/admin/format';
import { Th, Td, VideoLink, ChannelLink, Yt } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

const CONF_CLS: Record<string, string> = {
  early: 'bg-muted text-muted-foreground',
  likely: 'bg-sky-500/15 text-sky-400',
  confirmed: 'bg-emerald-500/15 text-emerald-400',
};

export default async function Outliers({ searchParams }: { searchParams: Promise<{ days?: string; min?: string; by?: string }> }) {
  const { days, min, by } = await searchParams;
  const sortBy = by === 'ratio' ? 'same_age_ratio' : 'score';
  const d = Math.min(30, Math.max(1, parseInt(days ?? '14', 10) || 14));
  const minMedian = Math.max(0, parseInt(min ?? '100', 10) || 0);
  const rows = await recentOutliers(d, 60, minMedian, sortBy);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Outliers</h1>
        <form className="flex items-center gap-2 text-xs text-muted-foreground">
          last <input name="days" defaultValue={d} className="w-12 rounded border border-border bg-transparent px-2 py-1 text-sm" /> days ·
          channel baseline ≥ <input name="min" defaultValue={minMedian} className="w-16 rounded border border-border bg-transparent px-2 py-1 text-sm" /> views ·
          sort <select name="by" defaultValue={by === 'ratio' ? 'ratio' : 'score'} className="rounded border border-border bg-transparent px-2 py-1 text-sm"><option value="score">projected day-30 score</option><option value="ratio">same-age ratio</option></select>
          <button className="rounded border border-border px-2 py-1 hover:bg-muted">go</button>
        </form>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Model v3, scored hourly from stored snapshots. Score = projected day-30 views (the video's own growth exponent blended with the
        channel's growth multiplier, read at true age) divided by the median day-30 views of the channel's last 10 videos. Same-age ratio =
        latest views vs the channel's prior videos at the same age. Confidence: early under 3 days, likely 3 to 6, confirmed from day 7.
      </p>

      {rows.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No scored videos in this window yet (needs snapshots on the video and on its channel's prior videos).</p>}

      <table className="mt-6 w-full">
        <thead>
          <tr>
            <Th className="text-right">Score</Th>
            <Th className="text-right">Same-age</Th>
            <Th>Confidence</Th>
            <Th>Video</Th>
            <Th>Channel</Th>
            <Th className="text-right">Day</Th>
            <Th className="text-right">Views</Th>
            <Th className="text-right">Projected d30</Th>
            <Th className="text-right">Channel baseline</Th>
            <Th className="text-right">n</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const c = v.confidence;
            return (
              <tr key={v.id} className="border-t border-border/60">
                <Td className="text-right font-semibold tabular-nums">{v.score != null ? v.score.toFixed(1) + '×' : '–'}</Td>
                <Td className="text-right tabular-nums text-muted-foreground">{v.same_age_ratio != null ? v.same_age_ratio.toFixed(1) + '×' : '–'}</Td>
                <Td><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CONF_CLS[c]}`}>{c}</span></Td>
                <Td><VideoLink id={v.id} title={v.title} /> <Yt id={v.id} /></Td>
                <Td><ChannelLink id={v.channel_id} name={v.channel_name} /></Td>
                <Td className="text-right tabular-nums">{Math.round(v.day)}</Td>
                <Td className="text-right tabular-nums">{compact(v.views)}</Td>
                <Td className="text-right tabular-nums text-muted-foreground">{compact(Math.round(v.est30))}</Td>
                <Td className="text-right tabular-nums text-muted-foreground">{v.baseline != null ? compact(Math.round(v.baseline)) : '–'}</Td>
                <Td className="text-right tabular-nums text-muted-foreground">{n(v.n_baseline)}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-6 text-xs text-muted-foreground">
        Published {ago(new Date(Date.now() - d * 86400000).toISOString())} and later. Legacy temporal score is no longer used anywhere in the admin.
      </p>
    </div>
  );
}
