// /app/channels/[id] — one channel: what it publishes and how those videos performed.
//
// Sorting and paging are URL parameters so Postgres does the ORDER BY and the LIMIT
// (lib/app/channel-page.ts); nothing sorts a full catalogue in the browser.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { channelHeader, channelVideos, channelVideoCount, isTracked, parseSort, parseRange, GRID_PAGE } from '@/lib/app/channel-page';
import { compact, n } from '@/lib/admin/format';
import { ChannelAvatar } from '@/components/app/avatar';
import { VideoGrid, VideoGridStyles, FilterBar, LoadMore } from '@/components/app/video-grid';
import { TrackButton } from '@/components/app/track-button';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 480;

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

  const [header, page, tracked, total] = await Promise.all([
    channelHeader(id),
    channelVideos(id, sort, limit, 0, range),
    isTracked(user.id, id),
    channelVideoCount(id, range),
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

      <FilterBar channelId={header.channelId} sort={sort} range={range} showing={page.videos.length} total={total} />

      <VideoGrid videos={page.videos} />
      {page.hasMore && limit < MAX_ROWS && <LoadMore channelId={header.channelId} sort={sort} n={limit} range={range} />}

      <p style={{ fontSize: 12, marginTop: 24 }}>
        <Link href="/app/channels" style={{ color: 'var(--cs-muted)' }}>← all channels</Link>
      </p>
    </>
  );
}
