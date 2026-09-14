import { q } from '../../admin/db';
import { candidateVideos, allowedPageSize, parseThread, type Candidate, type StoredComment, type CommentThread } from './comments-core';
import { ownerChannel } from './owner';

export interface FetchReceipt { stored: number; pages: number; videos: number; skipped: number }

async function saveComments(rows: StoredComment[]): Promise<number> {
  if (!rows.length) return 0;
  const values: unknown[] = [];
  const tuples = rows.map((row, i) => {
    values.push(row.comment_id, row.video_id, row.channel_id, row.parent_id, row.author_hash, row.text, row.like_count, row.published_at);
    return `(${Array.from({ length: 8 }, (_, j) => `$${i * 8 + j + 1}`).join(',')})`;
  });
  const saved = await q<{ comment_id: string }>(
    `insert into audience_comments (comment_id, video_id, channel_id, parent_id, author_hash, text, like_count, published_at)
     values ${tuples.join(',')} on conflict (comment_id) do nothing returning comment_id`, values);
  return saved.length;
}

export async function fetchAudienceComments(channelId: string, opts: { maxComments?: number; maxPages?: number } = {}): Promise<FetchReceipt> {
  await ownerChannel(channelId);
  const apiKey = process.env.YOUTUBE_API_KEY;
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!apiKey || !secret) throw new Error('YouTube API key or author hash secret missing');
  const top = await q<Candidate>(
    `select id, comment_count, published_at from videos where channel_id = $1 and comment_count > 0
     order by comment_count desc nulls last limit 50`, [channelId]);
  const recent = await q<Candidate>(
    `select id, comment_count, published_at from videos where channel_id = $1 and published_at >= now() - interval '90 days'
     and comment_count > 0 order by published_at desc limit 300`, [channelId]);
  const candidates = candidateVideos(top, recent);
  const existing = await q<{ video_id: string }>(
    `select distinct video_id from audience_comments where channel_id = $1 and video_id = any($2::text[])`,
    [channelId, candidates.map((c) => c.id)]);
  const visited = new Set(existing.map((r) => r.video_id));
  const maxComments = Math.min(3000, Math.max(0, opts.maxComments ?? 3000));
  const maxPages = Math.min(99, Math.max(0, opts.maxPages ?? 99));
  const receipt: FetchReceipt = { stored: 0, pages: 0, videos: 0, skipped: visited.size };
  for (const video of candidates) {
    if (visited.has(video.id) || receipt.stored >= maxComments || receipt.pages >= maxPages) continue;
    let pageToken: string | undefined;
    let videoStored = 0;
    receipt.videos++;
    do {
      const size = Math.min(allowedPageSize(videoStored, receipt.stored, receipt.pages), maxComments - receipt.stored);
      if (!size || receipt.pages >= maxPages) break;
      const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
      for (const [key, value] of Object.entries({ part: 'snippet,replies', videoId: video.id,
        order: 'relevance', maxResults: String(size), textFormat: 'plainText', key: apiKey })) url.searchParams.set(key, value);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      receipt.pages++;
      const body = await res.json() as { items?: CommentThread[]; nextPageToken?: string; error?: { message?: string; errors?: { reason?: string }[] } };
      if (!res.ok) {
        if (body.error?.errors?.some((e) => ['commentsDisabled', 'videoNotFound'].includes(e.reason || ''))) break;
        throw new Error(`commentThreads ${res.status}: ${body.error?.message || 'unknown error'}`);
      }
      const parsed = (body.items || []).flatMap((t) => parseThread(t, channelId, video.id, secret));
      const unique = [...new Map(parsed.map((c) => [c.comment_id, c])).values()];
      const batch = unique.slice(0, Math.min(300 - videoStored, maxComments - receipt.stored));
      const n = await saveComments(batch);
      videoStored += n;
      receipt.stored += n;
      pageToken = body.nextPageToken;
    } while (pageToken && videoStored < 300 && receipt.stored < maxComments && receipt.pages < maxPages);
  }
  return receipt;
}
