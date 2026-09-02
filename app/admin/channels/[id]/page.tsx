import Link from 'next/link';
import { notFound } from 'next/navigation';
import { channelDetail } from '@/lib/admin/queries';
import { n, compact, ago, etDate, score } from '@/lib/admin/format';
import { Stat, Spark, Section, Th, Td, VideoLink, Yt, TierBadge } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { channel, videos, snapDays } = await channelDetail(id);
  if (!channel) notFound();

  const recent = videos.filter((v) => Date.now() - new Date(v.published_at).getTime() < 30 * 86400000);
  const scored = recent.filter((v) => v.temporal_performance_score != null);
  const changes = videos.reduce((a, v) => a + Math.max(0, v.thumb_versions - 1), 0);
  const snaps30 = snapDays.reduce((a, d) => a + d.n, 0);

  return (
    <div>
      <div className="text-xs text-muted-foreground"><Link href="/admin/channels" className="hover:underline">Channels</Link> /</div>
      <h1 className="text-lg font-semibold tracking-tight">
        {channel.channel_name}{' '}
        <a href={`https://www.youtube.com/channel/${id}`} target="_blank" rel="noreferrer" className="text-xs font-normal text-muted-foreground hover:underline">yt ↗</a>
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">{id}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Videos tracked" value={n(channel.videos_total)} sub={`first ${etDate(channel.first)}`} />
        <Stat label="Uploads 30d" value={n(recent.length)} sub={`latest ${ago(channel.latest)}`} />
        <Stat label="Snapshots 30d" value={n(snaps30)} sub={<Spark series={snapDays} />} />
        <Stat
          label="Thumb changes"
          value={n(changes)}
          sub={changes ? <Link href={`/admin/thumbnails?channel=${id}`} className="hover:underline">view changes →</Link> : 'none in tracked videos'}
        />
      </div>

      {scored.length > 0 && (
        <Section title="Outliers, last 30 days" right="temporal score, channel-relative · directional until baseline unification lands">
          <div className="flex flex-wrap gap-2">
            {[...scored]
              .sort((a, b) => Number(b.temporal_performance_score) - Number(a.temporal_performance_score))
              .slice(0, 6)
              .map((v) => (
                <div key={v.id} className="w-64 rounded border border-border p-2 text-xs">
                  <div className="text-sm font-semibold tabular-nums">{score(v.temporal_performance_score)}</div>
                  <div className="mt-1 line-clamp-2"><VideoLink id={v.id} title={v.title} /></div>
                  <div className="mt-1 text-muted-foreground">{compact(v.view_count)} views · {ago(v.published_at)}</div>
                </div>
              ))}
          </div>
        </Section>
      )}

      <Section title="Recent videos" right={`${videos.length} most recent`}>
        <table className="w-full">
          <thead>
            <tr>
              <Th>Video</Th>
              <Th>Published</Th>
              <Th className="text-right">Views</Th>
              <Th className="text-right">Score</Th>
              <Th className="text-right">Tier</Th>
              <Th className="text-right">Snaps</Th>
              <Th className="text-right">Thumb v</Th>
              <Th>Tracked</Th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => (
              <tr key={v.id} className="border-t border-border/60">
                <Td>
                  <VideoLink id={v.id} title={v.title} /> <Yt id={v.id} />
                  {v.is_short && <span className="ml-1 text-[10px] text-muted-foreground">short</span>}
                </Td>
                <Td className="whitespace-nowrap text-muted-foreground">{etDate(v.published_at)}</Td>
                <Td className="text-right tabular-nums">{compact(v.view_count)}</Td>
                <Td className="text-right tabular-nums">{score(v.temporal_performance_score)}</Td>
                <Td className="text-right"><TierBadge tier={v.priority_tier} /></Td>
                <Td className="text-right tabular-nums">{v.snapshots}</Td>
                <Td className="text-right tabular-nums">
                  {v.thumb_versions > 1 ? <span className="text-amber-400">v{v.thumb_versions}</span> : v.thumb_versions || '–'}
                </Td>
                <Td className="whitespace-nowrap text-muted-foreground">{v.last_tracked ? ago(v.last_tracked) : '–'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
