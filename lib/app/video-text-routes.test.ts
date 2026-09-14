// The route-level seams for the API handlers that used to read `videos.description` /
// `videos.llm_summary` directly.
//
// The dangerous shape is a PREDICATE, not a projection: `.is('llm_summary', null)` and
// `.not('llm_summary','is',null)` on `videos` look like ordinary filters, but the moment
// scripts/null-video-text.ts runs, the first matches all 1.1 M rows and the second matches
// none. Every progress bar, cost estimate and job size built on them flips to nonsense
// silently. They are rewritten here as SQL over the side table so a test can hold them still.
import {
  SUMMARY_PENDING_COUNT_SQL, SUMMARY_DONE_COUNT_SQL,
  SUMMARY_VECTORIZATION_TOTAL_SQL, SUMMARY_VECTORIZATION_DONE_SQL,
  hydrateDescriptions, hydrateVideoText,
} from './video-text-routes';
import { VIDEO_TEXT_JOIN, type VideoText } from './video-text';

const ALL_COUNT_SQL = [
  SUMMARY_PENDING_COUNT_SQL, SUMMARY_DONE_COUNT_SQL,
  SUMMARY_VECTORIZATION_TOTAL_SQL, SUMMARY_VECTORIZATION_DONE_SQL,
];

describe('the llm-summary count predicates', () => {
  it('never decides from `videos.llm_summary` alone', () => {
    // After the null-out that column is NULL for every row, so a bare v.llm_summary test is
    // not a filter any more — it is a constant.
    for (const sql of ALL_COUNT_SQL) {
      expect(sql).not.toMatch(/\bv\.llm_summary\s+is\s+(not\s+)?null\b/i);
      expect(sql).toMatch(/coalesce\(vt\.llm_summary, v\.llm_summary\)/);
    }
  });

  it('reaches the side table through the shared join, not an ad-hoc one', () => {
    for (const sql of ALL_COUNT_SQL) expect(sql).toContain(VIDEO_TEXT_JOIN);
  });

  it('splits pending from done on opposite sides of the same expression', () => {
    expect(SUMMARY_PENDING_COUNT_SQL).toMatch(/coalesce\(vt\.llm_summary, v\.llm_summary\) is null/);
    expect(SUMMARY_DONE_COUNT_SQL).toMatch(/coalesce\(vt\.llm_summary, v\.llm_summary\) is not null/);
  });

  it('keeps the owner-channel exclusion parameterised, and keeps it `<>` not `is distinct from`', () => {
    // Behaviour preserving: supabase-js `.neq()` is `<>`, which drops NULL channel_name rows.
    expect(SUMMARY_PENDING_COUNT_SQL).toMatch(/v\.channel_name <> \$1/);
    expect(SUMMARY_PENDING_COUNT_SQL).not.toMatch(/is distinct from/i);
    expect(SUMMARY_PENDING_COUNT_SQL).not.toMatch(/Make or Break Shop/);
  });

  it('still reads the embedding bookkeeping flag off `videos`, where it stays', () => {
    // llm_summary_embedding_synced is NOT part of this refactor; it must not follow the text.
    expect(SUMMARY_VECTORIZATION_DONE_SQL).toMatch(/v\.llm_summary_embedding_synced = true/);
    expect(SUMMARY_VECTORIZATION_DONE_SQL).not.toMatch(/vt\.llm_summary_embedding_synced/);
    expect(SUMMARY_VECTORIZATION_TOTAL_SQL).not.toMatch(/embedding_synced/);
  });

  it('returns one integer named `count`, so a caller cannot mistake a row set for a total', () => {
    for (const sql of ALL_COUNT_SQL) expect(sql).toMatch(/select count\(\*\)::int as count/);
  });
});

const text = (id: string, over: Partial<VideoText> = {}): VideoText =>
  ({ videoId: id, description: `d:${id}`, metadata: { t: id }, llmSummary: `s:${id}`, ...over });

describe('hydrateDescriptions', () => {
  it('puts the side-table description back on a row the query no longer selected it for', () => {
    const rows = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
    const out = hydrateDescriptions(rows, new Map([['a', text('a')], ['b', text('b')]]));
    expect(out).toEqual([
      { id: 'a', title: 'A', description: 'd:a' },
      { id: 'b', title: 'B', description: 'd:b' },
    ]);
  });

  it('yields null — not undefined, and not a dropped row — for a video with no text', () => {
    // The classifier prompt builder takes `description: string | null`; a missing map entry
    // must degrade to "no description", never remove the video from the batch.
    const out = hydrateDescriptions([{ id: 'a' }, { id: 'gone' }], new Map([['a', text('a')]]));
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ id: 'gone', description: null });
  });

  it('preserves input order', () => {
    const ids = ['c', 'a', 'b'];
    const out = hydrateDescriptions(ids.map((id) => ({ id })), new Map(ids.map((i) => [i, text(i)])));
    expect(out.map((r) => r.id)).toEqual(ids);
  });

  it('does not mutate the rows it was given', () => {
    const row = { id: 'a', title: 'A' };
    hydrateDescriptions([row], new Map([['a', text('a')]]));
    expect(row).toEqual({ id: 'a', title: 'A' });
  });
});

describe('hydrateVideoText', () => {
  it('fills all three text fields of a single video payload from the side table', () => {
    const out = hydrateVideoText({ id: 'a', title: 'A' }, text('a'));
    expect(out).toMatchObject({ description: 'd:a', metadata: { t: 'a' }, llm_summary: 's:a' });
  });

  it('leaves the sibling bookkeeping columns exactly as the videos row had them', () => {
    const row = {
      id: 'a', llm_summary_model: 'gpt-5-nano', llm_summary_generated_at: '2026-01-01',
      llm_summary_embedding_synced: true,
    };
    expect(hydrateVideoText(row, text('a'))).toMatchObject({
      llm_summary_model: 'gpt-5-nano', llm_summary_generated_at: '2026-01-01',
      llm_summary_embedding_synced: true,
    });
  });

  it('nulls the three fields when the side table has no row, rather than leaving stale values', () => {
    const out = hydrateVideoText({ id: 'a', description: 'stale' }, undefined);
    expect(out.description).toBeNull();
    expect(out.metadata).toBeNull();
    expect(out.llm_summary).toBeNull();
  });

  it('parses a metadata value that arrived as a JSON string, as the route did before', () => {
    const out = hydrateVideoText({ id: 'a' }, text('a', { metadata: '{"tags":["x"]}' as any }));
    expect(out.metadata).toEqual({ tags: ['x'] });
  });

  it('does not mutate the row it was given', () => {
    const row = { id: 'a' };
    hydrateVideoText(row, text('a'));
    expect(row).toEqual({ id: 'a' });
  });
});
