// Invariant 2: a feed card shows the CURRENT score, never the one frozen into the outlier
// event when the video first crossed 2x.
//
// Jay Clouse GmIn1W9V8Rs is the live case: the outlier event written on Aug 30 carries
// score 4.4711 (baseline 4,387.9), while video_scores today says 2.7908 (baseline 6,808.5)
// off the same est30 — the channel baseline was refit under it.
import { groupCards, feedRowView, cardKind, cardScoreNote, scoreTooltip, type FeedEventLike } from './feed-format';

const OUTLIER_EVENT: FeedEventLike = {
  id: '1', type: 'outlier', at: '2026-08-30T13:04:14.000Z',
  channel_id: 'UCJ', channel_name: 'Jay Clouse', video_id: 'GmIn1W9V8Rs',
  video_title: 'Kallaway’s EXACT System For Going Viral (Over and Over)',
  thumbnail_url: null, published_at: '2026-08-30T13:04:14.000Z',
  payload: { score: 4.4711457988414, est30: 19618.9958593578, baseline: 4387.91234775695, confidence: 'likely' },
};
const UPLOAD_EVENT: FeedEventLike = {
  ...OUTLIER_EVENT, id: '2', type: 'upload',
  payload: { title: 'Kallaway’s EXACT System For Going Viral (Over and Over)', published_at: '2026-08-30T13:04:14.000Z' },
};

const cardsOf = (events: FeedEventLike[]) => groupCards(events).flatMap((d) => d.cards);

describe('feed card scores follow video_scores, not the frozen event payload', () => {
  it('the card badge is the live score when the row has since been rescored', () => {
    const live = { ...OUTLIER_EVENT, score: 2.79077390431535 };
    const [card] = cardsOf([live]);
    expect(card.score).toBeCloseTo(2.79077390431535, 8);
    expect(card.score).not.toBeCloseTo(4.4711457988414, 3);
  });

  it('the same events with a different video_scores row give a different card score', () => {
    const first = cardsOf([{ ...OUTLIER_EVENT, score: 4.4711457988414 }])[0];
    const second = cardsOf([{ ...OUTLIER_EVENT, score: 2.79077390431535 }])[0];
    expect(first.score).toBeCloseTo(4.4711457988414, 8);
    expect(second.score).toBeCloseTo(2.79077390431535, 8);
  });

  it('a video that has since dropped below 2x still shows the current number, and keeps its crossing event', () => {
    const [card] = cardsOf([{ ...OUTLIER_EVENT, score: 1.4 }]);
    expect(card.score).toBeCloseTo(1.4, 8);
    // the crossing event itself is untouched — it is when it happened, not what it is worth now
    expect(card.events.some((e) => e.type === 'outlier')).toBe(true);
    expect(card.events.find((e) => e.type === 'outlier')!.payload.score).toBeCloseTo(4.4711457988414, 8);
  });

  it('a card never shows a score that differs from the live one for the same video', () => {
    for (const live of [null, 0.5, 2.79077390431535, 12]) {
      const [card] = cardsOf([{ ...OUTLIER_EVENT, score: live }, { ...UPLOAD_EVENT, score: live }]);
      expect(card.score).toBe(live);
    }
  });

  it('an upload day with no outlier event still carries the live score', () => {
    const [card] = cardsOf([{ ...UPLOAD_EVENT, score: 2.79077390431535 }]);
    expect(card.score).toBeCloseTo(2.79077390431535, 8);
    // …without turning an upload into an outlier card
    expect(cardKind(card)).toBe('upload');
  });

  it('a scored card with no outlier event is not an outlier card', () => {
    const swap: FeedEventLike = {
      ...OUTLIER_EVENT, id: '3', type: 'thumbnail_change',
      payload: { version: 2, before_url: 'a', after_url: 'b', hours_since_publish: 4 },
      score: 3.1,
    } as FeedEventLike;
    const [card] = cardsOf([swap]);
    expect(card.score).toBeCloseTo(3.1, 8);
    expect(cardKind(card)).toBe('thumb');
  });

  it('falls back to the event payload only when there is no live score to read', () => {
    const [card] = cardsOf([OUTLIER_EVENT]); // no `score` column at all
    expect(card.score).toBeCloseTo(4.4711457988414, 8);
  });

  it('feedRowView reads the live score too', () => {
    const v = feedRowView({ ...OUTLIER_EVENT, score: 2.79077390431535 });
    expect(v.score).toBeCloseTo(2.79077390431535, 8);
    expect(v.highScore).toBe(false); // 2.79 is under the 3x high-score threshold; 4.47 was not
  });
});

describe('the badge tooltip documents what the number is', () => {
  it('names the comparison, that it is current, and the 2x entry threshold', () => {
    const t = scoreTooltip(2.79077390431535);
    expect(t).toContain('2.8×');
    expect(t).toContain('day-30');
    expect(t).toContain('as of now');
    expect(t).toContain('2×');
  });
  it('says so plainly when there is no score', () => {
    expect(scoreTooltip(null)).toBe('No score yet');
  });
});

describe('a card with no score says why, instead of showing nothing', () => {
  const noScore = (extra: Partial<FeedEventLike>): FeedEventLike =>
    ({ ...UPLOAD_EVENT, score: null, ...extra } as FeedEventLike);

  it('names the channel when it has too little history for a baseline', () => {
    const [card] = cardsOf([noScore({ score_n_baseline: 1, score_confidence: 'insufficient' })]);
    expect(cardScoreNote(card)).toBe('Not enough Jay Clouse history yet for a baseline');
  });

  it('says the priors are too young when the channel has plenty of videos but no day-30 reads', () => {
    const [card] = cardsOf([noScore({ score_n_baseline: 0, score_confidence: 'insufficient', prior_longform: 12 })]);
    expect(cardScoreNote(card)).toBe("Jay Clouse's recent videos are still too young to set a baseline");
  });

  it('says a video with no score row at all is simply not scored yet', () => {
    const [card] = cardsOf([noScore({})]);
    expect(cardScoreNote(card)).toBe('Not scored yet — the next scoring run picks it up');
  });

  it('says nothing at all once there is a score to show', () => {
    const [card] = cardsOf([{ ...UPLOAD_EVENT, score: 2.79 }]);
    expect(cardScoreNote(card)).toBeNull();
  });
});
