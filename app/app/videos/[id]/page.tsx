// /app/videos/[id] — one video, two questions: how is it doing against normal for this
// channel, and did the packaging changes matter.
//
// The reads and the curve math come from lib/app/video-page.ts, which composes the admin
// videoPage() query and lib/admin/video-curve.ts rather than restating either. The page's own
// job is hierarchy: one ratio with a plain sentence, the curve that justifies it, then the
// thumbnails the video actually wore with what each swap did.
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadVideoHead, headerLines } from '@/lib/app/video-page';
import { cachedVideoPage } from '@/lib/app/cached';
import { VideoBodySkeleton } from '@/components/app/skeletons';
import { MarkerHoverProvider, VideoChart } from '@/components/app/video-chart';
import { PackagingTimeline } from '@/components/app/packaging-timeline';
import { isUnchangedOnly } from '@/lib/app/packaging-timeline';
import { Thumb, ThumbFallbackScript } from '@/components/app/thumb';
import { LocalTime } from '@/components/app/local-time';

export const dynamic = 'force-dynamic';

/**
 * The chart, the thumbnails the video wore and the title history. These need the whole
 * snapshot/sample series, so they stream in behind a Suspense boundary while the hero and
 * the verdict — four small reads (loadVideoHead) — are already on screen.
 */
async function VideoBody({ id, channelId }: { id: string; channelId: string }) {
  const v = await cachedVideoPage(id, channelId);
  if (!v) return null;
  return (
    <>
      <section className="cs-section" style={{ marginTop: 18 }}>
        {!v.broadcastNotice && <h2>Views since publish</h2>}
        {v.broadcastNotice && <p className="cs-sub">{v.timeLabel === 'Stream started' ? 'Views since stream start' : 'Recorded views · stream start unknown'}</p>}
        <VideoChart
          actuals={v.actuals}
          publishedAt={v.chartOriginAt}
          curve={v.curve}
          series={v.series}
          marks={v.marks}
          score={v.broadcastNotice ? null : v.score?.score ?? null}
          comparison={v.comparison}
        />
      </section>

      {/* One card is a history too: "no changes since publish". The gate was >1 because the
          no-change case used to build a PUBLISHED and an identical NOW. */}
      {v.timeline.length > 0 && (
        <section className="cs-section">
          {/* The heading stands alone: no subtitle, no explainer. */}
          <h2>Packaging history</h2>
          {isUnchangedOnly(v.timeline)
            /* Nothing moved, so there is no history to draw. A card frame around an empty
               thumbnail slot read as a broken image; the sentence is the whole answer. */
            ? <p className="cs-sub">No changes since publish.</p>
            : <PackagingTimeline clips={v.timeline} ticks={v.timelineTicks} />}
        </section>
      )}

      {v.titles.length > 1 && (
        <section className="cs-section">
          <h2>Title changes</h2>
          {/* v1's first_seen is when the watcher first saw the video, not when the title was
              written, so only the new version carries a meaningful time. */}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
            {v.titles.slice(1).map((t, i) => (
              <li key={t.version} style={{ fontSize: 13 }}>
                <div style={{ color: 'var(--cs-muted)', textDecoration: 'line-through' }}>{v.titles[i].title}</div>
                <div>{t.title}</div>
                {/* The reader's own clock, written in the browser — the app is not an admin
                    page (lib/app/local-time.ts). */}
                <div style={{ fontSize: 11, color: 'var(--cs-muted)', marginTop: 2 }}>
                  <LocalTime className="cs-num" ms={Date.parse(t.first_seen)} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

export default async function AppVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await loadVideoHead(id);
  if (!v) notFound();

  const h = headerLines({ ...v, id: v.id, publishedAt: v.publishedAt });

  return (
    <MarkerHoverProvider>
      <ThumbFallbackScript />
      <style>{`
        .vp-head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
        .vp-th { width: 200px; flex: none; }
        .vp-verdict { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin: 0; }
        /* Accent is the channel's own good news; a video under its channel's normal gets the
           ordinary ink, not a green that would contradict the sentence beside it. */
        .vp-big { font-family: var(--font-mono), monospace; font-size: 44px; font-weight: 700;
                  line-height: 1; letter-spacing: -0.02em; color: var(--cs-ink); }
        .vp-big[data-over="true"] { color: var(--cs-accent); }
        .vp-said { font-size: 14px; color: var(--cs-muted); max-width: 60ch; }
        @media (max-width: 719px) {
          .vp-head { flex-direction: column; gap: 12px; }
          .vp-th { width: 100%; max-width: 320px; }
          .vp-big { font-size: 32px; }
        }
      `}</style>

      <div className="vp-head">
        <div className="vp-th">
          <Thumb src={v.thumbUrl} alt="" loading="eager" fetchPriority="high" style={{ width: '100%', borderRadius: 'var(--cs-radius)' }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <Link href={`/app/channels/${v.channelId}`} style={{ color: 'var(--cs-accent)', fontSize: 12, fontWeight: 600 }}>
            {v.channelName}
          </Link>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>{v.title}</h1>
          {/* ONE metadata line: the channel, when it went out, how old it is, the exact count,
              and the link. The verdict below never repeats any of it. */}
          <p className="cs-sub">
            {h.meta.timeLabel && <>{h.meta.timeLabel} · </>}<LocalTime className="cs-num" ms={h.meta.publishedMs} /> · {h.meta.age} ·{' '}
            <span className="cs-num">{h.meta.views}</span> views ·{' '}
            <a href={h.meta.youtubeUrl} target="_blank" rel="noreferrer"
               style={{ color: 'var(--cs-muted)', textDecoration: 'underline' }}>YouTube ↗</a>
          </p>
        </div>
      </div>

      <p className="vp-verdict">
        {h.big && <span className="vp-big" data-over={h.over}>{h.big}</span>}
        <span className="vp-said">{h.verdict}</span>
      </p>

      <Suspense fallback={<VideoBodySkeleton />}>
        <VideoBody id={v.id} channelId={v.channelId} />
      </Suspense>

    </MarkerHoverProvider>
  );
}
