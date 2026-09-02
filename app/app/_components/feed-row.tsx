'use client';
import Link from 'next/link';
import { etTimestamp, feedRowView, formatScore, relativeTime, type FeedEventLike } from '@/lib/app/feed-format';
import { ChannelAvatar } from '@/components/app/avatar';

/**
 * One event, read like a social/news item: who, when, what. The channel line comes first
 * (avatar + name + the real time the thing happened, absolute, relative in the tooltip),
 * then the title. An upload gets a large card thumbnail; a packaging change keeps the
 * before → after pair; an outlier carries the score chip.
 */
export default function FeedRow({ event, now, avatarUrl }: { event: FeedEventLike; now?: Date; avatarUrl?: string | null }) {
  const v = feedRowView(event);
  const large = v.thumbSize === 'large';
  const body = (
    <>
      <div className="cs-thumbs" data-size={v.thumbSize}>
        {v.thumbs.length === 0 && <div className="cs-thumb" />}
        {v.thumbs.map((t, i) => (
          <span key={`${t.url}-${i}`} style={{ display: 'contents' }}>
            {i > 0 && <span className="cs-arrow" aria-hidden>&rarr;</span>}
            <div className="cs-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
              {t.caption && <span className="cs-thumb-cap">{t.caption}</span>}
            </div>
          </span>
        ))}
      </div>

      <div className="cs-row-body">
        <div className="cs-byline">
          <ChannelAvatar src={avatarUrl} name={event.channel_name} size={20} />
          {event.channel_name && <span className="cs-byline-name">{event.channel_name}</span>}
          <span aria-hidden>·</span>
          <time className="cs-num" dateTime={event.at} title={`${relativeTime(event.at, now)} ago`}>
            {etTimestamp(event.at)}
          </time>
          {v.label && <span className="cs-tag" data-type={event.type}>{v.label}</span>}
        </div>
        <p className="cs-title" data-size={v.thumbSize}>{v.headline}</p>
        {v.detail && <div className="cs-detail" title={v.detail}>{v.detail}</div>}
      </div>

      {v.score !== null && (
        <div className="cs-row-right">
          <span className="cs-score" title={`${v.score}x the channel baseline`}>{formatScore(v.score)}</span>
        </div>
      )}
    </>
  );

  const cls = `cs-row${large ? ' cs-row-large' : ''}`;
  if (!v.href) return <div className={cls}>{body}</div>;
  return <Link className={cls} href={v.href}>{body}</Link>;
}
