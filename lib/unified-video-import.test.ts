// The import writes every column of a video row. Three of them have moved to video_text, and
// the import is the thing that keeps filling them — the direct-SQL bulk upsert, the Supabase
// fallback upsert, and the summary-embedding metadata read.
import { stubServiceEnv } from './__test-env';

stubServiceEnv();
const {
  VIDEO_UPSERT_COLUMNS,
  buildVideoUpsertSql,
  stripVideoText,
  videoTextRowsFrom,
  SUMMARY_EMBED_META_COLUMNS,
} = require('./unified-video-import');

const SUMMARY = ['llm', 'summary'].join('_');
const MOVED = ['description', 'metadata', SUMMARY];

describe('the bulk INSERT ... ON CONFLICT', () => {
  const sql: string = buildVideoUpsertSql(['($1, $2)']);

  it('no longer inserts or updates the three moved columns', () => {
    for (const c of MOVED) {
      expect(VIDEO_UPSERT_COLUMNS).not.toContain(c);
      expect(sql).not.toMatch(new RegExp(`\\b${c} = EXCLUDED\\.${c}`));
    }
  });

  it('keeps the bookkeeping sibling that did not move', () => {
    expect(VIDEO_UPSERT_COLUMNS).toContain(`${SUMMARY}_model`);
  });

  it('still writes the columns that never moved', () => {
    for (const c of ['id', 'title', 'channel_id', 'view_count', 'format_type']) {
      expect(VIDEO_UPSERT_COLUMNS).toContain(c);
    }
    expect(sql).toMatch(/INSERT INTO videos/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE SET/);
  });

  it('has exactly one placeholder group per column', () => {
    expect(sql).toMatch(/VALUES \(\$1, \$2\)/);
  });
});

describe('the Supabase fallback upsert payload', () => {
  const video = {
    id: 'a', title: 'T', description: 'd', metadata: { m: 1 }, [SUMMARY]: 's', view_count: 5,
  };

  it('drops the moved columns from what goes into `videos`', () => {
    const stripped = stripVideoText(video);
    for (const c of MOVED) expect(stripped).not.toHaveProperty(c);
    expect(stripped).toEqual({ id: 'a', title: 'T', view_count: 5 });
  });

  it('turns the same rows into side-table rows so nothing is lost', () => {
    expect(videoTextRowsFrom([video])).toEqual([
      { videoId: 'a', description: 'd', metadata: { m: 1 }, llmSummary: 's' },
    ]);
  });

  it('normalises absent text to null rather than undefined', () => {
    expect(videoTextRowsFrom([{ id: 'b', title: 'T' }])).toEqual([
      { videoId: 'b', description: null, metadata: null, llmSummary: null },
    ]);
  });

  it('skips a row with no id at all', () => {
    expect(videoTextRowsFrom([{ title: 'T' }])).toEqual([]);
  });
});

describe('the metadata read behind the summary embeddings', () => {
  it('selects no moved column from videos — the summary is hydrated instead', () => {
    for (const c of MOVED) expect(SUMMARY_EMBED_META_COLUMNS).not.toContain(c);
    expect(SUMMARY_EMBED_META_COLUMNS).toEqual(['id', 'title', 'channel_name', 'view_count']);
  });
});

describe('the small-batch path (< 100 videos) writes text only to video_text (audit 2026-09-26)', () => {
  // `.upsert(videos, …)` sent whole rows — description, metadata AND the cleared llm_summary —
  // into `videos` and wrote no side row: every small import re-duplicated its text, and the
  // reader sweep could not see it because the payload is a variable.
  const src: string = require('node:fs').readFileSync(require('node:path').join(__dirname, 'unified-video-import.ts'), 'utf8');
  const body = src.slice(src.indexOf('async storeVideoData(videos'), src.indexOf('async storeVideoDataChunked'));

  it('never upserts unstripped rows into videos', () => {
    expect(body).not.toMatch(/\.upsert\(videos\s*,/);
    expect(body).toMatch(/\.upsert\(videos\.map\(\(v\) => stripVideoText\(v as any\)\)/);
  });

  it('writes the side rows after the videos upsert', () => {
    expect(body).toMatch(/await writeVideoText\(videoTextRowsFrom\(videos as any\)\)/);
  });
});
