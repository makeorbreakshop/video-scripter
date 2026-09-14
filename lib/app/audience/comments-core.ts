import { createHmac } from 'node:crypto';

export const FIRST_PULL_CAP = 3000;
export const VIDEO_CAP = 300;
export const PAGE_CAP = 100; // Data API commentThreads.list is one unit per page.

export interface Candidate { id: string; comment_count: number | null; published_at: string | Date | null }

export function candidateVideos(top: Candidate[], recent: Candidate[]): Candidate[] {
  return [...new Map([...top, ...recent].map((v) => [v.id, v])).values()];
}

export function allowedPageSize(videoStored: number, totalStored: number, pageCount: number): number {
  if (pageCount >= PAGE_CAP) return 0;
  return Math.max(0, Math.min(100, VIDEO_CAP - videoStored, FIRST_PULL_CAP - totalStored));
}

/** Domain-separated keyed SHA-256: no author identifier or name reaches storage. */
export function hashAuthor(authorId: string, secret: string): string {
  if (!secret || !authorId) throw new Error('author identifier or server secret missing');
  return createHmac('sha256', Buffer.from(secret, 'base64'))
    .update('audience-author-v1\0').update(authorId).digest('hex');
}

export interface RawComment {
  id: string;
  snippet?: {
    textOriginal?: string; authorChannelId?: { value?: string };
    likeCount?: number; publishedAt?: string; parentId?: string;
  };
}

export interface CommentThread { snippet?: { topLevelComment?: RawComment }; replies?: { comments?: RawComment[] } }

export interface StoredComment {
  comment_id: string; video_id: string; channel_id: string; parent_id: string | null;
  author_hash: string; text: string; like_count: number; published_at: string;
}

export function parseThread(thread: CommentThread, channelId: string, videoId: string, secret: string): StoredComment[] {
  const parent = thread.snippet?.topLevelComment;
  const comments = parent ? [parent, ...(thread.replies?.comments || [])] : [];
  return comments.flatMap((c) => {
    const s = c.snippet;
    const text = s?.textOriginal ?? '';
    if (text.trim().length < 15 || !s?.authorChannelId?.value ||
        s.authorChannelId.value === channelId || !s.publishedAt || !c.id) return [];
    return [{
      comment_id: c.id, video_id: videoId, channel_id: channelId,
      parent_id: c === parent ? null : (s.parentId || parent?.id || null),
      author_hash: hashAuthor(s.authorChannelId.value, secret), text,
      like_count: Math.max(0, Number(s.likeCount) || 0), published_at: s.publishedAt,
    }];
  });
}
