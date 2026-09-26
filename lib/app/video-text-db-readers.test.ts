import { readsFromVideos } from './video-text-db-readers';

describe('reading a database definition the way the code sweep reads code', () => {
  it('flags a direct read of the column off videos', () => {
    expect(readsFromVideos("select v.metadata->>'category_id' from videos v", 'metadata')).toBe(true);
  });

  it('accepts the accessor idiom, as pg_get_viewdef prints it', () => {
    expect(readsFromVideos(
      "SELECT COALESCE(vt.metadata, v.metadata) ->> 'x' FROM videos v LEFT JOIN video_text vt ON vt.video_id = v.id",
      'metadata')).toBe(false);
  });

  it('accepts the idiom when Postgres has renamed the videos alias (v → v_1 in pg_get_viewdef)', () => {
    expect(readsFromVideos("WHERE (COALESCE(vt.metadata, v_1.metadata) ->> 'source') = 'rss'", 'metadata')).toBe(false);
  });

  it('accepts a plain read of the side table', () => {
    expect(readsFromVideos('select vt.description from video_text vt join videos v on v.id = vt.video_id', 'description')).toBe(false);
  });

  it('does not confuse a sibling column for the moved one', () => {
    expect(readsFromVideos('select metadata_updated_at from videos', 'metadata')).toBe(false);
  });

  it('still flags a direct read that sits beside an accessor read', () => {
    expect(readsFromVideos('select coalesce(vt.metadata, v.metadata), v.metadata from videos v', 'metadata')).toBe(true);
  });
});
