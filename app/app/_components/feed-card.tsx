'use client';
import Link from 'next/link';
import type { FeedCard as Card } from '@/lib/app/feed-format';
import { cardEvent, cardKind, cardMeta, cardScoreNote, compactNumber, etTimestamp, formatScore, relativeTime, scoreTooltip } from '@/lib/app/feed-format';
import { rowMeta } from '@/lib/app/test-row';
import { sameAge } from '@/lib/app/age-words';
import { ChannelAvatar } from '@/components/app/avatar';
import { Thumb } from '@/components/app/thumb';
import { installThumbFallback } from '@/components/app/thumb-runtime';

// The feed's own copy of the delegated fallback listener: these cards are client components,
// so importing the runtime installs it once for the bundle instead of once per <img>.
installThumbFallback();

/**
 * One video, one day, as a social post: a byline that says in words what the channel did,
 * then the evidence for it. A title change shows the old title struck through next to the
 * new one; a thumbnail change shows before and after side by side. Only the upload gets the
 * big hero treatment, so an edit can no longer read as a new video.
 *
 * The card is not itself a link. Wrapping it in one nests the title, the score and every
 * future control inside an anchor, which produces an empty tab stop and makes a screen reader
 * announce the whole card as the link name. The media and the title carry the link instead.
 *
 * The score lives in the text line, not on the thumbnail. YouTube's duration badge earns its
 * corner because duration is intrinsic to the video; an outlier score is a judgement about it,
 * and judgements go where Letterboxd and IMDb put ratings — in the metadata line.
 */

/** Renders a link when the card has a video page, and the same box when it does not. */
function Arrow() {
  return (
    <svg className="cs-fcard-arrow" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden focusable="false">
      <path d="M3 10h13M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Go({ href, className, children, ...rest }: {
  href: string | null; className: string; children: React.ReactNode; [k: string]: unknown;
}) {
  return href
    ? <Link className={className} href={href} {...rest}>{children}</Link>
    : <div className={className} {...rest}>{children}</div>;
}

export default function FeedCard({ card, avatarUrl, now, priority = false }: {
  card: Card; avatarUrl?: string | null; now?: Date; priority?: boolean;
}) {
  // Only the first couple of cards are on screen at load; everything below waits.
  const load = priority ? ('eager' as const) : ('lazy' as const);
  const kind = cardKind(card);
  const swaps = card.thumbSwaps;
  const cdn = card.video_id ? `https://i.ytimg.com/vi/${card.video_id}/hqdefault.jpg` : null;
  const latest = (swaps.length ? swaps[swaps.length - 1].url : card.thumbnail_url) || cdn;
  const title = card.titleChange?.to || card.title;
  const meta = cardMeta(card);
  // A blank where the badge goes reads as a broken product. Say why there is no number.
  const scoreNote = cardScoreNote(card);
  const event = cardEvent(card);
  // The numbers. A change card keeps the one line a rotation row shows — "Sep 2 · 103K views ·
  // 2.5×" plus what the change added. An upload, the biggest thing a channel does, gets the
  // score as the headline and the two numbers it is made of under it: what this video is on
  // v5 scores against the channel's typical AT THIS VIDEO'S AGE, so that is the comparison the
  // card leads with, carrying the age it was read at -- "typical 241K at 3d". The day-30
  // projection follows as the secondary number. Same words and same order as the video page's
  // verdict, so the feed never says something the page would contradict.
  const facts = card.events.find((e) => e.view_count != null || e.published_at) ?? card.events[0];
  const line = [
    rowMeta({ publishedAt: facts?.published_at ?? card.uploadedAt, views: facts?.view_count ?? null, score: card.score }),
    meta, scoreNote,
  ].filter(Boolean).join(' · ');
  const subLine = line ? <p className="cs-fcard-sub" title={scoreTooltip(card.score)}>{line}</p> : null;
  const est30 = facts?.score_est30 ?? null, base = facts?.score_baseline ?? null;
  const typicalAtAge = facts?.score_typical_at_age ?? null;
  const published = facts?.published_at ?? card.uploadedAt;
  // Prefer the same-age comparison; fall back to the day-30 anchor for a row scored before the
  // v5 rescore reached it, which has no typical_at_age yet.
  const ageDays = published ? ((now ?? new Date()).getTime() - new Date(published).getTime()) / 86_400_000 : null;
  const scoreLine = typicalAtAge != null && typicalAtAge > 0 && ageDays != null
    ? `typical ${compactNumber(Math.round(typicalAtAge))} at ${sameAge(ageDays)}`
      + (est30 != null ? ` · on pace for ${compactNumber(Math.round(est30))} by day 30` : '')
    : est30 != null && base != null && base > 0
      ? `${compactNumber(Math.round(est30))} by day 30 · typical ${compactNumber(Math.round(base))}`
      : null;
  const stats = (
    <div className="cs-fcard-stats">
      <span className="cs-num cs-fcard-score" data-hot={(card.score ?? 0) >= 2 || undefined}
            title={card.score !== null ? scoreTooltip(card.score) : (scoreNote || 'No score yet')}>
        {formatScore(card.score)}
      </span>
      <span className="cs-fcard-sub">{[facts?.view_count != null ? `${compactNumber(facts.view_count)} views` : null,
        published ? relativeTime(published, now) : null].filter(Boolean).join(' · ')}</span>
      {scoreLine && <span className="cs-fcard-sub">{scoreLine}</span>}
    </div>
  );

  // Before/after pair for a swap day: the previous version when we have two, otherwise the
  // `before_url` the change event carried.
  const swapEvent = card.events.find((e) => e.type === 'thumbnail_change' || e.type === 'ab_rotation');
  const beforeUrl = swaps.length > 1
    ? swaps[swaps.length - 2].url
    : ((swapEvent?.payload?.before_url as string | undefined) || card.thumbnail_url || cdn);
  const beforeVersion = swaps.length > 1 ? swaps[swaps.length - 2].version : null;

  // The unit inside every card is a small YouTube card — thumbnail, title under it — at one
  // fixed width. An upload is one of them with the numbers beside it. A change is two of
  // them, before → after, each with its own title, and nothing else: the pair is the
  // information. Every card lands at the same height because every card is built from the
  // same unit.
  const changedThumb = (kind === 'thumb' || kind === 'combo') && !!beforeUrl && beforeUrl !== latest;
  const changed = changedThumb || kind === 'title' || kind === 'combo';
  const vid = (src: string | null, t: string, opts: { dim?: boolean; old?: boolean; priority?: boolean } = {}) => (
    <Go className="cs-vid" href={card.href} data-dim={opts.dim || undefined}>
      <span className="cs-vid-thumb">
        <Thumb src={src} fallbackSrc={cdn} alt="" loading={load} fetchPriority={opts.priority ? 'high' : undefined} style={{ width: '100%', height: '100%' }} />
      </span>
      <span className="cs-vid-title" data-old={opts.old || undefined}>{t}</span>
    </Go>
  );
  const evidence = changed ? (
    <div className="cs-fcard-row" data-change="">
      {/* Dim only what actually changed: a title change keeps the same picture on both sides. */}
      {vid(changedThumb ? beforeUrl : latest, card.titleChange?.from ?? title, { dim: changedThumb, old: !!card.titleChange?.from })}
      <Arrow />
      {vid(latest, title, { priority })}
    </div>
  ) : (
    <div className="cs-fcard-row" data-upload="">
      {vid(latest, title, { priority })}
      {stats}
    </div>
  );

  const body = (
    <>
      <div className="cs-byline cs-fcard-head">
        <Go className="cs-byline-chan" href={card.channel_id ? `/app/channels/${card.channel_id}` : null}>
          <ChannelAvatar src={avatarUrl} name={card.channel_name} size={36} channelId={card.channel_id} />
          {card.channel_name && <span className="cs-byline-name">{card.channel_name}</span>}
        </Go>
        <span className="tr-pill" data-status={event.status}>{event.pill}</span>
        {event.headline && <span className="tr-headline">{event.headline}</span>}
        <time className="cs-num cs-fcard-time" dateTime={kind === 'upload' ? (published ?? card.at) : card.at}
              title={`${relativeTime(kind === 'upload' ? (published ?? card.at) : card.at, now)} ago`}>
          {etTimestamp(kind === 'upload' ? (published ?? card.at) : card.at)}
        </time>
      </div>
      {evidence}
    </>
  );
  return <article className="cs-fcard" data-kind={kind}>{body}</article>;
}
