import {
  uploadEvents, thumbnailEvents, titleEvents, outlierEvents,
  UploadRow, ThumbVersionRow, TitleVersionRow, ScoreRow,
} from './materialize';

const T = (s: string) => new Date(s);
const PUB = '2026-09-01T00:00:00.000Z';

describe('uploadEvents', () => {
  const row = (o: Partial<UploadRow> = {}): UploadRow => ({
    video_id: 'v1', channel_id: 'c1', title: 'Hello', published_at: PUB, import_date: null, ...o,
  });

  it('emits one upload event keyed on the publish time', () => {
    const [e] = uploadEvents([row()]);
    expect(e.type).toBe('upload');
    expect(e.channel_id).toBe('c1');
    expect(e.at).toEqual(T(PUB));
    expect(e.dedupe_key).toBe(`upload:v1:${PUB}`);
    expect(e.payload).toEqual({ title: 'Hello', published_at: PUB });
  });

  it('keeps the publish time for a back-catalog video imported later', () => {
    const [e] = uploadEvents([row({ published_at: '2024-01-01T00:00:00.000Z', import_date: PUB })]);
    expect(e.at.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('ignores an import_date that precedes publish', () => {
    const [e] = uploadEvents([row({ import_date: '2026-08-01T00:00:00.000Z' })]);
    expect(e.at).toEqual(T(PUB));
  });
});

describe('thumbnailEvents', () => {
  const row = (o: Partial<ThumbVersionRow> = {}): ThumbVersionRow => ({
    video_id: 'v1', channel_id: 'c1', version: 2, phash: 'aaaa', first_seen: '2026-09-01T06:00:00.000Z', published_at: PUB, ...o,
  });

  it('skips version 1 (the original thumbnail is not a change)', () => {
    expect(thumbnailEvents([row({ version: 1 })], new Map())).toEqual([]);
  });

  it('emits thumbnail_change with before/after and hours since publish', () => {
    const [e] = thumbnailEvents([row()], new Map());
    expect(e.type).toBe('thumbnail_change');
    expect(e.dedupe_key).toBe('thumbnail_change:v1:2');
    expect(e.payload.version).toBe(2);
    expect(e.payload.hours_since_publish).toBe(6);
    // thumbUrl returns null without THUMBS_BASE_URL configured; the shape is what matters here.
    expect(e.payload).toHaveProperty('before_url');
    expect(e.payload).toHaveProperty('after_url');
  });

  it('rounds fractional hours to one decimal', () => {
    const [e] = thumbnailEvents([row({ first_seen: '2026-09-01T01:38:00.000Z' })], new Map());
    expect(e.payload.hours_since_publish).toBe(1.6);
  });

  it('leaves hours null when the publish time is unknown', () => {
    const [e] = thumbnailEvents([row({ published_at: null })], new Map());
    expect(e.payload.hours_since_publish).toBeNull();
  });

  it('calls it an ab_rotation when the new phash matches an earlier version', () => {
    const [e] = thumbnailEvents([row({ version: 3, phash: 'aaaa' })], new Map([['v1', new Set(['aaaa', 'bbbb'])]]));
    expect(e.type).toBe('ab_rotation');
    expect(e.dedupe_key).toBe('ab_rotation:v1:3');
    expect(e.payload.phash).toBe('aaaa');
  });

  it('stays a thumbnail_change when the phash is new', () => {
    const [e] = thumbnailEvents([row({ version: 3, phash: 'cccc' })], new Map([['v1', new Set(['aaaa'])]]));
    expect(e.type).toBe('thumbnail_change');
  });

  it('does not match another video\'s phash', () => {
    const [e] = thumbnailEvents([row({ phash: 'aaaa' })], new Map([['v2', new Set(['aaaa'])]]));
    expect(e.type).toBe('thumbnail_change');
  });

  it('never rotates on a null phash', () => {
    const [e] = thumbnailEvents([row({ phash: null })], new Map([['v1', new Set(['aaaa'])]]));
    expect(e.type).toBe('thumbnail_change');
  });
});

describe('titleEvents', () => {
  const row = (o: Partial<TitleVersionRow> = {}): TitleVersionRow => ({
    video_id: 'v1', channel_id: 'c1', version: 2, title: 'New', previous_title: 'Old',
    first_seen: '2026-09-01T12:00:00.000Z', published_at: PUB, ...o,
  });

  it('skips version 1', () => {
    expect(titleEvents([row({ version: 1 })])).toEqual([]);
  });

  it('emits old -> new', () => {
    const [e] = titleEvents([row()]);
    expect(e.type).toBe('title_change');
    expect(e.dedupe_key).toBe('title_change:v1:2');
    expect(e.payload).toEqual({ version: 2, old_title: 'Old', new_title: 'New', hours_since_publish: 12 });
  });
});

describe('outlierEvents', () => {
  const row = (o: Partial<ScoreRow> = {}): ScoreRow => ({
    video_id: 'v1', channel_id: 'c1', score: 3.5, est30: 350000, baseline: 100000,
    confidence: 'confirmed', scored_at: '2026-09-02T00:00:00.000Z', ...o,
  });

  it('emits for a confirmed 3.5x', () => {
    const [e] = outlierEvents([row()], new Set());
    expect(e.type).toBe('outlier');
    expect(e.dedupe_key).toBe('outlier:v1:2026-09-02T00:00:00.000Z');
    expect(e.payload).toEqual({ score: 3.5, est30: 350000, baseline: 100000, confidence: 'confirmed' });
  });

  it('emits at exactly the 2x threshold but not below', () => {
    expect(outlierEvents([row({ score: 2 })], new Set())).toHaveLength(1);
    expect(outlierEvents([row({ score: 1.99 })], new Set())).toHaveLength(0);
  });

  it('requires likely or confirmed confidence', () => {
    expect(outlierEvents([row({ confidence: 'likely' })], new Set())).toHaveLength(1);
    expect(outlierEvents([row({ confidence: 'early' })], new Set())).toHaveLength(0);
    expect(outlierEvents([row({ confidence: 'insufficient' })], new Set())).toHaveLength(0);
  });

  it('skips a null score', () => {
    expect(outlierEvents([row({ score: null })], new Set())).toHaveLength(0);
  });

  it('does not re-flag a video that already has an outlier event', () => {
    expect(outlierEvents([row()], new Set(['v1']))).toHaveLength(0);
  });

  it('flags a video only once within a single batch', () => {
    const events = outlierEvents([row(), row({ scored_at: '2026-09-02T01:00:00.000Z', score: 4 })], new Set());
    expect(events).toHaveLength(1);
    expect(events[0].payload.score).toBe(3.5);
  });

  it('does not mutate the set it was given', () => {
    const flagged = new Set<string>();
    outlierEvents([row()], flagged);
    expect(flagged.size).toBe(0);
  });
});
