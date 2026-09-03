// /app/channels/[id] — one channel: what it publishes and how those videos performed.
//
// Sorting and paging are URL parameters so Postgres does the ORDER BY and the LIMIT
// (lib/app/channel-page.ts); nothing sorts a full catalogue in the browser.
//
// The page paints in two parts. The header is one small aggregate and the track state, so it
// is awaited inline; the grid — a page of videos plus the range count — streams into a
// <Suspense> boundary whose fallback is the same GridSkeleton the route's loading.tsx uses,
// so the layout does not move when the real grid lands.
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { isTracked, parseSort, parseRange, GRID_PAGE, type SortKey, type RangeKey } from '@/lib/app/channel-page';
import { cachedChannelHeader, cachedChannelVideos, cachedChannelVideoCount } from '@/lib/app/cached';
import { compact, n } from '@/lib/admin/format';
import { ChannelAvatar } from '@/components/app/avatar';
import { VideoGrid, VideoGridStyles, FilterBar, LoadMore } from '@/components/app/video-grid';
import { GridSkeleton } from '@/components/app/skeletons';
import { TrackButton } from '@/components/app/track-button';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 480;

async function ChannelGrid({ channelId, sort, range, limit }: { channelId: string; sort: SortKey; range: RangeKey; limit: number }) {
  const [page, total] = await Promise.all([
    cachedChannelVideos(channelId, sort, limit, 0, range),
    cachedChannelVideoCount(channelId, range),
  ]);
  return (
    <>
      <FilterBar channelId={channelId} sort={sort} range={range} showing={page.videos.length} total={total} />
      <VideoGrid videos={page.videos} />
      {page.hasMore && limit < MAX_ROWS && <LoadMore channelId={channelId} sort={sort} n={limit} range={range} />}
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

  const sort = parseSort(sp.sort);
  const range = parseRange(sp.range);
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

      <Suspense key={`${sort}:${range}:${limit}`} fallback={<GridSkeleton />}>
        <ChannelGrid channelId={header.channelId} sort={sort} range={range} limit={limit} />
      </Suspense>

      <p style={{ fontSize: 12, marginTop: 24 }}>
        <Link href="/app/channels" style={{ color: 'var(--cs-muted)' }}>← all channels</Link>
      </p>
    </>
  );
}
