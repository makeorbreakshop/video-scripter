// /app/videos/[id] — one video, two questions: how is it doing against normal for this
// channel, and did the packaging changes matter.
//
// The reads and the curve math come from lib/app/video-page.ts, which composes the admin
// videoPage() query and lib/admin/video-curve.ts rather than restating either. The page's own
// job is hierarchy: the ratio and the three numbers it is made of, the curve that justifies it,
// and then the packaging the video actually wore, numbered — the chips under the chart and the
// cards in the strip being the same events under the same numbers.
//
// What is NOT here any more: the verdict sentence ("typical 36K at 7d old · tentative 92K by
// day 30 · comparison used 74K views · settled"), which said in prose what the stat row says at
// a glance and repeated the view count above it; and the day-30 figure, which is the dashed
// line on the chart. A number beside a picture of the same thing is the fact twice.
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadVideoHead, headerLines, headerStats } from '@/lib/app/video-page';
import { cachedVideoPage } from '@/lib/app/cached';
import { VideoBodySkeleton } from '@/components/app/skeletons';
import { MarkerHoverProvider, VideoChart } from '@/components/app/video-chart';
import { PackagingStrip } from '@/components/app/packaging-strip';
import { Thumb, ThumbFallbackScript } from '@/components/app/thumb';
import { LocalTime } from '@/components/app/local-time';

export const dynamic = 'force-dynamic';

/**
 * The chart and the packaging. These need the whole snapshot/sample series, so they stream in
 * behind a Suspense boundary while the header — four small reads (loadVideoHead) — is already
 * on screen.
 */
async function VideoBody({ id, channelId }: { id: string; channelId: string }) {
  const v = await cachedVideoPage(id, channelId);
  if (!v) return null;
  return (
    <>
      <section className="cs-section" style={{ marginTop: 18 }}>
        {!v.broadcastNotice && <h2>Views since publish</h2>}
        <VideoChart
          actuals={v.actuals}
          publishedAt={v.chartOriginAt}
          curve={v.curve}
          series={v.series}
          marks={v.marks}
          events={v.packagingEvents ?? []}
          score={v.broadcastNotice ? null : v.score?.score ?? null}
          comparison={v.comparison}
        />
      </section>

      {/* One card is a history too: card 0 is the publish. A video that never changed its
          packaging has exactly that one card and no chips, which is the whole answer. */}
      <section className="cs-section">
        {(v.packagingCards?.length ?? 0) > 1
          ? <PackagingStrip cards={v.packagingCards} />
          : <><h2>Packaging</h2><p className="cs-sub">No changes since publish.</p></>}
      </section>
    </>
  );
}

export default async function AppVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await loadVideoHead(id);
  if (!v) notFound();

  const head = { ...v, id: v.id, publishedAt: v.publishedAt };
  const h = headerLines(head);
  const s = headerStats(head);

  return (
    <MarkerHoverProvider>
      <ThumbFallbackScript />

      <div className="vp-head">
        <div className="vp-th">
          <Thumb src={v.thumbUrl} alt="" loading="eager" fetchPriority="high"
                 style={{ width: '100%', borderRadius: 'var(--cs-radius)' }} />
        </div>

        <div className="vp-mid">
          <Link href={`/app/channels/${v.channelId}`} className="vp-chan">{v.channelName}</Link>
          <h1 className="cs-h1 vp-title">{v.title}</h1>

          {/* The verdict, as figures rather than a sentence: the multiple, then the three
              numbers it is made of. Labels in mono small caps so the row reads as a row. */}
          {(s.big || s.stats.length > 0) && (
            <div className="vp-stats">
              {s.big && (
                <span className="vp-stat" data-big="">
                  <span className="cs-num vp-big" data-over={s.over}>{s.big}</span>
                  <span className="cs-num vp-stat-label">VS TYPICAL</span>
                </span>
              )}
              {s.stats.map((st) => (
                <span key={st.key} className="vp-stat">
                  <span className="cs-num vp-stat-value">{st.value}</span>
                  <span className="cs-num vp-stat-label">{st.label}</span>
                </span>
              ))}
            </div>
          )}
          {h.verdict && !s.big && <p className="cs-sub" style={{ marginTop: 8 }}>{h.verdict}</p>}
        </div>

        <div className="vp-right">
          <span className="cs-num vp-when">
            {h.meta.timeLabel && <span title={h.meta.contextNote ?? undefined}>{h.meta.timeLabel} </span>}
            {/* The reader's own clock, written in the browser — the app is not an admin page. */}
            <LocalTime ms={h.meta.publishedMs} />
            {' · '}
            <a href={h.meta.youtubeUrl} target="_blank" rel="noreferrer" className="vp-yt">YouTube ↗</a>
          </span>
          {s.confidence && (
            <span className="vp-conf" data-settled={s.confidence === 'SETTLED' || undefined}>{s.confidence}</span>
          )}
        </div>
      </div>

      <Suspense fallback={<VideoBodySkeleton />}>
        <VideoBody id={v.id} channelId={v.channelId} />
      </Suspense>

    </MarkerHoverProvider>
  );
}
