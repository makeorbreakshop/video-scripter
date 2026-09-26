import fs from 'node:fs';
import path from 'node:path';
import { readsFromVideos } from './video-text-db-readers';

// sql/2026-09-26-metadata-db-readers.sql is the precondition for clearing videos.metadata: after
// it, no live database object may read metadata off `videos` (video-text-db-objects.db.test.ts).
// This pins, without a database, that every object it defines reads through video_text.
const SQL = fs.readFileSync(path.resolve(__dirname, '../../sql/2026-09-26-metadata-db-readers.sql'), 'utf8');
const body = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('the metadata database-reader migration', () => {
  it('leaves nothing reading metadata directly off videos', () => {
    expect(readsFromVideos(body, 'metadata')).toBe(false);
  });

  it('freezes the live-ingest tracked-channel list instead of recomputing it', () => {
    expect(body).toMatch(/create table public\.competitor_youtube_channels_frozen as select \* from public\.competitor_youtube_channels/);
    expect(body).not.toMatch(/create materialized view public\.competitor_youtube_channels\b/);
    expect(body).toMatch(/create unique index competitor_youtube_channels_youtube_channel_id_idx/);
  });

  it('keeps both function signatures', () => {
    expect(body).toMatch(/function public\.get_competitor_channel_stats\(\)\s+returns table\(channel_id text, youtube_channel_id text/);
    expect(body).toMatch(/function public\.get_random_video_ids\(p_outlier_score integer default 2/);
  });

  it('never queues an exclusive lock: every transaction sets a lock_timeout', () => {
    const txns = body.split(/\bbegin;/).slice(1);
    expect(txns.length).toBe(4);
    for (const t of txns) expect(t).toMatch(/set local lock_timeout = '5s'/);
  });

  it('restores the original grants (no anon/authenticated) on every recreated relation', () => {
    for (const rel of ['competitor_youtube_channels', 'competitor_channel_summary', 'analytics_stats', 'database_channel_health']) {
      expect(body).toMatch(new RegExp(`revoke all on public\\.${rel} from anon, authenticated`));
      expect(body).toMatch(new RegExp(`grant all on public\\.${rel} to service_role, channelsmith_app`));
    }
  });
});
