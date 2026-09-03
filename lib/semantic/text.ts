import { createHash } from 'crypto';

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_-]+/gu;
const VIEW_COUNT_RE = /\bviews?\s*:?\s*[\d,._]+\b|\b[\d,._]+\s+views?\b/gi;
const BOILERPLATE_RE = [
  /\bas an amazon associate\b.*?(?:\.|$)/gi,
  /\baffiliate links?.*?(?:\.|$)/gi,
  /\buse code\b\s+\w+.*?(?:\.|$)/gi,
  /\bsponsored by\b.*?(?:\.|$)/gi,
  /\bsubscribe(?:\s+to\s+my\s+channel)?\b.*?(?:\.|$)/gi,
];

export function cleanDescriptionForRetrieval(description: string | null | undefined, maxChars = 1_500): string {
  let text = description ?? '';
  text = text.replace(URL_RE, ' ');
  for (const pattern of BOILERPLATE_RE) text = text.replace(pattern, ' ');
  text = text.replace(HASHTAG_RE, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, maxChars).trim();
}

export function buildFacetSourceText(input: {
  title: string;
  channelName: string;
  description?: string | null;
  topicLabel?: string | null;
}): string {
  const description = cleanDescriptionForRetrieval(input.description).replace(VIEW_COUNT_RE, ' ').replace(/\s+/g, ' ').trim();
  return [
    `Title: ${input.title}`,
    `Channel: ${input.channelName}`,
    input.topicLabel ? `Topic: ${input.topicLabel}` : null,
    description ? `Description: ${description}` : null,
  ].filter(Boolean).join('\n');
}

export function sourceHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
