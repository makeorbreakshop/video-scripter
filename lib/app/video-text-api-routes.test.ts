// The six analysis/idea API routes used to read videos.description / videos.llm_summary
// straight out of their `.select(...)` lists. After scripts/null-video-text.ts runs those
// columns are NULL, so every one of those prompts would have quietly lost its summaries.
//
// Each route now selects only the columns that stay on `videos` and hydrates the long text
// through lib/app/video-text.ts (videoTextFor). These tests pin the two halves of that:
// the shape of the query, and the pure merge that puts the hydrated text back on the rows.
process.env.PINECONE_API_KEY ||= 'test-key';
process.env.PINECONE_INDEX_NAME ||= 'test-index';
process.env.PINECONE_THUMBNAIL_INDEX_NAME ||= 'test-index';
process.env.PINECONE_SUMMARY_INDEX_NAME ||= 'test-index';
process.env.OPENAI_API_KEY ||= 'test-key';
process.env.ANTHROPIC_API_KEY ||= 'test-key';

import fs from 'node:fs';
import path from 'node:path';

import * as adaptIdea from '@/app/api/adapt-idea/route';
import * as channelStyle from '@/app/api/analyze-channel-style/route';
import * as analyzePattern from '@/app/api/analyze-pattern/route';
import * as analyzePatternEnhanced from '@/app/api/analyze-pattern-enhanced/route';
import * as extractFrames from '@/app/api/extract-frames/route';
import * as ideaRadar from '@/app/api/idea-radar/route';

const ROOT = path.resolve(__dirname, '..', '..');

const ROUTE_FILES = [
  'app/api/adapt-idea/route.ts',
  'app/api/analyze-channel-style/route.ts',
  'app/api/analyze-pattern/route.ts',
  'app/api/analyze-pattern-enhanced/route.ts',
  'app/api/extract-frames/route.ts',
  'app/api/idea-radar/route.ts',
];

/** Every column list these routes send to supabase-js, by the route that owns it. */
const SELECTS: Record<string, string[]> = {
  'adapt-idea': [adaptIdea.SOURCE_VIDEO_COLUMNS],
  'analyze-channel-style': [channelStyle.TOP_PERFORMER_COLUMNS],
  'analyze-pattern': [analyzePattern.TARGET_VIDEO_COLUMNS, analyzePattern.BASELINE_VIDEO_COLUMNS, analyzePattern.CANDIDATE_VIDEO_COLUMNS],
  'analyze-pattern-enhanced': [analyzePatternEnhanced.TARGET_VIDEO_COLUMNS, analyzePatternEnhanced.BASELINE_VIDEO_COLUMNS, analyzePatternEnhanced.CANDIDATE_VIDEO_COLUMNS],
  'extract-frames': [extractFrames.FULL_VIDEO_COLUMNS, extractFrames.USER_HIGH_PERFORMER_COLUMNS],
  'idea-radar': [ideaRadar.OUTLIER_COLUMNS],
};

describe('the six routes no longer name the text columns in a videos query', () => {
  it.each(Object.entries(SELECTS))('%s selects none of the three moved columns', (_name, selects) => {
    for (const select of selects) {
      expect(select).not.toMatch(/\bdescription\b/);
      expect(select).not.toMatch(/\bmetadata\b/);
      expect(select).not.toMatch(/\bllm_summary\b/);
    }
  });

  it.each(Object.entries(SELECTS))('%s still selects id, so the rows can be hydrated', (_name, selects) => {
    for (const select of selects) {
      expect(select.split(',').map((c) => c.trim())).toContain('id');
    }
  });

  it.each(Object.entries(SELECTS))('%s keeps a non-empty projection', (_name, selects) => {
    for (const select of selects) expect(select.trim().length).toBeGreaterThan(0);
  });

  it.each(ROUTE_FILES)('%s contains no direct reference to the moved columns at all', (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(src).not.toMatch(/llm_summary/);
    expect(src).not.toMatch(/\bv\.description\b/);
    expect(src).not.toMatch(/videos\.description/);
  });

  it.each(ROUTE_FILES)('%s hydrates through lib/app/video-text.ts', (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(src).toMatch(/videoTextFor/);
    expect(src).toMatch(/@\/lib\/app\/video-text/);
  });
});

/** The pure merge each route uses to put hydrated text back on its rows. */
const MERGERS: Record<string, (rows: any, texts: Map<string, any>) => any[]> = {
  'adapt-idea': adaptIdea.attachSummaries,
  'analyze-channel-style': channelStyle.attachSummaries,
  'analyze-pattern': analyzePattern.attachSummaries,
  'analyze-pattern-enhanced': analyzePatternEnhanced.attachSummaries,
  'extract-frames': extractFrames.attachSummaries,
  'idea-radar': ideaRadar.attachSummaries,
};

describe('attachSummaries', () => {
  const texts = new Map<string, any>([
    ['a', { videoId: 'a', description: 'desc a', metadata: null, llmSummary: 'summary a' }],
    ['b', { videoId: 'b', description: null, metadata: null, llmSummary: null }],
  ]);

  it.each(Object.entries(MERGERS))('%s puts each video\'s own summary on its own row', (_n, attach) => {
    const out = attach([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], texts);
    expect(out.map((r) => [r.id, r.summary])).toEqual([['a', 'summary a'], ['b', null]]);
  });

  it.each(Object.entries(MERGERS))('%s leaves every other column untouched', (_n, attach) => {
    const out = attach([{ id: 'a', title: 'A', view_count: 7 }], texts);
    expect(out[0]).toMatchObject({ id: 'a', title: 'A', view_count: 7 });
  });

  it.each(Object.entries(MERGERS))('%s yields null — never undefined — for a video with no video_text row', (_n, attach) => {
    const out = attach([{ id: 'missing' }], texts);
    expect(out).toHaveLength(1);
    expect(out[0].summary).toBeNull();
  });

  it.each(Object.entries(MERGERS))('%s tolerates the null supabase-js returns instead of a list', (_n, attach) => {
    expect(attach(null, texts)).toEqual([]);
  });

  it.each(Object.entries(MERGERS))('%s preserves row order', (_n, attach) => {
    const out = attach([{ id: 'b' }, { id: 'a' }], texts);
    expect(out.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
