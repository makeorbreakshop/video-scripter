import Link from 'next/link';
import { notFound } from 'next/navigation';
import { videoDetail, describeHistory, videoScore } from '@/lib/admin/queries';
import { n, compact, ago, etDate, etDateTime, score, ageDays } from '@/lib/admin/format';
import { Stat, Section, ChannelLink, TierBadge } from '@/components/admin/ui';
import { SnapshotChart } from '@/components/admin/snapshot-chart';
import { ThumbImg } from '@/components/admin/thumb-img';
import { thumbUrl } from '@/lib/thumbs/storage';

export const dynamic = 'force-dynamic';

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ video: v, snapshots, versions }, sc] = await Promise.all([videoDetail(id), videoScore(id)]);
  if (!v) notFound();

  const hist = describeHistory(versions, v.duration === 'P0D');
  const markers = hist.labeled
    .filter((x) => x.version > 1)
    .map((x) => ({ day: new Date(x.first_seen).toISOString().slice(0, 10), label: `thumb ${x.label}` }));
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const velocity =
    snapshots.length >= 2
      ? (Number(last.view_count) - Number(first.view_count)) /
        Math.max(1, (new Date(last.day).getTime() - new Date(first.day).getTime()) / 86400000)
      : null;

  return (
    <div>
      <div className="text-xs text-muted-foreground">
        <ChannelLink id={v.channel_id} name={v.channel_name} /> /
      </div>
      <h1 className="text-lg font-semibold tracking-tight">
        {v.title}{' '}
        <a href={`https://youtu.be/${id}`} target="_blank" rel="noreferrer" className="text-xs font-normal text-muted-foreground hover:underline">yt ↗</a>
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        {id} · published {etDateTime(v.published_at)} ET ({ageDays(v.published_at)}d ago) · imported {etDate(v.import_date)}
        {v.format_type && <> · {v.format_type}</>}{v.topic_niche && <> · {v.topic_niche}</>}{v.is_short && <> · short</>}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Views" value={compact(v.view_count)} sub={`${compact(v.like_count)} likes · ${compact(v.comment_count)} comments`} />
        <Stat
          label="Score (model v3)"
          value={sc?.score != null ? sc.score.toFixed(1) + '×' : sc ? sc.confidence : '–'}
          sub={sc ? `${sc.confidence} · same-age ${sc.same_age_ratio != null ? sc.same_age_ratio.toFixed(1) + '×' : '–'} · projected d30 ${compact(Math.round(sc.est30))} vs baseline ${sc.baseline != null ? compact(Math.round(sc.baseline)) : '–'} (n=${sc.n_baseline}) · scored ${ago(sc.scored_at)}` : 'not scored yet (hourly job, videos ≤60d)'}
        />
        <Stat
          label="Tracking"
          value={<TierBadge tier={v.priority_tier} />}
          sub={`${snapshots.length} snapshots · last ${v.last_tracked ? ago(v.last_tracked) : '–'} · next ${v.next_track_date ? etDate(v.next_track_date) : '–'}`}
        />
        <Stat
          label="Velocity"
          value={velocity != null ? compact(Math.round(velocity)) + '/d' : '–'}
          sub={snapshots.length >= 2 ? `avg over ${first.day} → ${last.day}` : 'needs 2+ snapshots'}
        />
      </div>

      <Section title="View history" right="one point per snapshot date · amber = thumbnail change">
        <div className="rounded-lg border border-border p-3">
          <SnapshotChart snapshots={snapshots} markers={markers} />
        </div>
      </Section>

      <Section title="Thumbnail versions" right={versions.length ? `${versions.length} archived · ${hist.distinct} distinct${versions.length > 1 ? ` · ${hist.pattern} (${hist.kind})` : ''}` : 'not watched (older than 30d at first run, or not yet polled)'}>
        <div className="flex flex-wrap gap-4">
          {hist.labeled.map((x) => (
            <figure key={x.version} className="w-64">
              <ThumbImg src={thumbUrl(id, x.version) ?? `/api/admin/thumb/${id}/${x.version}`} fallbackSrc={`/api/admin/thumb/${id}/${x.version}`} alt={`v${x.version}`} dim={x.repeat} />
              <figcaption className="mt-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">v{x.version} · image {x.label}</span>{x.repeat && ' (again)'} · first seen {etDateTime(x.first_seen)} · last checked {ago(x.last_checked)}
              </figcaption>
            </figure>
          ))}
          {!versions.length && v.thumbnail_url && (
            <figure className="w-64">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.thumbnail_url} alt="current" className="aspect-video w-full rounded object-cover" />
              <figcaption className="mt-1 text-[11px] text-muted-foreground">current (from YouTube, not archived)</figcaption>
            </figure>
          )}
        </div>
      </Section>

      {snapshots.length > 0 && (
        <Section title="Snapshots">
          <table className="w-full max-w-xl text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-right">Day</th>
                <th className="px-2 py-1 text-right">Views</th>
                <th className="px-2 py-1 text-right">Δ</th>
                <th className="px-2 py-1 text-right">Likes</th>
              </tr>
            </thead>
            <tbody>
              {[...snapshots].reverse().map((s, i, arr) => {
                const prev = arr[i + 1];
                return (
                  <tr key={s.day} className="border-t border-border/60 tabular-nums">
                    <td className="px-2 py-1">{s.day}</td>
                    <td className="px-2 py-1 text-right">{s.days_since_published}</td>
                    <td className="px-2 py-1 text-right">{n(s.view_count)}</td>
                    <td className="px-2 py-1 text-right text-muted-foreground">{prev ? '+' + n(Number(s.view_count) - Number(prev.view_count)) : ''}</td>
                    <td className="px-2 py-1 text-right">{n(s.like_count)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}
      <p className="mt-8 text-xs text-muted-foreground">
        <Link href={`/admin/channels/${v.channel_id}`} className="hover:underline">← back to channel</Link>
      </p>
    </div>
  );
}
