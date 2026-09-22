// /app/angles/[id] — one angle, and every video in the pool that carries it.
//
// The board shows eight examples chosen for spread; this page drops the dedupe and shows the
// lot, paged the way Outliers pages: a link that asks for more rows, so the LIMIT stays in
// Postgres and a deep view is still a URL.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { isOwner } from '@/lib/app/flags';
import { listConnections } from '@/lib/app/youtube-connect';
import { VideoGridStyles } from '@/components/app/video-grid';
import { VideoTile } from '@/components/app/video-tile';
import { AngleDetailBar } from '@/app/app/_components/angle-controls';
import {
  angleDetail, angleHref, anglesHref, isAngleId, parseAngleBucket, parseAngleRange,
  parseDetailSort, parseAnchor, parseAngleRows, ANGLE_PAGE, ANGLE_MAX_ROWS,
  DEFAULT_SORT, type AngleExample,
} from '@/lib/app/angles';

export const dynamic = 'force-dynamic';

const EAGER_TILES = 6;

/** The detail page's examples reach <VideoTile>, which speaks the channel grid's row shape. */
const toGridVideo = (v: AngleExample) => ({
  id: v.id,
  title: v.title,
  published_at: v.published_at,
  view_count: v.view_count,
  score: v.score,
  confidence: null,
  swaps: 0,
  last_change: null,
  thumb_latest: null,
  thumb_prev: null,
  title_latest: null,
  title_prev: null,
  thumbUrl: v.thumbnail_url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
  prevThumbUrl: null,
});

export default async function AngleDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');
  if (!isOwner(user)) redirect('/app/feed');

  const { id } = await params;
  if (!isAngleId(id)) notFound();

  const sp = await searchParams;
  const bucket = parseAngleBucket(sp.bucket);
  const range = parseAngleRange(sp.range);
  const sort = parseDetailSort(sp.sort);
  const askedAnchor = parseAnchor(sp.anchor);
  const rows = parseAngleRows(sp.n);

  const connections = askedAnchor ? [] : await listConnections(user.id);
  const anchor = askedAnchor ?? connections[0]?.channel_id ?? null;

  const detail = await angleDetail(id, anchor, { range, bucket, sort, limit: rows });
  if (!detail.angle) notFound();

  return (
    <>
      <VideoGridStyles />

      <div className="cs-page-head">
        <div>
          <p className="vg-meta" style={{ margin: 0 }}>
            <Link href={anglesHref({ bucket, range, sort: DEFAULT_SORT, family: detail.angle.family_id, anchor: askedAnchor })}>
              {detail.angle.family_label}
            </Link>
          </p>
          <h1 className="cs-h1" title={detail.angle.definition}>{detail.angle.label}</h1>
        </div>
        <span className="cs-num cs-showing">{detail.counts.all}</span>
      </div>

      <AngleDetailBar
        id={id} bucket={bucket} range={range} sort={sort} anchor={askedAnchor}
        counts={detail.counts}
        bucketsDisabled={anchor === null}
      />

      {detail.videos.length === 0
        ? <p className="vg-meta" style={{ marginTop: 18 }}>Nothing in this range.</p>
        : (
          <ul className="vg-grid">
            {detail.videos.map((v, i) => (
              <VideoTile key={v.id} v={toGridVideo(v)} priority={i < EAGER_TILES}
                         source={{ channelId: v.channel_id, channelName: `${v.channel_name} · ${v.bucket}` }} />
            ))}
          </ul>
        )}

      {detail.hasMore && rows < ANGLE_MAX_ROWS && (
        <div className="cs-center" style={{ marginTop: 24 }}>
          <Link className="cs-btn"
                href={angleHref(id, { bucket, range, sort, anchor: askedAnchor,
                                      n: Math.min(rows + ANGLE_PAGE, ANGLE_MAX_ROWS) })}>
            More
          </Link>
        </div>
      )}
    </>
  );
}
