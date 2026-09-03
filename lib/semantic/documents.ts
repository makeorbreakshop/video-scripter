import { createHash } from 'crypto';
import { cleanDescriptionForRetrieval, wellFormedText } from './text';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 512;

export type VideoDocumentVariant = 'title' | 'default' | 'description';

export interface VideoDocumentInput {
  title: string;
  channelName: string;
  topicNiche?: string | null;
  description?: string | null;
}

export function buildV4VideoDocument(input: VideoDocumentInput): string {
  return [
    `title: ${wellFormedText(input.title).trim()}`,
    `channel: ${wellFormedText(input.channelName).trim()}`,
    `description: ${cleanDescriptionForRetrieval(input.description)}`,
  ].join('\n');
}

export function buildVideoDocument(input: VideoDocumentInput, variant: VideoDocumentVariant = 'default'): string {
  if (variant === 'title') return input.title;
  if (variant === 'description') return `${input.title}\n${(input.description || '').slice(0, 300)}`;
  return `${input.title}\n${input.channelName}\n${input.topicNiche || ''}`;
}

export interface ChannelDocumentVideo {
  title: string;
  viewCount: number | string | null;
  publishedAt: Date | string;
  topicNiche?: string | null;
}

export interface ChannelDocumentInput {
  name: string;
  videos: ChannelDocumentVideo[];
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function topNiches(videos: ChannelDocumentVideo[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const video of videos) {
    const niche = video.topicNiche?.trim();
    if (niche) counts.set(niche, (counts.get(niche) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b))
    .slice(0, limit)
    .map(([niche]) => niche);
}

export function selectChannelVideos(videos: ChannelDocumentVideo[], limit = 20): ChannelDocumentVideo[] {
  const hasViewCounts = videos.some((video) => video.viewCount != null);
  return [...videos]
    .sort((a, b) => {
      if (hasViewCounts) {
        const byViews = Number(b.viewCount || 0) - Number(a.viewCount || 0);
        if (byViews) return byViews;
      }
      return timestamp(b.publishedAt) - timestamp(a.publishedAt);
    })
    .slice(0, limit);
}

export function buildChannelDocument(
  input: ChannelDocumentInput,
  options: { includeNiches?: boolean } = {},
): string {
  const lines = [wellFormedText(input.name), ...selectChannelVideos(input.videos).map((video) => wellFormedText(video.title))];
  if (options.includeNiches !== false) lines.push(...topNiches(input.videos).map(wellFormedText));
  return lines.join('\n');
}

export function docHash(document: string): string {
  return createHash('sha256').update(document, 'utf8').digest('hex');
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

export interface VideoPayloadRow {
  id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  published_at: Date | string;
  view_count: number | string | null;
  topic_domain: string | null;
  topic_niche: string | null;
  topic_micro: string | null;
  format_type: string | null;
  score: number | string | null;
  confidence: string | null;
  est30: number | string | null;
  baseline: number | string | null;
}

export function mapVideoPayload(row: VideoPayloadRow, embeddedAt = new Date().toISOString()) {
  const score = nullableNumber(row.score);
  return {
    video_id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    title: row.title,
    published_at: Math.floor(timestamp(row.published_at) / 1000),
    view_count: nullableNumber(row.view_count),
    topic_domain: row.topic_domain,
    topic_niche: row.topic_niche,
    topic_micro: row.topic_micro,
    format_type: row.format_type,
    score,
    confidence: row.confidence,
    est30: nullableNumber(row.est30),
    baseline: nullableNumber(row.baseline),
    is_outlier: score != null && score >= 2 && (row.confidence === 'likely' || row.confidence === 'confirmed'),
    embedded_at: embeddedAt,
  };
}

export interface ChannelPayloadRow {
  channel_id: string;
  name: string;
  subscriber_count: number | string | null;
  video_count: number | string | null;
  top_niches: string[];
  baseline: number | string | null;
  outlier_rate: number | string | null;
  lane: 'user' | 'corpus';
}

export function mapChannelPayload(row: ChannelPayloadRow, embeddedAt = new Date().toISOString()) {
  return {
    channel_id: row.channel_id,
    name: row.name,
    subscriber_count: nullableNumber(row.subscriber_count),
    video_count: nullableNumber(row.video_count),
    top_niches: row.top_niches,
    baseline: nullableNumber(row.baseline),
    outlier_rate: nullableNumber(row.outlier_rate),
    lane: row.lane,
    embedded_at: embeddedAt,
  };
}
