import { recentOutliers } from '@/lib/admin/queries';
import { compact, ago, score } from '@/lib/admin/format';
import { Th, Td, VideoLink, ChannelLink, Yt } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function Outliers({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days } = await searchParams;
  const d = Math.min(90, Math.max(1, parseInt(days ?? '14', 10) || 14));
  const rows = await recentOutliers(d, 60);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Outliers</h1>
        <form className="flex items-center gap-2 text-xs text-muted-foreground">
          last
          <input name="days" defaultValue={d} className="w-14 rounded border border-border bg-transparent px-2 py-1 text-sm" />
          days
          <button className="rounded border border-border px-2 py-1 hover:bg-muted">go</button>
        </form>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Top videos by temporal performance score (channel-relative, age-adjusted). Only ~36% of recent videos are
        scored yet, and the score is directional until the baseline-unit unification lands. Shorts and institutional
        channels excluded.
      </p>

      <table className="mt-6 w-full">
        <thead>
          <tr>
            <Th className="text-right">Score</Th>
            <Th>Video</Th>
            <Th>Channel</Th>
            <Th className="text-right">Views</Th>
            <Th className="text-right">Age</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-t border-border/60">
              <Td className="text-right font-semibold tabular-nums">{score(v.temporal_performance_score)}</Td>
              <Td><VideoLink id={v.id} title={v.title} /> <Yt id={v.id} /></Td>
              <Td><ChannelLink id={v.channel_id} name={v.channel_name} /></Td>
              <Td className="text-right tabular-nums">{compact(v.view_count)}</Td>
              <Td className="text-right text-muted-foreground">{ago(v.published_at)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
