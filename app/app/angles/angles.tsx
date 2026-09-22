// The board's own CSS and its two repeated pieces: an angle block, and the strip of angles that
// are winning next door and have never been tried here.
//
// Server components. Everything here is markup and formatters; the filtering happens in Postgres
// and arrives as props.
import Link from 'next/link';
import { Thumb } from '@/components/app/thumb';
import { ScoreChip } from '@/components/app/video-tile';
import { angleHref, type AngleBucket, type AngleExample, type AngleRange, type AngleStat, type DetailSort }
  from '@/lib/app/angles-url';

/**
 * A row of eight small examples, not a grid of tiles: the board is read down the page as a list
 * of framings, and each framing's evidence is a glance sideways. 160x90 is the smallest thumb
 * where a face and a big word are still legible. Narrow viewports scroll the row rather than
 * wrapping it, the same rule <Chips> follows.
 */
export function AngleStyles() {
  return (
    <style>{`
      .ang-fam { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.07em;
                 text-transform: uppercase; color: var(--cs-muted); }
      .ang-block { padding: 14px 0; border-top: 1px solid var(--cs-line); }
      .ang-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
      .ang-label { font-size: 14px; font-weight: 650; margin: 0; }
      .ang-stats { margin-top: 4px; font-size: 11px; color: var(--cs-muted); }
      .ang-row { display: flex; gap: 10px; margin-top: 10px; padding-bottom: 4px;
                 overflow-x: auto; scrollbar-width: thin; }
      .ang-ex { flex: 0 0 160px; min-width: 0; text-decoration: none; }
      .ang-ex img { border-radius: var(--cs-radius); }
      .ang-ex-title { font-size: 11px; font-weight: 550; line-height: 1.3; margin: 6px 0 0;
                      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                      overflow: hidden; }
      .ang-ex:hover .ang-ex-title { color: var(--cs-accent); }
      .ang-ex-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px;
                     margin-top: 4px; font-size: 10px; color: var(--cs-muted); }
      .ang-unused { display: flex; gap: 8px; flex-wrap: wrap; }
    `}</style>
  );
}

const pct = (n: number | null) => (n == null ? '–' : `${n.toFixed(1)}×`);

/**
 * One angle: its name, how much evidence there is, and eight videos.
 *
 * The enum's definition — the sentence the labeller was given — is a `title`, not a line of
 * copy. It answers "what counts as this?" for the one reader in twenty who asks, and printing it
 * beside every label turned a board of twelve framings into a wall of definitions.
 *
 * The mono line is the count and the split across buckets; the badge fires when the near bucket
 * is empty, which is the one thing on this page that is an instruction rather than a reading.
 */
export function AngleBlock({
  angle, detail,
}: {
  angle: AngleStat;
  detail: { bucket: AngleBucket; range: AngleRange; sort: DetailSort; anchor: string | null };
}) {
  return (
    <div className="ang-block">
      <div className="ang-head">
        <h3 className="ang-label">
          <Link href={angleHref(angle.angle_id, detail)} title={angle.definition}>{angle.label}</Link>
        </h3>
        {angle.kind === 'thumbnail' && <span className="cs-badge">Thumbnail</span>}
        {angle.n_near === 0 && <span className="cs-badge" data-tone="accent">None near you</span>}
      </div>

      <div className="ang-stats cs-num">
        {angle.n} · median {pct(angle.median)} · near {angle.n_near} · adjacent {angle.n_adjacent} · far {angle.n_far}
      </div>

      {angle.examples.length > 0 && (
        <div className="ang-row">
          {angle.examples.map((v) => <ExampleTile key={v.id} v={v} />)}
        </div>
      )}
    </div>
  );
}

/**
 * Thumbnail, two lines of title, channel · bucket · score. Nothing else.
 *
 * Each tile used to carry the tagger's `variation` — "Decade-bound music compilation with artist
 * roster" — under the footer. It is still written to video_angles, where it is evidence about
 * how the labeller read a title; on a tile it was a machine describing a picture the reader is
 * already looking at.
 */
function ExampleTile({ v }: { v: AngleExample }) {
  return (
    <Link className="ang-ex" href={`/app/videos/${v.id}`}>
      <Thumb
        src={v.thumbnail_url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}
        fallbackSrc={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
        alt=""
        width={160}
        height={90}
        style={{ width: 160 }}
      />
      <p className="ang-ex-title">{v.title}</p>
      <div className="ang-ex-foot">
        <span className="vg-clip">{v.channel_name} · {v.bucket}</span>
        <ScoreChip score={v.score} />
      </div>
    </Link>
  );
}

/**
 * Angles with nothing in the near bucket and real evidence beyond it — the page's one direct
 * answer to "what should I try". Chips, because that is what the system uses for a short flat
 * list; they are links rather than filters, so none of them is ever "on".
 *
 * Capped: the honest answer is often sixty angles, and sixty chips is a wall, not a suggestion.
 * The list is already sorted by median, so the cap keeps the ones worth trying and the rest are
 * still reachable through their family section below.
 */
export const UNUSED_NEAR_SHOWN = 12;

export function UnusedNear({
  angles, detail,
}: {
  angles: AngleStat[];
  detail: { bucket: AngleBucket; range: AngleRange; sort: DetailSort; anchor: string | null };
}) {
  if (angles.length === 0) return null;
  return (
    <section className="cs-section">
      <h2>Unused near you</h2>
      <div className="ang-unused">
        {angles.slice(0, UNUSED_NEAR_SHOWN).map((a) => (
          <Link key={a.angle_id} className="cs-chip" href={angleHref(a.angle_id, detail)}>
            <span className="cs-chip-label">{a.label}</span>
            <span className="cs-num cs-chip-count">{pct(a.median)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
