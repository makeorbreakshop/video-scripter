// /app/angles — the packaging angle board: which framings are winning, near the owner's channel
// and beyond it, with the videos that prove it.
//
// Owner-only, like /app/outliers and /app/audience: the neighbourhood comes from a Qdrant
// collection that only runs on Brandon's machine, and the anchor is his connected channel.
import { redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { isOwner } from '@/lib/app/flags';
import { listConnections } from '@/lib/app/youtube-connect';
import { ThumbFallbackScript } from '@/components/app/thumb';
import { AngleBar } from '@/app/app/_components/angle-controls';
import {
  angleBoard, angleTaxonomy, sortAngles, parseAngleBucket, parseAngleRange, parseAngleSort,
  parseFamily, parseAnchor, DEFAULT_DETAIL_SORT,
} from '@/lib/app/angles';
import { AngleStyles, AngleBlock, UnusedNear } from './angles';

export const dynamic = 'force-dynamic';

export default async function AnglesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');
  if (!isOwner(user)) redirect('/app/feed');

  const params = await searchParams;
  const bucket = parseAngleBucket(params.bucket);
  const range = parseAngleRange(params.range);
  const sort = parseAngleSort(params.sort);
  const family = parseFamily(params.family);
  const askedAnchor = parseAnchor(params.anchor);

  const connections = askedAnchor ? [] : await listConnections(user.id);
  const anchor = askedAnchor ?? connections[0]?.channel_id ?? null;

  const [board, taxonomy] = await Promise.all([
    angleBoard(anchor, { range, bucket, family }),
    angleTaxonomy(),
  ]);

  // The family menu lists the whole taxonomy in taxonomy order, not only the families that have
  // rows in this range — a family with nothing in it is an answer too.
  const families = [...new Map(
    [...taxonomy.values()]
      .sort((a, b) => a.family_position - b.family_position)
      .map((t) => [t.family_id, { id: t.family_id, label: t.family_label }])
  ).values()];

  const detail = { bucket, range, sort: DEFAULT_DETAIL_SORT, anchor: askedAnchor };
  const relations = board.relations;

  return (
    <>
      <ThumbFallbackScript />
      <AngleStyles />

      <div className="cs-page-head">
        <div><h1 className="cs-h1">Angles</h1></div>
        <span className="cs-num cs-showing">{board.tagged}</span>
      </div>

      <AngleBar
        bucket={bucket} range={range} sort={sort} family={family} anchor={askedAnchor}
        families={families}
        bucketsDisabled={!relations}
        counts={relations ? board.band : null}
      />

      {!relations && <p className="vg-meta" style={{ marginTop: 18 }}>No neighbourhood for this channel.</p>}

      <div style={{ marginTop: 18 }}>
        {bucket === 'all' && <UnusedNear angles={board.unusedNear} detail={detail} />}

        {board.families.length === 0
          ? <p className="vg-meta">Nothing tagged in this range.</p>
          : board.families.map((section) => (
            <section key={section.family_id} className="cs-section">
              <h2 className="ang-fam">{section.family_label}</h2>
              {sortAngles(section.angles, sort).map((a) => (
                <AngleBlock key={a.angle_id} angle={a} detail={detail} />
              ))}
            </section>
          ))}
      </div>
    </>
  );
}
