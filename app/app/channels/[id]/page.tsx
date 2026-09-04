// /app/channels/[id] — one channel: what it publishes, and how its packaging has moved.
//
// Three tabs, all URL state (`tab`, plus `sort` / `kind` / `range`), so Postgres does the
// ORDER BY and the LIMIT (lib/app/channel-page.ts, lib/app/packaging-rows.ts) and nothing
// sorts a full catalogue in the browser.
//
// The page paints in two parts. The header is one small aggregate and the track state, so it
// is awaited inline; the tab body streams into a <Suspense> boundary whose fallback is the
// same GridSkeleton the route's loading.tsx uses, so the layout does not move.
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { isTracked, parseSort, parseRange, GRID_PAGE, type SortKey, type RangeKey } from '@/lib/app/channel-page';
import { changedVideoCount, changedVideos, parseChangeKind, type ChangeKind } from '@/lib/app/packaging-rows';
import { buildTestRow } from '@/lib/app/test-row';
import { cachedChannelHeader, cachedChannelVideos, cachedChannelVideoCount, cachedChannelBaseline } from '@/lib/app/cached';
import { hasBaselineLine } from '@/lib/app/channel-analytics';
import { ChannelBaselineChart } from '@/components/app/channel-baseline-chart';
import { compact, n } from '@/lib/admin/format';
import { ChannelAvatar } from '@/components/app/avatar';
import { VideoGrid, VideoGridStyles, LoadMore } from '@/components/app/video-grid';
import { ChannelBar } from '@/components/app/channel-controls';
import { TestRowList } from '@/components/app/test-row';
import { GridSkeleton } from '@/components/app/skeletons';
import { TrackButton } from '@/components/app/track-button';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 480;
const CHANGES_PAGE = 20;

async function VideosTab({ channelId, sort, range, limit }: {
  channelId: string; sort: SortKey; range: RangeKey; limit: number;
}) {
  const [page, total, changeCount] = await Promise.all([
    cachedChannelVideos(channelId, sort, limit, 0, range),
    cachedChannelVideoCount(channelId, range),
    changedVideoCount(channelId, range),
  ]);
  return (
    <>
      <ChannelBar channelId={channelId} tab="videos" videoCount={total} changeCount={changeCount}
                  sort={sort} range={range} kind="all" showing={page.videos.length} total={total} />
      <VideoGrid videos={page.videos} />
      {page.hasMore && limit < MAX_ROWS && <LoadMore channelId={channelId} sort={sort} n={limit} range={range} />}
    </>
  );
}

async function ChangesTab({ channelId, kind, range, avatarUrl }: {
  channelId: string; kind: ChangeKind; range: RangeKey; avatarUrl: string | null;
}) {
  const [{ videos, total }, videoCount] = await Promise.all([
    changedVideos(channelId, kind, range, CHANGES_PAGE),
    cachedChannelVideoCount(channelId, range),
  ]);
  // One TestRow per video: an A → B → A rotation is one experiment, not three rows.
  const rows = videos
    .map((v) => buildTestRow({
      videoId: v.id, title: v.title, channelId: v.channelId, channelName: v.channelName,
      publishedAt: v.publishedAt, views: v.views, score: v.score, thumbs: v.thumbs,
    }))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const avatars = avatarUrl ? { [channelId]: avatarUrl } : {};
  return (
    <>
      <ChannelBar channelId={channelId} tab="changes" videoCount={videoCount} changeCount={total}
                  sort="published" range={range} kind={kind} showing={rows.length} total={total} />
      <TestRowList rows={rows} avatars={avatars}
                   empty={<p className="vg-meta" style={{ marginTop: 18 }}>No packaging changes in this range.</p>} />
    </>
  );
}

async function AnalyticsTab({ channelId, range }: { channelId: string; range: RangeKey }) {
  const [points, videoCount, changeCount] = await Promise.all([
    cachedChannelBaseline(channelId, range),
    cachedChannelVideoCount(channelId, range),
    changedVideoCount(channelId, range),
  ]);
  return (
    <>
      <ChannelBar channelId={channelId} tab="analytics" videoCount={videoCount} changeCount={changeCount}
                  sort="published" range={range} kind="all" showing={points.length} total={points.length} />
      {hasBaselineLine(points)
        ? <ChannelBaselineChart points={points} />
        : <p className="vg-meta" style={{ marginTop: 18 }}>No baseline in this range.</p>}
    </>
  );
}

export default async function AppChannelPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');

  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = rawTab === 'changes' ? 'changes' : rawTab === 'analytics' ? 'analytics' : 'videos';
  const sort = parseSort(sp.sort);
  // Analytics opens on the last twelve months. All-time is one dropdown away, but a decade of
  // uploads squeezed into 900px is a smear, and the question this tab answers is "where is the
  // channel's normal NOW".
  const range = tab === 'analytics' && sp.range == null ? '1y' : parseRange(sp.range);
  const kind = parseChangeKind(sp.kind);
  const asked = parseInt(Array.isArray(sp.n) ? sp.n[0] ?? '' : sp.n ?? '', 10);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, GRID_PAGE), MAX_ROWS) : GRID_PAGE;

  const [header, tracked] = await Promise.all([
    cachedChannelHeader(id),
    isTracked(user.id, id),
  ]);
  if (!header) notFound();

  return (
    <>
      <VideoGridStyles />
      <style>{`
        .ch-head { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-bottom: 14px; }
      `}</style>

      <div className="ch-head">
        <ChannelAvatar src={header.avatarUrl} name={header.name} size={56} channelId={header.channelId} />
        <div style={{ minWidth: 0 }}>
          <h1 className="cs-h1">{header.name}</h1>
          <p className="cs-sub">
            {header.subscriberCount != null && (
              <><span className="cs-num">{compact(header.subscriberCount)}</span> subscribers · </>
            )}
            <span className="cs-num">{n(header.videoCount)}</span> videos
            {header.baseline != null && <> · baseline <span className="cs-num">{compact(Math.round(header.baseline))}</span> views at day 30</>}
            {header.overCount ? <> · <span className="cs-num">{header.overCount}</span> beat 2×</> : null}
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <TrackButton channelId={header.channelId} tracked={tracked} />
        </div>
      </div>

      <Suspense key={`${tab}:${sort}:${kind}:${range}:${limit}`} fallback={<GridSkeleton />}>
        {tab === 'changes'
          ? <ChangesTab channelId={header.channelId} kind={kind} range={range} avatarUrl={header.avatarUrl} />
          : tab === 'analytics'
            ? <AnalyticsTab channelId={header.channelId} range={range} />
            : <VideosTab channelId={header.channelId} sort={sort} range={range} limit={limit} />}
      </Suspense>

      <p style={{ fontSize: 12, marginTop: 24 }}>
        <Link href="/app/channels" style={{ color: 'var(--cs-muted)' }}>← all channels</Link>
      </p>
    </>
  );
}
