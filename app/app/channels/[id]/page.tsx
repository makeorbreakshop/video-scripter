// /app/channels/[id] — one channel: what it publishes and how those videos performed.
//
// Sorting and paging are URL parameters so Postgres does the ORDER BY and the LIMIT
// (lib/app/channel-page.ts); nothing sorts a full catalogue in the browser.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { channelHeader, channelVideos, isTracked, parseSort, GRID_PAGE } from '@/lib/app/channel-page';
import { compact, etDate, n } from '@/lib/admin/format';
import { VideoGrid, VideoGridStyles, SortTabs, LoadMore } from '@/components/app/video-grid';
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
  const asked = parseInt(Array.isArray(sp.n) ? sp.n[0] ?? '' : sp.n ?? '', 10);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(asked, GRID_PAGE), MAX_ROWS) : GRID_PAGE;

  const [header, page, tracked] = await Promise.all([
    channelHeader(id),
    channelVideos(id, sort, limit, 0),
    isTracked(user.id, id),
  ]);
  if (!header) notFound();

  return (
    <>
      <VideoGridStyles />
      <style>{`
        .ch-head { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; margin-bottom: 14px; }
        .ch-stats { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; margin-bottom: 22px; }
        .ch-stat { border: 1px solid var(--cs-line); border-radius: var(--cs-radius);
                   background: var(--cs-surface); padding: 12px; }
        .ch-stat-v { font-family: var(--font-mono), monospace; font-variant-numeric: tabular-nums;
                     font-size: 18px; font-weight: 600; margin-top: 4px; }
        .ch-bar { display: flex; align-items: center; justify-content: space-between;
                  gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
        @media (min-width: 720px) { .ch-stats { grid-template-columns: repeat(4, minmax(0,1fr)); } }
      `}</style>

      <div className="ch-head">
        <div style={{ minWidth: 0 }}>
          <div className="cs-hiscore">channel</div>
          <h1 className="cs-h1">{header.name}</h1>
          <p className="cs-sub">
            tracked since <span className="cs-num">{header.trackedSince ? etDate(header.trackedSince) : '–'}</span>
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <TrackButton channelId={header.channelId} tracked={tracked} />
        </div>
      </div>

      <div className="ch-stats">
        <div className="ch-stat">
          <div className="cs-stat-l">Videos</div>
          <div className="ch-stat-v">{n(header.videoCount)}</div>
        </div>
        <div className="ch-stat">
          <div className="cs-stat-l">Baseline</div>
          <div className="ch-stat-v">{header.baseline != null ? compact(Math.round(header.baseline)) : '–'}</div>
          <div style={{ fontSize: 11, color: 'var(--cs-muted)', marginTop: 3 }}>median day-30 views</div>
        </div>
        <div className="ch-stat">
          <div className="cs-stat-l">Beat 2×</div>
          <div className="ch-stat-v" style={{ color: header.overShare && header.overShare >= 0.2 ? 'var(--cs-good)' : undefined }}>
            {header.overShare != null ? `${Math.round(header.overShare * 100)}%` : '–'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--cs-muted)', marginTop: 3 }}>
            {header.overCount} of {header.scoredCount} scored
          </div>
        </div>
        <div className="ch-stat">
          <div className="cs-stat-l">Showing</div>
          <div className="ch-stat-v">{page.videos.length}</div>
          <div style={{ fontSize: 11, color: 'var(--cs-muted)', marginTop: 3 }}>sorted by {sort}</div>
        </div>
      </div>

      <div className="ch-bar">
        <SortTabs channelId={header.channelId} sort={sort} n={limit} />
      </div>

      <VideoGrid videos={page.videos} />
      {page.hasMore && limit < MAX_ROWS && <LoadMore channelId={header.channelId} sort={sort} n={limit} />}

      <p style={{ fontSize: 12, marginTop: 24 }}>
        <Link href="/app/channels" style={{ color: 'var(--cs-muted)' }}>← all channels</Link>
      </p>
    </>
  );
}
