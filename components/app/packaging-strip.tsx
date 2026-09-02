'use client';

// The thumbnails a video has actually worn, in order, with what each swap did.
//
// This replaces the earlier split between a brushed timeline and a separate row of experiment
// cards: both drew the same images, so the page showed every thumbnail twice. Here the image
// is the row, and the measured effect hangs off the image that caused it. Hovering an item
// highlights the matching change marker on the chart above (and vice versa).

import type { Experiment } from '@/lib/app/experiment';
import type { ThumbVersionView } from '@/lib/app/video-page';
import { markerKey, useMarkerHover } from './video-chart';
import { Thumb } from './thumb';

const ET = 'America/New_York';
const HOUR = 3_600_000;

function etTime(t: string) {
  return new Date(t).toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** How long after publish the swap happened, in the unit a person would use out loud. */
export function sincePublish(iso: string, publishedAt: string): string {
  const h = (new Date(iso).getTime() - new Date(publishedAt).getTime()) / HOUR;
  if (h < 1) return `${Math.max(0, Math.round(h * 60))} min after publish`;
  if (h < 48) return `${h.toFixed(1)}h after publish`;
  return `${Math.round(h / 24)} days after publish`;
}

function rate(v: number | null): string {
  if (v == null) return '–';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v));
}

const TONE: Record<string, string> = {
  helped: 'var(--cs-accent)',
  hurt: 'var(--cs-bad)',
  'no clear effect': 'var(--cs-muted)',
};

/** R2 is the first source; the signed-in archive route is the fallback for a version that
 *  never reached the bucket. Kept here rather than passed in — a server page cannot hand a
 *  function to a client component. */
function fallbackUrl(videoId: string, version: number) {
  return `/api/admin/thumb/${videoId}/${version}`;
}

export function PackagingStrip({
  videoId, publishedAt, thumbs, experiments,
}: {
  videoId: string;
  publishedAt: string;
  thumbs: ThumbVersionView[];
  experiments: Experiment[];
}) {
  const { hovered, setHovered } = useMarkerHover();
  const byVersion = new Map(experiments.filter((e) => e.kind === 'thumb').map((e) => [e.version, e]));
  const swaps = thumbs.filter((t) => t.version > 1);
  // Said once, under the strip — not repeated on every row that is still waiting for data.
  const allTooEarly = swaps.length > 0 && swaps.every((t) => (byVersion.get(t.version)?.verdict ?? 'too early') === 'too early');

  return (
    <div>
      <ol style={{ display: 'flex', gap: 12, overflowX: 'auto', listStyle: 'none', margin: 0, padding: '0 0 8px' }}>
        {thumbs.map((t, i) => {
          const e = byVersion.get(t.version);
          const key = markerKey({ kind: 'thumb', version: t.version });
          const on = hovered === key && t.version > 1;
          return (
            <li
              key={t.version}
              tabIndex={t.version > 1 ? 0 : -1}
              onMouseEnter={() => t.version > 1 && setHovered(key)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => t.version > 1 && setHovered(key)}
              onBlur={() => setHovered(null)}
              style={{ width: 200, flex: 'none', outline: 'none', opacity: hovered && !on && t.version > 1 ? 0.6 : 1 }}
            >
              <Thumb
                src={t.url}
                fallbackSrc={fallbackUrl(videoId, t.version)}
                alt={i === 0 ? 'original thumbnail' : `thumbnail swap ${i}`}
                style={{ width: '100%', boxShadow: on ? '0 0 0 2px var(--cs-accent)' : undefined, borderRadius: 6 }}
              />
              <div style={{ fontSize: 11, color: 'var(--cs-muted)', marginTop: 6 }}>
                <span style={{ color: 'var(--cs-ink)', fontWeight: 600 }}>{i === 0 ? 'Original' : `Swap ${i}`}</span>
                {' · '}<span className="cs-num">{etTime(t.first_seen)}</span> ET
                {i > 0 && <><br />{sincePublish(t.first_seen, publishedAt)}</>}
              </div>
              {e && e.verdict !== 'too early' && (
                <div style={{ fontSize: 12, marginTop: 3, color: TONE[e.verdict] }}>
                  {e.verdict} · <span className="cs-num">{rate(e.beforeVph)}</span> → <span className="cs-num">{rate(e.afterVph)}</span> views/hour
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {allTooEarly && (
        <p style={{ fontSize: 12, color: 'var(--cs-muted)', margin: '2px 0 0' }}>
          Too soon to tell what these swaps did — there is not enough tracking either side of them yet.
        </p>
      )}
    </div>
  );
}
