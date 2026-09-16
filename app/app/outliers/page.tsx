// /app/outliers — the guarded outlier pool as a thumbnail grid, filtered by how close the
// source channel sits to the owner's own channel.
//
// Owner-only, like /app/audience: the neighbourhood comes from a Qdrant collection that only
// runs on Brandon's machine, and the anchor is his connected YouTube channel.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { isOwner } from '@/lib/app/flags';
import { listConnections } from '@/lib/app/youtube-connect';
import { VideoGridStyles } from '@/components/app/video-grid';
import { VideoTile } from '@/components/app/video-tile';
import {
  bucketIds, cachedRelations, outlierPage, outlierCount, parseAnchor, parseBucket,
  parseOutlierRange, parseOutlierSort, parseRows, parseMin, parseConfidence, parseFloor,
  outliersHref, OUTLIER_MAX_ROWS, OUTLIER_PAGE,
} from '@/lib/app/outliers';
import { OutlierBar } from '@/app/app/_components/outlier-controls';

export const dynamic = 'force-dynamic';

const EAGER_TILES = 6;

export default async function OutliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');
  if (!isOwner(user)) redirect('/app/feed');

  const params = await searchParams;
  const bucket = parseBucket(params.bucket);
  const sort = parseOutlierSort(params.sort);
  const range = parseOutlierRange(params.range);
  const askedAnchor = parseAnchor(params.anchor);
  const rows = parseRows(params.n);
  const guards = { min: parseMin(params.min), conf: parseConfidence(params.conf), floor: parseFloor(params.floor) };

  const connections = askedAnchor ? [] : await listConnections(user.id);
  const anchor = askedAnchor ?? connections[0]?.channel_id ?? null;
  const relations = anchor ? await cachedRelations(anchor) : null;

  // No anchor, or an anchor with no identity vector: the buckets cannot be drawn, so the page
  // shows the whole guarded pool and says only that much.
  const selection = relations
    ? bucketIds(relations, bucket)
    : { ids: [] as string[], mode: 'exclude' as const };

  const [page, total] = await Promise.all([
    outlierPage({ ...selection, sort, range, guards, limit: rows }),
    outlierCount({ ...selection, range, guards }),
  ]);

  return (
    <>
      <VideoGridStyles />
      <div className="cs-page-head">
        <div><h1 className="cs-h1">Outliers</h1></div>
        <span className="cs-num cs-showing">{total.n}{total.capped ? '+' : ''}</span>
      </div>

      <OutlierBar
        bucket={bucket} sort={sort} range={range} anchor={askedAnchor}
        min={guards.min} conf={guards.conf} floor={guards.floor}
        bucketsDisabled={!relations}
        counts={relations ? { near: relations.near.length, adjacent: relations.adjacent.length } : null}
      />

      {!relations && <p className="vg-meta" style={{ marginTop: 18 }}>No neighbourhood for this channel.</p>}

      {page.videos.length === 0
        ? <p className="vg-meta" style={{ marginTop: 18 }}>Nothing in this range.</p>
        : (
          <ul className="vg-grid">
            {page.videos.map((v, i) => (
              <VideoTile key={v.id} v={v} priority={i < EAGER_TILES}
                         source={{ channelId: v.channel_id, channelName: v.channel_name }} />
            ))}
          </ul>
        )}

      {page.hasMore && rows < OUTLIER_MAX_ROWS && (
        <div className="cs-center" style={{ marginTop: 24 }}>
          <Link className="cs-btn"
                href={outliersHref({ bucket, sort, range, anchor: askedAnchor, ...guards,
                                     n: Math.min(rows + OUTLIER_PAGE, OUTLIER_MAX_ROWS) })}>
            More
          </Link>
        </div>
      )}
    </>
  );
}
