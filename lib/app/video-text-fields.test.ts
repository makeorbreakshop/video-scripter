// The legacy writers' path into video_text (2026-09-26).
//
// Six routes and services (youtube/backfill-rss, import-rss, refresh-channel-analytics,
// sync-channel, lib/vector-db-service, …) inserted or upserted description / metadata straight
// into `videos`. Clearing those columns would reclaim space that the next import put straight
// back, and the text would never reach video_text. They now build their `videos` payload with
// videosTextPayload() — which drops whatever CLEARED_COLUMNS says is gone — and write the side
// copy with writeVideoTextFields(), which names ONLY the fields it was given.
jest.mock('../admin/db', () => ({ q: jest.fn(async () => []) }));

import { q } from '../admin/db';
import {
  videosTextPayload, videoTextFieldsUpsertSql, writeVideoTextFields, hydrateVideoTextFields,
  COMPETITOR_YOUTUBE_CHANNEL_IDS_SQL, youtubeChannelIdsPresentSql, competitorYoutubeChannelIds,
  youtubeChannelIdsPresent,
} from './video-text';

const mq = q as jest.MockedFunction<typeof q>;
beforeEach(() => mq.mockReset().mockResolvedValue([] as any));

describe('videosTextPayload — what still goes into the videos row', () => {
  const fields = { description: 'd', metadata: { a: 1 } };

  it('keeps both while neither is cleared', () => {
    expect(videosTextPayload(fields, ['llm_summary'])).toEqual(fields);
  });

  it('drops a cleared column, so the next import cannot put reclaimed bytes back', () => {
    expect(videosTextPayload(fields, ['llm_summary', 'description'])).toEqual({ metadata: { a: 1 } });
    expect(videosTextPayload(fields, ['description', 'metadata'])).toEqual({});
  });

  it('never invents a field the caller did not supply', () => {
    expect(videosTextPayload({ description: 'd' }, ['llm_summary'])).toEqual({ description: 'd' });
    expect('metadata' in videosTextPayload({ description: 'd' }, [])).toBe(false);
  });
});

describe('videoTextFieldsUpsertSql — the side-table write', () => {
  it('overwrite mode sets ONLY the supplied fields on conflict — never llm_summary', () => {
    const sql = videoTextFieldsUpsertSql(['description'], 'update');
    expect(sql).toMatch(/on conflict \(video_id\) do update\s+set description = excluded\.description, moved_at = now\(\)/);
    expect(sql).not.toMatch(/set[^;]*metadata = excluded/);
    expect(sql).not.toMatch(/llm_summary = excluded/);
  });

  it('overwrites both when both are supplied', () => {
    const sql = videoTextFieldsUpsertSql(['description', 'metadata'], 'update');
    expect(sql).toMatch(/set description = excluded\.description, metadata = excluded\.metadata, moved_at = now\(\)/);
  });

  it('a NEW side row copies every field it was not given from videos, so the mover is not fooled', () => {
    // A description-only side row would carry NULL metadata, and the mover's anti-join would then
    // never copy the real metadata across (see broadcastMetadataSql).
    const sql = videoTextFieldsUpsertSql(['description'], 'update');
    expect(sql).toMatch(/insert into video_text \(video_id, description, metadata, llm_summary, moved_at\)/);
    expect(sql).toMatch(/x\.description, v\.metadata, v\.llm_summary, now\(\)/);
    expect(sql).toMatch(/\n\s+join videos v on v\.id = x\.video_id/); // inner: no orphan side rows
  });

  it('ignore-duplicates mode never touches an existing side row, and prefers the videos copy for a new one', () => {
    // The writer's own `videos` insert ignored the duplicate, so videos kept its old text; a new
    // side row must agree with it, not with the payload that was ignored.
    const sql = videoTextFieldsUpsertSql(['description', 'metadata'], 'nothing');
    expect(sql).toMatch(/on conflict \(video_id\) do nothing/);
    expect(sql).not.toMatch(/do update/);
    expect(sql).toMatch(/coalesce\(v\.description, x\.description\), coalesce\(v\.metadata, x\.metadata\)/);
  });

  it('binds one array per supplied field, in order', () => {
    expect(videoTextFieldsUpsertSql(['metadata'], 'update')).toMatch(/unnest\(\$1::text\[\], \$2::jsonb\[\]\) as x\(video_id, metadata\)/);
    expect(videoTextFieldsUpsertSql(['description', 'metadata'], 'update'))
      .toMatch(/unnest\(\$1::text\[\], \$2::text\[\], \$3::jsonb\[\]\) as x\(video_id, description, metadata\)/);
  });

  it('refuses an empty or unknown field list', () => {
    expect(() => videoTextFieldsUpsertSql([], 'update')).toThrow();
    expect(() => videoTextFieldsUpsertSql(['llm_summary' as any], 'update')).toThrow();
  });
});

describe('writeVideoTextFields', () => {
  it('does nothing for no rows', async () => {
    expect(await writeVideoTextFields([], { onConflict: 'update' })).toBe(0);
    expect(mq).not.toHaveBeenCalled();
  });

  it('infers the fields from the rows and serialises metadata as json', async () => {
    await writeVideoTextFields([
      { videoId: 'a', description: 'da', metadata: { x: 1 } },
      { videoId: 'b', description: null, metadata: null },
    ], { onConflict: 'update' });
    const [sql, params] = mq.mock.calls[0];
    expect(sql).toBe(videoTextFieldsUpsertSql(['description', 'metadata'], 'update'));
    expect(params).toEqual([['a', 'b'], ['da', null], ['{"x":1}', null]]);
  });

  it('refuses rows that disagree about which fields they carry — a missing key is not a NULL', async () => {
    await expect(writeVideoTextFields([
      { videoId: 'a', description: 'd' }, { videoId: 'b', metadata: {} },
    ], { onConflict: 'update' })).rejects.toThrow();
  });
});

describe('hydrateVideoTextFields', () => {
  it('adds only the asked-for fields, preserving order and length, null for a missing row', async () => {
    mq.mockResolvedValueOnce([{ video_id: 'a', description: 'da', metadata: { k: 1 }, llm_summary: 's' }] as any);
    const out = await hydrateVideoTextFields([{ id: 'a', t: 1 }, { id: 'b', t: 2 }], ['metadata']);
    expect(out).toEqual([{ id: 'a', t: 1, metadata: { k: 1 } }, { id: 'b', t: 2, metadata: null }]);
  });

  it('makes no query for no rows', async () => {
    expect(await hydrateVideoTextFields([], ['description'])).toEqual([]);
    expect(mq).not.toHaveBeenCalled();
  });
});

// metadata->>'youtube_channel_id' readers (four channel-discovery services, three routes).
// TABLESAMPLE SYSTEM (1), 2026-09-26: wherever the key exists it equals videos.channel_id (7,475
// of 7,475 sampled rows), but ~35 % of competitor rows do not carry it — so channel_id is an
// exact substitute for the VALUE, not for the PRESENCE test. These read the presence through the
// accessor and let channel_id drive the index.
describe('youtube_channel_id reads', () => {
  it('lists competitor ids through the side table, bounded', () => {
    expect(COMPETITOR_YOUTUBE_CHANNEL_IDS_SQL).toMatch(/coalesce\(vt\.metadata, v\.metadata\)->>'youtube_channel_id' is not null/);
    expect(COMPETITOR_YOUTUBE_CHANNEL_IDS_SQL).toMatch(/v\.is_competitor = true/);
    expect(COMPETITOR_YOUTUBE_CHANNEL_IDS_SQL).toMatch(/limit \$1/);
  });

  it('membership: per requested id, an EXISTS driven by channel_id, confirmed on the metadata key', () => {
    for (const competitorOnly of [true, false]) {
      const sql = youtubeChannelIdsPresentSql(competitorOnly);
      expect(sql).toMatch(/from unnest\(\$1::text\[\]\) as c\(id\)/);
      expect(sql).toMatch(/v\.channel_id = c\.id/);
      expect(sql).toMatch(/coalesce\(vt\.metadata, v\.metadata\)->>'youtube_channel_id' = c\.id/);
      expect(/is_competitor/.test(sql)).toBe(competitorOnly);
    }
  });

  it('returns plain id lists and skips the query for no input', async () => {
    mq.mockResolvedValueOnce([{ youtube_channel_id: 'UCa' }, { youtube_channel_id: 'UCb' }] as any);
    expect(await competitorYoutubeChannelIds(10)).toEqual(['UCa', 'UCb']);
    expect(mq.mock.calls[0][1]).toEqual([10]);
    mq.mockResolvedValueOnce([{ id: 'UCa' }] as any);
    expect(await youtubeChannelIdsPresent(['UCa', 'UCz'], { competitorOnly: true })).toEqual(['UCa']);
    mq.mockClear();
    expect(await youtubeChannelIdsPresent([], { competitorOnly: false })).toEqual([]);
    expect(mq).not.toHaveBeenCalled();
  });
});
