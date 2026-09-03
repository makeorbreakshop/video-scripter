// The thumbnail_versions rows behind a TestRow, read for a whole page of videos at once.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js for bulk reads (2026-08-31
// org-wide egress incident). Both reads here are one round trip for the whole page: a feed
// page joins on the video ids it already has, and the Changes tab picks its page in SQL with
// the ORDER BY and the LIMIT, so nothing sorts a full catalogue in the browser.
import { q } from '../admin/db';
import { versionThumbUrl } from './video-page';
import { longformSql } from '../scoring/longform';
import type { ThumbRowWithUrl } from './test-row';
import type { RangeKey } from './channel-page';

/** thumbnail_versions for these videos, keyed by video id, each already carrying its image URL. */
export async function thumbRowsFor(videoIds: string[]): Promise<Record<string, ThumbRowWithUrl[]>> {
  const ids = [...new Set((videoIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const rows = await q<{ video_id: string; version: number; sha256: string | null; phash: string | null; first_seen: string }>(
    `select video_id, version, sha256, phash, first_seen
       from thumbnail_versions
      where video_id = any($1::text[])
      order by video_id, version`,
    [ids]
  );
  const out: Record<string, ThumbRowWithUrl[]> = {};
  for (const r of rows) {
    (out[r.video_id] ||= []).push({
      version: Number(r.version),
      sha256: r.sha256,
      phash: r.phash,
      first_seen: new Date(r.first_seen).toISOString(),
      url: versionThumbUrl(r.video_id, Number(r.version)),
    });
  }
  return out;
}

const RANGE_INTERVAL: Record<RangeKey, string | null> = { all: null, '30d': '30 days', '90d': '90 days', '1y': '1 year' };

export type ChangeKind = 'all' | 'thumbnails' | 'titles' | 'outliers';
export function parseChangeKind(value: string | string[] | null | undefined): ChangeKind {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'thumbnails' || v === 'titles' || v === 'outliers' ? v : 'all';
}

/** How many of a channel's videos have packaging history — the Changes tab's count. */
export async function changedVideoCount(channelId: string, range: RangeKey = 'all'): Promise<number> {
  const iv = RANGE_INTERVAL[range];
  const rows = await q<{ n: number }>(
    `select count(*)::int as n from (
       select v.id
         from videos v
         left join thumbnail_versions t on t.video_id = v.id
         left join title_versions n on n.video_id = v.id
        where v.channel_id = $1 and ${longformSql('v')}${iv ? ` and v.published_at >= now() - interval '${iv}'` : ''}
        group by v.id
       having count(distinct t.version) > 1 or count(distinct n.version) > 1
     ) c`,
    [channelId]
  );
  return rows[0]?.n ?? 0;
}

export type ChangedVideo = {
  id: string;
  title: string;
  channelId: string;
  channelName: string | null;
  publishedAt: string;
  views: number;
  score: number | null;
  thumbs: ThumbRowWithUrl[];
  /** distinct titles this video has worn — the Titles chip filters on more than one */
  titleCount: number;
};

/**
 * One page of a channel's videos that have packaging history, newest change first.
 *
 * Shape: aggregate the channel's version tables once, pick the page there, then read the
 * version rows for the page's videos only. Deciding the page inside a per-video lateral would
 * probe every video in the catalogue to return twenty.
 */
export async function changedVideos(
  channelId: string,
  kind: ChangeKind = 'all',
  range: RangeKey = 'all',
  limit = 20,
): Promise<{ videos: ChangedVideo[]; total: number }> {
  const iv = RANGE_INTERVAL[range];
  const rangeClause = iv ? ` and v.published_at >= now() - interval '${iv}'` : '';
  const having =
    kind === 'thumbnails' ? 'having count(distinct t.version) > 1'
    : kind === 'titles' ? 'having count(distinct n.version) > 1'
    : kind === 'outliers' ? 'having (count(distinct t.version) > 1 or count(distinct n.version) > 1) and max(s.score) >= 2'
    : 'having count(distinct t.version) > 1 or count(distinct n.version) > 1';

  const rows = await q<any>(
    `with changed as (
       select v.id, v.title, v.channel_id, v.channel_name, v.published_at, v.view_count,
              max(s.score)::float8 as score, max(s.confidence) as confidence,
              count(distinct n.version)::int as title_count,
              greatest(coalesce(max(t.first_seen) filter (where t.version > 1), 'epoch'::timestamptz),
                       coalesce(max(n.first_seen) filter (where n.version > 1), 'epoch'::timestamptz)) as last_change
         from videos v
         left join thumbnail_versions t on t.video_id = v.id
         left join title_versions n on n.video_id = v.id
         left join video_scores s on s.video_id = v.id
        where v.channel_id = $1 and ${longformSql('v')}${rangeClause}
        group by v.id, v.title, v.channel_id, v.channel_name, v.published_at, v.view_count
        ${having}
     )
     select c.*, (select count(*)::int from changed) as total
       from changed c
      order by c.last_change desc
      limit $2`,
    [channelId, limit]
  );

  const total = rows[0]?.total ?? 0;
  const byId = await thumbRowsFor(rows.map((r) => r.id));
  return {
    total,
    videos: rows.map((r) => ({
      id: r.id,
      title: r.title,
      channelId: r.channel_id,
      channelName: r.channel_name ?? null,
      publishedAt: new Date(r.published_at).toISOString(),
      views: Number(r.view_count ?? 0),
      score: r.score != null && r.confidence !== 'insufficient' ? Number(r.score) : null,
      thumbs: byId[r.id] ?? [],
      titleCount: Number(r.title_count ?? 0),
    })),
  };
}
