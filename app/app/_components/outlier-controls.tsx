'use client';

// The Outliers control row. Filtering and ordering are different questions, so they sit on
// different sides of the line: everything that decides WHICH videos are in the set is grouped at
// the left, and the one control that decides what ORDER they come back in stands alone at the
// right edge, with the word "Sort" in its trigger so it can never be read as another filter.
//
// Left, in falling importance:
//   WHERE       Near / Adjacent / Far — the one axis this page exists for, so it leads the line
//               as chips, the loudest control the system has.
//   WHEN        7d / 30d / 90d — same shape, lower stakes, so it sits after a hairline rather
//               than in a second row: same treatment, different group.
//   HOW STRICT  the three quality guards, folded into one plate. They default sensibly and are
//               usually left alone, so the trigger reads out its own values (2x · Confirmed,
//               Likely · 500+) and carries a badge when any is off the default. Nothing is
//               hidden, only folded.
//
// Right:
//   ORDER       Top score / Most views / Newest, one exclusive <Sort> menu. `margin-left: auto`
//               holds it against the right edge, and when the row wraps it takes a line of its
//               own and stays right-aligned — still visibly apart from the filters.
//
// Everything is a URL parameter, so Postgres does the filtering, the ORDER BY and the LIMIT and
// a view is a link.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Chips } from '@/components/app/chips';
import { Menu, Sort, type MenuItem } from '@/components/app/menu';
import {
  outliersHref, CONFIDENCES, MIN_MULTIPLES, FLOORS, floorLabel, DEFAULT_MIN, DEFAULT_CONF,
  DEFAULT_FLOOR, type Bucket, type OutlierSort, type OutlierRange, type Confidence,
  type MinMultiple, type Floor,
} from '@/lib/app/outliers-url';

// The order the menu reads, and the only place these labels are written. `views` is newer than
// the other two; `score` and `published` keep their URL values so old links still resolve.
const SORTS: Array<[OutlierSort, string]> = [
  ['score', 'Top score'], ['views', 'Most views'], ['published', 'Newest'],
];
const RANGES: Array<[OutlierRange, string]> = [['7d', '7d'], ['30d', '30d'], ['90d', '90d']];
const CONF_LABEL: Record<Confidence, string> = {
  confirmed: 'Confirmed', likely: 'Likely', early: 'Early',
};

const chipLink = (
  chip: { href?: string },
  props: { className: string; 'data-on'?: boolean; children: React.ReactNode }
) => (
  <Link href={chip.href!} className={props.className} data-on={props['data-on']}
        aria-current={props['data-on'] ? 'true' : undefined}>{props.children}</Link>
);

const sameConf = (a: Confidence[], b: Confidence[]) =>
  a.length === b.length && a.every((c, i) => c === b[i]);

export function OutlierBar({
  bucket, sort, range, anchor, counts, bucketsDisabled, min, conf, floor,
}: {
  bucket: Bucket;
  sort: OutlierSort;
  range: OutlierRange;
  anchor: string | null;
  /** Channels in each neighbourhood. Far has no count: it is the complement, not a list. */
  counts: { near: number; adjacent: number } | null;
  bucketsDisabled: boolean;
  min: MinMultiple;
  conf: Confidence[];
  floor: Floor;
}) {
  const router = useRouter();
  const href = (next: Partial<Parameters<typeof outliersHref>[0]>) =>
    outliersHref({ bucket, sort, range, anchor, min, conf, floor, ...next });

  const offDefault =
    (min !== DEFAULT_MIN ? 1 : 0) +
    (sameConf(conf, DEFAULT_CONF) ? 0 : 1) +
    (floor !== DEFAULT_FLOOR ? 1 : 0);

  // One plate, three value groups. Min and floor pick one; confidence takes any non-empty set,
  // and un-ticking the last one would mean "no rows", so it holds instead of emptying.
  const onGuard = (key: string) => {
    const [group, raw] = key.split(':');
    if (group === 'min') return router.push(href({ min: Number(raw) as MinMultiple }));
    if (group === 'floor') return router.push(href({ floor: Number(raw) as Floor }));
    const c = raw as Confidence;
    const next = conf.includes(c) ? conf.filter((x) => x !== c) : CONFIDENCES.filter((x) => x === c || conf.includes(x));
    if (next.length === 0) return;
    return router.push(href({ conf: next }));
  };

  const guardItems: MenuItem[] = [
    ...MIN_MULTIPLES.map((m, i) => ({
      key: `min:${m}`, label: `${m}×`, state: (m === min ? 'on' : 'off') as MenuItem['state'],
      ...(i === 0 ? { section: 'Minimum' } : {}),
    })),
    ...CONFIDENCES.map((c, i) => ({
      key: `conf:${c}`, label: CONF_LABEL[c], state: (conf.includes(c) ? 'on' : 'off') as MenuItem['state'],
      ...(i === 0 ? { section: 'Confidence' } : {}),
    })),
    ...FLOORS.map((f, i) => ({
      key: `floor:${f}`, label: floorLabel(f), state: (f === floor ? 'on' : 'off') as MenuItem['state'],
      ...(i === 0 ? { section: 'Baseline' } : {}),
    })),
  ];

  return (
    <div className="cs-tabbar">
      {bucketsDisabled ? <span /> : (
        <>
          <Chips
            ariaLabel="Distance from your channel"
            value={bucket}
            items={[
              { key: 'near', label: 'Near', count: counts?.near },
              { key: 'adjacent', label: 'Adjacent', count: counts?.adjacent },
              { key: 'far', label: 'Far' },
            ].map((c) => ({ ...c, href: href({ bucket: c.key as Bucket }) }))}
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

      <Menu
        mode="filters"
        ariaLabel="Quality guards"
        items={guardItems}
        onToggle={onGuard}
        label={
          <span className="cs-menu-trigger-label">
            {offDefault > 0 && <span className="cs-trigger-badge cs-num">{offDefault}</span>}
            {`${min}× · ${conf.map((c) => CONF_LABEL[c]).join(', ')} · ${
              floor === 0 ? 'Any' : `${floorLabel(floor)}+`}`}
          </span>
        }
      />

      <div className="cs-controls cs-controls-sort">
        <Sort
          ariaLabel="Sort outliers"
          prefix="Sort ·"
          value={sort}
          options={SORTS.map(([key, label]) => ({ key, label }))}
          onChange={(key) => router.push(href({ sort: key as OutlierSort }))}
        />
      </div>
    </div>
  );
}
