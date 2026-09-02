import Link from 'next/link';
import { notFound } from 'next/navigation';
import { videoPage } from '@/lib/admin/queries';
import { n, compact, ago, etDateTime, ageDays } from '@/lib/admin/format';
import { Stat, Section, ChannelLink, TierBadge } from '@/components/admin/ui';
import { SnapshotChart } from '@/components/admin/snapshot-chart';
import { ThumbImg } from '@/components/admin/thumb-img';
import { thumbUrl } from '@/lib/thumbs/storage';
import { mergeActuals, expectedCurve, packagingMarkers } from '@/lib/admin/video-curve';

export const dynamic = 'force-dynamic';

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { video: v, snapshots, samples, thumbs, titles, score: sc, mult } = await videoPage(id);
  if (!v) notFound();

  const actuals = mergeActuals(v.published_at, snapshots, samples);
  const markers = packagingMarkers(v.published_at, thumbs, titles);
  const maxDay = Math.max(30, actuals.length ? actuals[actuals.length - 1].day : 0, ageDays(v.published_at) ?? 0);
  const curve = expectedCurve(sc?.baseline ?? null, mult, maxDay);
  const thumbUrls: Record<number, string> = {};
  for (const t of thumbs) thumbUrls[t.version] = thumbUrl(id, t.version) ?? `/api/admin/thumb/${id}/${t.version}`;
  const latest = thumbs.length ? thumbs[thumbs.length - 1].version : null;

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="w-full md:w-80 shrink-0">
          {latest != null ? (
            <ThumbImg src={thumbUrls[latest]} fallbackSrc={`/api/admin/thumb/${id}/${latest}`} alt={`v${latest}`} />
          ) : v.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.thumbnail_url} alt="current" className="aspect-video w-full rounded object-cover" />
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            <ChannelLink id={v.channel_id} name={v.channel_name} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">
            {v.title}{' '}
            <a href={`https://youtu.be/${id}`} target="_blank" rel="noreferrer" className="text-xs font-normal text-muted-foreground hover:underline">yt ↗</a>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {id} · published {etDateTime(v.published_at)} ET · {ageDays(v.published_at)}d old · {n(v.view_count)} views
            {v.format_type && <> · {v.format_type}</>}{v.topic_niche && <> · {v.topic_niche}</>}{v.is_short && <> · short</>}
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Score (model v3)"
          value={sc?.score != null ? sc.score.toFixed(1) + '×' : '–'}
          sub={sc ? `${sc.confidence} · at day ${Number(sc.day).toFixed(1)} · scored ${ago(sc.scored_at)}` : 'not scored (hourly job covers videos ≤60d)'}
        />
        <Stat
          label="Projected d30 vs baseline"
          value={sc ? `${compact(Math.round(sc.est30))} / ${sc.baseline != null ? compact(Math.round(sc.baseline)) : '–'}` : '–'}
          sub={sc ? `channel baseline from n=${sc.n_baseline} priors` : ''}
        />
        <Stat
          label="Same-age ratio"
          value={sc?.same_age_ratio != null ? sc.same_age_ratio.toFixed(1) + '×' : '–'}
          sub={sc ? `vs n=${sc.n_same_age} priors at this age` : ''}
        />
        <Stat
          label="Tracking"
          value={<TierBadge tier={v.priority_tier} />}
          sub={`${snapshots.length} snapshots · ${samples.length} samples · last ${v.last_tracked ? ago(v.last_tracked) : '–'}`}
        />
      </div>

      <Section
        title="Views since publish"
        right={curve.length ? 'dashed = expected from channel baseline · band = model error · amber = thumbnail, blue = title' : 'no baseline: expected curve unavailable'}
      >
        <div className="rounded-lg border border-border p-3">
          <SnapshotChart actuals={actuals} curve={curve} markers={markers} thumbUrls={thumbUrls} />
        </div>
      </Section>

      <Section title="Thumbnail versions" right={thumbs.length ? `${thumbs.length} archived` : 'not watched'}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {thumbs.map((t) => (
            <figure key={t.version} className="w-56 shrink-0">
              <ThumbImg src={thumbUrls[t.version]} fallbackSrc={`/api/admin/thumb/${id}/${t.version}`} alt={`v${t.version}`} />
              <figcaption className="mt-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">v{t.version}</span> · {etDateTime(t.first_seen)} ET
              </figcaption>
            </figure>
          ))}
          {!thumbs.length && v.thumbnail_url && (
            <figure className="w-56 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.thumbnail_url} alt="current" className="aspect-video w-full rounded object-cover" />
              <figcaption className="mt-1 text-[11px] text-muted-foreground">current (not archived)</figcaption>
            </figure>
          )}
        </div>
      </Section>

      <Section title="Title history" right={titles.length ? `${titles.length} recorded` : 'not watched'}>
        {titles.length ? (
          <ol className="space-y-1 text-sm">
            {titles.map((t) => (
              <li key={t.version} className="flex gap-3">
                <span className="w-40 shrink-0 text-[11px] text-muted-foreground">v{t.version} · {etDateTime(t.first_seen)} ET</span>
                <span>{t.title}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{v.title}</p>
        )}
      </Section>

      <p className="mt-8 text-xs text-muted-foreground">
        <Link href={`/admin/channels/${v.channel_id}`} className="hover:underline">← back to channel</Link>
      </p>
    </div>
  );
}
