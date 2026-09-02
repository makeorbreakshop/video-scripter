'use client';
import Link from 'next/link';
import { feedRowView, formatScore, relativeTime, type FeedEventLike } from '@/lib/app/feed-format';

/** One event, stalkr-style: thumbnails left, what changed in the middle, time right. */
export default function FeedRow({ event, now }: { event: FeedEventLike; now?: Date }) {
  const v = feedRowView(event);
  const body = (
    <>
      <div className="cs-thumbs">
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
        <span className="cs-tag" data-type={event.type}>{v.label}</span>
        <p className="cs-title">{v.headline}</p>
        {v.detail && <div className="cs-detail" title={v.detail}>{v.detail}</div>}
        {event.channel_name && <div className="cs-channel">{event.channel_name}</div>}
      </div>

      <div className="cs-row-right">
        {v.highScore && <span className="cs-newhigh">&#9733; NEW<br />HIGH SCORE</span>}
        {v.score !== null && (
          <span className="cs-score" title={`${v.score}x the channel baseline`}>{formatScore(v.score)}</span>
        )}
        <time className="cs-time cs-num" dateTime={event.at}>{relativeTime(event.at, now)}</time>
      </div>
    </>
  );

  if (!v.href) return <div className="cs-row">{body}</div>;
  return <Link className="cs-row" href={v.href}>{body}</Link>;
}
