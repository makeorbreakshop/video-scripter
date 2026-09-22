'use client';

// The /app/angles filter row, read left to right in the same falling order as Outliers:
//
//   WHERE   All / Near / Adjacent / Far — the axis the page exists for, so it leads as chips.
//   WHEN    30d / 90d / 365d — same shape, lower stakes, after a hairline.
//   WHICH + order — a single-choice Family menu and the sort, at the right edge.
//
// Everything is a URL parameter, so Postgres does the filtering and the ordering and a view is
// a link. No new control type and no new height: <Chips> and <Sort>, the two the system has.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Chips } from '@/components/app/chips';
import { Sort } from '@/components/app/menu';
import {
  anglesHref, angleHref, ANGLE_BUCKETS,
  type AngleBucket, type AngleRange, type AngleSort, type DetailSort,
} from '@/lib/app/angles-url';

const BUCKET_LABEL: Record<AngleBucket, string> = {
  all: 'All', near: 'Near', adjacent: 'Adjacent', far: 'Far',
};
const RANGES: Array<[AngleRange, string]> = [['30d', '30d'], ['90d', '90d'], ['365d', '365d']];
const BOARD_SORTS: Array<[AngleSort, string]> = [['median', 'Top median'], ['count', 'Most used']];
const DETAIL_SORTS: Array<[DetailSort, string]> = [['score', 'Top score'], ['published', 'Newest']];

const chipLink = (
  chip: { href?: string },
  props: { className: string; 'data-on'?: boolean; children: React.ReactNode }
) => (
  <Link href={chip.href!} className={props.className} data-on={props['data-on']}
        aria-current={props['data-on'] ? 'true' : undefined}>{props.children}</Link>
);

export function AngleBar({
  bucket, range, sort, family, anchor, families, counts, bucketsDisabled,
}: {
  bucket: AngleBucket;
  range: AngleRange;
  sort: AngleSort;
  family: string | null;
  anchor: string | null;
  /** Every family in the taxonomy, in taxonomy order, for the single-choice menu. */
  families: Array<{ id: string; label: string }>;
  /** Channels in each neighbourhood. Far has no count: it is the complement, not a list. */
  /**
   * Channels in each bucket, after the creator-likeness floor and the far-band cut. Far carries
   * a number now that it is a bounded band rather than "everything else".
   */
  counts: { near: number; adjacent: number; far: number } | null;
  bucketsDisabled: boolean;
}) {
  const router = useRouter();
  const href = (next: Partial<Parameters<typeof anglesHref>[0]>) =>
    anglesHref({ bucket, range, sort, family, anchor, ...next });

  return (
    <div className="cs-tabbar">
      {bucketsDisabled ? <span /> : (
        <>
          <Chips
            ariaLabel="Distance from your channel"
            value={bucket}
            items={ANGLE_BUCKETS.map((b) => ({
              key: b,
              label: BUCKET_LABEL[b],
              count: b === 'all' ? undefined : counts?.[b],
              href: href({ bucket: b }),
            }))}
            renderLink={chipLink}
          />
          <span className="cs-tabbar-sep" aria-hidden="true" />
        </>
      )}

      <Chips
        ariaLabel="Published within"
        value={range}
        items={RANGES.map(([key, label]) => ({ key, label, href: href({ range: key }) }))}
        renderLink={chipLink}
      />

      <div className="cs-controls">
        <Sort
          ariaLabel="Family"
          value={family ?? 'all'}
          options={[{ key: 'all', label: 'All families' }, ...families.map((f) => ({ key: f.id, label: f.label }))]}
          onChange={(key) => router.push(href({ family: key === 'all' ? null : key }))}
        />
        <Sort
          ariaLabel="Sort angles"
          value={sort}
          options={BOARD_SORTS.map(([key, label]) => ({ key, label }))}
          onChange={(key) => router.push(href({ sort: key as AngleSort }))}
        />
      </div>
    </div>
  );
}

/** The detail page's row: the same three buckets with their own counts, a range, and a sort. */
export function AngleDetailBar({
  id, bucket, range, sort, anchor, counts, bucketsDisabled,
}: {
  id: string;
  bucket: AngleBucket;
  range: AngleRange;
  sort: DetailSort;
  anchor: string | null;
  counts: { all: number; near: number; adjacent: number; far: number };
  bucketsDisabled: boolean;
}) {
  const router = useRouter();
  const href = (next: Partial<Parameters<typeof angleHref>[1]>) =>
    angleHref(id, { bucket, range, sort, anchor, ...next });

  return (
    <div className="cs-tabbar">
      {bucketsDisabled ? <span /> : (
        <>
          <Chips
            ariaLabel="Distance from your channel"
            value={bucket}
            items={ANGLE_BUCKETS.map((b) => ({
              key: b, label: BUCKET_LABEL[b], count: counts[b], href: href({ bucket: b }),
            }))}
            renderLink={chipLink}
          />
          <span className="cs-tabbar-sep" aria-hidden="true" />
        </>
      )}

      <Chips
        ariaLabel="Published within"
        value={range}
        items={RANGES.map(([key, label]) => ({ key, label, href: href({ range: key }) }))}
        renderLink={chipLink}
      />

      <div className="cs-controls">
        <Sort
          ariaLabel="Sort videos"
          value={sort}
          options={DETAIL_SORTS.map(([key, label]) => ({ key, label }))}
          onChange={(key) => router.push(href({ sort: key as DetailSort }))}
        />
      </div>
    </div>
  );
}
