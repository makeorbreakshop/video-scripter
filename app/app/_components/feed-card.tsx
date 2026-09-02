'use client';
import Link from 'next/link';
import type { FeedCard as Card } from '@/lib/app/feed-format';
import { etTimestamp, formatScore, relativeTime } from '@/lib/app/feed-format';
import { ChannelAvatar } from '@/components/app/avatar';

/**
 * One video, one day. The card is the video (thumbnail, title, channel, when); everything
 * that happened to it that day stacks underneath as short lines, so a burst of thumbnail
 * tests reads as one story instead of six rows.
 */
export default function FeedCard({ card, avatarUrl, now }: { card: Card; avatarUrl?: string | null; now?: Date }) {
  const swaps = card.thumbSwaps;
  const rotations = swaps.filter((s) => s.rotation).length;
  const hero = swaps.length ? swaps[swaps.length - 1].url : card.thumbnail_url;
  const body = (
    <>
      <div className="cs-card-media">
        {hero && /* eslint-disable-next-line @next/next/no-img-element */ <img src={hero} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        {card.score !== null && <span className="cs-score cs-card-score" title={`${card.score}x the channel baseline`}>{formatScore(card.score)}</span>}
      </div>
      <div className="cs-card-body">
        <div className="cs-byline">
          <ChannelAvatar src={avatarUrl} name={card.channel_name} size={20} />
          {card.channel_name && <span className="cs-byline-name">{card.channel_name}</span>}
          <span aria-hidden>·</span>
          <time className="cs-num" dateTime={card.at} title={`${relativeTime(card.at, now)} ago`}>{etTimestamp(card.at)}</time>
        </div>
        <p className="cs-title" data-size="large">{card.titleChange?.to || card.title}</p>
        <ul className="cs-activity">
          {card.uploadedAt && <li>Published</li>}
          {swaps.length > 0 && (
            <li>
              <span>{swaps.length === 1 ? 'Thumbnail changed' : `${swaps.length} thumbnail versions`}{rotations ? ` · A/B test, ${rotations} rotation${rotations === 1 ? '' : 's'}` : ''}</span>
              <span className="cs-versions">
                {swaps.slice(-6).map((s, i) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img key={`${s.url}-${i}`} src={s.url} alt={`version ${s.version ?? ''}`} title={`v${s.version ?? '?'} · ${etTimestamp(s.at)}`} loading="lazy" referrerPolicy="no-referrer" />
                ))}
              </span>
            </li>
          )}
          {card.titleChange && <li>Title changed{card.titleChange.from ? <> · was <em>“{card.titleChange.from}”</em></> : null}</li>}
          {card.score !== null && <li>Beat its channel baseline · <span className="cs-num">{formatScore(card.score)}</span></li>}
        </ul>
      </div>
    </>
  );
  return card.href ? <Link className="cs-card" href={card.href}>{body}</Link> : <div className="cs-card">{body}</div>;
}
