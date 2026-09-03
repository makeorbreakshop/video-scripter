'use client';
import Link from 'next/link';
import type { FeedCard as Card } from '@/lib/app/feed-format';
import { cardKind, cardMeta, cardVerb, etTimestamp, formatScore, relativeTime, scoreTooltip } from '@/lib/app/feed-format';
import { ChannelAvatar } from '@/components/app/avatar';
import { Thumb } from '@/components/app/thumb';
import { installThumbFallback } from '@/components/app/thumb-runtime';

// The feed's own copy of the delegated fallback listener: these cards are client components,
// so importing the runtime installs it once for the bundle instead of once per <img>.
installThumbFallback();

/**
 * One video, one day, as a social post: a byline that says in words what the channel did,
 * then the evidence for it. A title change shows the old title struck through next to the
 * new one; a thumbnail test shows before and after side by side. Only the upload gets the
 * big hero treatment, so an edit can no longer read as a new video.
 */

function Arrow() {
  return (
    <svg className="cs-fcard-arrow" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden focusable="false">
      <path d="M3 10h13M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function FeedCard({ card, avatarUrl, now, priority = false }: { card: Card; avatarUrl?: string | null; now?: Date; priority?: boolean }) {
  // Only the first couple of cards are on screen at load; everything below waits.
  const load = priority ? ('eager' as const) : ('lazy' as const);
  const kind = cardKind(card);
  const swaps = card.thumbSwaps;
  const cdn = card.video_id ? `https://i.ytimg.com/vi/${card.video_id}/hqdefault.jpg` : null;
  const latest = (swaps.length ? swaps[swaps.length - 1].url : card.thumbnail_url) || cdn;
  const title = card.titleChange?.to || card.title;
  const meta = cardMeta(card);

  // Before/after pair for a swap day: the previous version when we have two, otherwise the
  // `before_url` the change event carried.
  const swapEvent = card.events.find((e) => e.type === 'thumbnail_change' || e.type === 'ab_rotation');
  const beforeUrl = swaps.length > 1
    ? swaps[swaps.length - 2].url
    : ((swapEvent?.payload?.before_url as string | undefined) || card.thumbnail_url || cdn);
  const beforeVersion = swaps.length > 1 ? swaps[swaps.length - 2].version : null;
  const afterVersion = swaps.length ? swaps[swaps.length - 1].version : null;
  const olderSwaps = swaps.length > 2 ? swaps.slice(0, -2) : [];

  const scoreChip = card.score !== null
    ? <span className="cs-score cs-fcard-score" title={scoreTooltip(card.score)}>{formatScore(card.score)}</span>
    : null;

  const beforeAfter = (
    <>
      <div className="cs-fcard-ba">
        <figure className="cs-fcard-ba-item">
          <Thumb src={beforeUrl} fallbackSrc={cdn} alt="thumbnail before the change" loading={load} style={{ width: '100%', height: '100%' }} />
          <figcaption>{beforeVersion ? `v${beforeVersion}` : 'before'}</figcaption>
        </figure>
        <Arrow />
        <figure className="cs-fcard-ba-item">
          <Thumb src={latest} fallbackSrc={cdn} alt="thumbnail after the change" loading={load} fetchPriority={priority ? 'high' : undefined} style={{ width: '100%', height: '100%' }} />
          <figcaption>{afterVersion ? `v${afterVersion} · now` : 'now'}</figcaption>
        </figure>
      </div>
      {olderSwaps.length > 0 && (
        <span className="cs-versions cs-fcard-older">
          {olderSwaps.slice(-6).map((s, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={`${s.url}-${i}`} src={s.url} alt={`version ${s.version ?? ''}`} title={`v${s.version ?? '?'} · ${etTimestamp(s.at)}`}
                 width={136} height={76} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          ))}
        </span>
      )}
    </>
  );

  const titleChange = (
    <div className="cs-fcard-titles">
      {card.titleChange?.from && <p className="cs-fcard-oldtitle">{card.titleChange.from}</p>}
      <p className="cs-title" data-size="large">{title}</p>
    </div>
  );

  let evidence: React.ReactNode = null;
  if (kind === 'upload') {
    evidence = (
      <div className="cs-fcard-upload">
        <div className="cs-fcard-media">
          <Thumb src={latest} fallbackSrc={cdn} alt="" loading={load} fetchPriority={priority ? 'high' : undefined} style={{ width: '100%', height: '100%' }} />
          {scoreChip}
        </div>
        <div className="cs-fcard-body">
          <p className="cs-title" data-size="large">{title}</p>
          <p className="cs-fcard-sub">Published {etTimestamp(card.uploadedAt || card.at)}</p>
        </div>
      </div>
    );
  } else if (kind === 'title') {
    evidence = (
      <div className="cs-fcard-upload">
        <div className="cs-fcard-media" data-size="ident">
          <Thumb src={latest} fallbackSrc={cdn} alt="" loading={load} fetchPriority={priority ? 'high' : undefined} style={{ width: '100%', height: '100%' }} />
          {scoreChip}
        </div>
        <div className="cs-fcard-body">{titleChange}</div>
      </div>
    );
  } else if (kind === 'thumb') {
    evidence = (
      <div className="cs-fcard-evidence">
        {beforeAfter}
        <p className="cs-title" data-size="small">{title}</p>
      </div>
    );
  } else if (kind === 'combo') {
    evidence = (
      <div className="cs-fcard-evidence">
        {beforeAfter}
        {titleChange}
      </div>
    );
  } else {
    evidence = (
      <div className="cs-fcard-upload">
        <div className="cs-fcard-media" data-size="outlier">
          <Thumb src={latest} fallbackSrc={cdn} alt="" loading={load} fetchPriority={priority ? 'high' : undefined} style={{ width: '100%', height: '100%' }} />
        </div>
        <div className="cs-fcard-body">
          <p className="cs-title" data-size="large">{title}</p>
        </div>
        <span className="cs-score cs-fcard-bigscore" title={scoreTooltip(card.score)}>{formatScore(card.score)}</span>
      </div>
    );
  }

  const body = (
    <>
      <div className="cs-byline cs-fcard-head">
        <ChannelAvatar src={avatarUrl} name={card.channel_name} size={20} />
        {card.channel_name && <span className="cs-byline-name">{card.channel_name}</span>}
        <span className="cs-fcard-verb">{cardVerb(card)}</span>
        <time className="cs-num cs-fcard-time" dateTime={card.at} title={`${relativeTime(card.at, now)} ago`}>{etTimestamp(card.at)}</time>
      </div>
      {evidence}
      {meta && <p className="cs-fcard-meta">{meta}</p>}
    </>
  );
  return card.href
    ? <Link className="cs-fcard" data-kind={kind} href={card.href}>{body}</Link>
    : <div className="cs-fcard" data-kind={kind}>{body}</div>;
}
