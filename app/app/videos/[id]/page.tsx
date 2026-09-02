// /app/videos/[id] — one video: how it is doing, and what its packaging changes did.
//
// The reads and the curve math come from lib/app/video-page.ts, which composes the admin
// videoPage() query and lib/admin/video-curve.ts rather than restating either.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadVideoPage, confidenceWord } from '@/lib/app/video-page';
import { n, compact, etDateTime, ageLabel, ago } from '@/lib/admin/format';
import { MarkerHoverProvider, VideoChart } from '@/components/app/video-chart';
import { PackagingTimeline } from '@/components/app/packaging-timeline';
import { ExperimentCard } from '@/components/app/experiment-card';
import { ScoreChip } from '@/components/app/video-grid';

export const dynamic = 'force-dynamic';

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="vp-stat">
      <div className="cs-stat-l">{label}</div>
      <div className="vp-stat-v">{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--cs-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export default async function AppVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await loadVideoPage(id);
  if (!v) notFound();

  const sc = v.score;
  const now = new Date().toISOString();

  return (
    <MarkerHoverProvider>
      <style>{`
        .vp-head { display: flex; flex-direction: column; gap: 16px; margin-bottom: 22px; }
        .vp-cover { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: var(--cs-radius);
                    border: 1px solid var(--cs-line); background: var(--cs-surface-2); display: block; }
        .vp-stats { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
        .vp-stat { border: 1px solid var(--cs-line); border-radius: var(--cs-radius);
                   background: var(--cs-surface); padding: 12px; min-width: 0; }
        .vp-stat-v { margin-top: 4px; font-size: 18px; font-weight: 600;
                     font-family: var(--font-mono), monospace; font-variant-numeric: tabular-nums; }
        .vp-versions { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; list-style: none; margin: 0; }
        .vp-versions li { width: 200px; flex: none; }
        @media (min-width: 720px) {
          .vp-head { flex-direction: row; }
          .vp-cover-wrap { width: 360px; flex: none; }
          .vp-stats { grid-template-columns: repeat(4, minmax(0,1fr)); }
        }
      `}</style>

      <div className="vp-head">
        <div className="vp-cover-wrap">
          {v.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.thumbUrl} alt="" className="vp-cover" />
          ) : (
            <div className="vp-cover" />
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <Link href={`/app/channels/${v.channelId}`} style={{ color: 'var(--cs-accent)', fontSize: 12, fontWeight: 600 }}>
            {v.channelName}
          </Link>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>{v.title}</h1>
          <p className="cs-sub">
            published <span className="cs-num">{etDateTime(v.publishedAt)}</span> ET · {ageLabel(v.publishedAt)} ·{' '}
            <span className="cs-num">{n(v.views)}</span> views
          </p>
          <p className="cs-sub" style={{ marginTop: 6 }}>
            <a href={`https://youtu.be/${v.id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--cs-muted)', textDecoration: 'underline' }}>
              watch on YouTube ↗
            </a>
            {v.lastSeen && <> · last measured {ago(v.lastSeen)}</>}
          </p>
        </div>
      </div>

      <div className="vp-stats cs-section">
        <Stat
          label="Score"
          value={<ScoreChip score={sc?.score ?? null} size="lg" />}
          sub={sc ? `${confidenceWord(sc.confidence)} · measured at ${Number(sc.day) < 1 ? `${Math.round(Number(sc.day) * 24)}h` : `day ${Number(sc.day).toFixed(1)}`}` : 'not scored yet'}
        />
        <Stat
          label="Projected day 30"
          value={sc ? compact(Math.round(sc.est30)) : '–'}
          sub={sc?.baseline != null ? `vs ${compact(Math.round(sc.baseline))} typical for this channel` : 'no channel baseline yet'}
        />
        <Stat
          label="vs channel at same age"
          value={sc?.same_age_ratio != null ? `${sc.same_age_ratio.toFixed(1)}×` : <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--cs-muted)', fontFamily: 'inherit' }}>no channel data at this age</span>}
          sub={sc?.same_age_ratio != null ? `median of ${sc.n_same_age} earlier videos` : undefined}
        />
        <Stat
          label="Measurements"
          value={<span>{v.counts.samples + v.counts.snapshots}</span>}
          sub={`${v.counts.samples} launch samples · ${v.counts.snapshots} daily snapshots`}
        />
      </div>

      <section className="cs-section">
        <h2>Views since publish</h2>
        <div className="cs-card">
          <VideoChart
            actuals={v.actuals}
            curve={v.curve}
            projected={v.projected}
            markers={v.markers}
            thumbUrls={v.thumbUrls}
            score={sc?.score ?? null}
            defaultZoom={v.defaultZoom}
          />
        </div>
      </section>

      <section className="cs-section">
        <h2>Packaging timeline</h2>
        <div className="cs-card">
          <PackagingTimeline publishedAt={v.publishedAt} now={now} markers={v.markers} thumbUrls={v.thumbUrls} />
        </div>
      </section>

      {v.experiments.length > 0 && (
        <section className="cs-section">
          <h2>What each change did</h2>
          <ul style={{ display: 'grid', gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
            {v.experiments.map((e) => (
              <ExperimentCard key={`${e.kind}-${e.version}`} e={e} thumbUrls={v.thumbUrls} />
            ))}
          </ul>
          <p style={{ fontSize: 11, color: 'var(--cs-muted)', marginTop: 8 }}>
            Views per hour is measured from the 15-minute launch samples in a window of up to six hours on each side of
            the change, never crossing a neighbouring change. Views-per-hour falls naturally, so only a move of more
            than 15% is called either way.
          </p>
        </section>
      )}

      <section className="cs-section">
        <h2>Thumbnail versions {v.thumbs.length > 0 && <span style={{ fontWeight: 400, color: 'var(--cs-muted)' }}>· {v.thumbs.length} archived</span>}</h2>
        {v.thumbs.length ? (
          <ol className="vp-versions">
            {v.thumbs.map((t) => (
              <li key={t.version}>
                <span className="cs-thumb" style={{ display: 'block', width: '100%' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.url} alt={`thumbnail v${t.version}`} />
                  <span className="cs-thumb-cap">v{t.version}</span>
                </span>
                <div style={{ fontSize: 11, color: 'var(--cs-muted)', marginTop: 5 }}>
                  <span className="cs-num">{etDateTime(t.first_seen)}</span> ET
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--cs-muted)' }}>No archived versions yet.</p>
        )}
      </section>

      <section className="cs-section">
        <h2>Title history</h2>
        {v.titles.length ? (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {v.titles.map((t) => (
              <div key={t.version} className="cs-kv">
                <span className="cs-kv-l" style={{ flex: 'none', width: 150 }}>
                  v{t.version} · <span className="cs-num">{etDateTime(t.first_seen)}</span> ET
                </span>
                <span style={{ textAlign: 'right' }}>{t.title}</span>
              </div>
            ))}
          </ol>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--cs-muted)' }}>The title has not changed: “{v.title}”.</p>
        )}
      </section>

      <p style={{ fontSize: 12 }}>
        <Link href={`/app/channels/${v.channelId}`} style={{ color: 'var(--cs-muted)' }}>← {v.channelName}</Link>
      </p>
    </MarkerHoverProvider>
  );
}
