import { createHash } from 'crypto';

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_-]+/gu;
const VIEW_COUNT_RE = /\bviews?\s*:?\s*\d[\d,._]*\b|\b\d[\d,._]*\s+views?\b/gi;
const BOILERPLATE_RE = [
  /\bas an amazon associate\b.*?(?:\.|$)/gi,
  /\baffiliate links?.*?(?:\.|$)/gi,
  /\buse code\b\s+\w+.*?(?:\.|$)/gi,
  /\bsponsored by\b.*?(?:\.|$)/gi,
  /\bsubscribe(?:\s+to\s+my\s+channel)?\b.*?(?:\.|$)/gi,
];

export function wellFormedText(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      } else {
        output += '\ufffd';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += '\ufffd';
    } else {
      output += value[index];
    }
  }
  return output;
}

function truncateWellFormed(value: string, maxChars: number): string {
  let truncated = value.slice(0, Math.max(0, maxChars));
  const last = truncated.charCodeAt(truncated.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) truncated = truncated.slice(0, -1);
  return truncated;
}

export function cleanDescriptionForRetrieval(description: string | null | undefined, maxChars = 1_500): string {
  let text = wellFormedText(description ?? '');
  text = text.replace(URL_RE, ' ');
  for (const pattern of BOILERPLATE_RE) text = text.replace(pattern, ' ');
  text = text.replace(VIEW_COUNT_RE, ' ');
  text = text.replace(HASHTAG_RE, ' ');
  text = text.replace(/\s+\.(?=\s|$)/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return truncateWellFormed(text, maxChars).trim();
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
