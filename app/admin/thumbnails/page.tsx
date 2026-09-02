import { thumbnailHistories, describeHistory } from '@/lib/admin/queries';
import { compact, etDateTime, ago } from '@/lib/admin/format';
import { VideoLink, ChannelLink, Yt } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

function held(from: string, to: string | null) {
  const end = to ? new Date(to).getTime() : Date.now();
  const h = (end - new Date(from).getTime()) / 3600000;
  const s = h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
  return to ? `held ${s}` : `live ${s}`;
}

const KIND_CLS: Record<string, string> = {
  'test rotation': 'bg-sky-500/15 text-sky-400',
  'single swap': 'bg-amber-500/15 text-amber-400',
  'multiple swaps': 'bg-fuchsia-500/15 text-fuchsia-400',
  'live stream frames': 'bg-muted text-muted-foreground',
};

export default async function ThumbnailChanges({ searchParams }: { searchParams: Promise<{ channel?: string; live?: string }> }) {
  const { channel, live } = await searchParams;
  const showLive = live === '1';
  const rows = await thumbnailHistories(100, channel, showLive);

  return (
    <div>
      <h1 className="text-lg font-semibold tracking-tight">Thumbnail changes</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        One card per video whose CDN image has changed, with every archived version in order. Distinct images are
        lettered A, B, C… so a Test &amp; Compare rotation reads A → B → A → B; a lasting single swap reads A → B.
        {channel && <> Filtered to channel {channel}.</>}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Live streams are {showLive ? 'shown' : 'hidden'} (their CDN image is a feed frame that refreshes every poll, not a packaging change).{' '}
        <a href={showLive ? '/admin/thumbnails' : '/admin/thumbnails?live=1'} className="underline">{showLive ? 'hide live' : 'show live'}</a>
      </p>

      {rows.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No changes recorded.</p>}

      <ul className="mt-6 space-y-4">
        {rows.map((r) => {
          const h = describeHistory(r.versions, r.is_live);
          return (
            <li key={r.video_id} className="rounded-lg border border-border p-3">
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    <VideoLink id={r.video_id} title={r.title} /> <Yt id={r.video_id} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <ChannelLink id={r.channel_id} name={r.channel_name} /> · published {ago(r.published_at)} ·{' '}
                    {compact(r.view_count)} views
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${KIND_CLS[h.kind]}`}>{h.kind}</span>
                  <div className="mt-1 text-muted-foreground">
                    {h.pattern} · {h.distinct} distinct · last change {etDateTime(r.last_change)} ET
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                {h.labeled.map((v, i) => (
                  <figure key={v.version} className="w-44 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/admin/thumb/${r.video_id}/${v.version}`}
                      alt={`v${v.version} image ${v.label}`}
                      className={`aspect-video w-full rounded object-cover ${v.repeat ? 'opacity-60' : ''}`}
                    />
                    <figcaption className="mt-1 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">v{v.version} · {v.label}</span>
                      {v.repeat && ' (again)'} · {etDateTime(v.first_seen)} ·{' '}
                      {held(v.first_seen, h.labeled[i + 1]?.first_seen ?? null)}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
