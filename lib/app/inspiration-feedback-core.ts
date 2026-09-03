import { CHANNEL_ID_RE, VIDEO_ID_RE } from './channels-core';
import { INSPIRATION_DISTANCES, type InspirationDistance } from '../semantic/inspiration';

export const INSPIRATION_DECISIONS = ['saved', 'dismissed', 'clear'] as const;
export type InspirationDecision = typeof INSPIRATION_DECISIONS[number];

export interface InspirationFeedbackInput {
  targetChannelId: string;
  videoId: string;
  distance: InspirationDistance;
  decision: InspirationDecision;
  rank: number;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseInspirationFeedback(input: Record<string, unknown>): InspirationFeedbackInput {
  const targetChannelId = text(input.target_channel_id);
  const videoId = text(input.video_id);
  const distance = text(input.distance) as InspirationDistance;
  const decision = text(input.decision) as InspirationDecision;
  const rank = Number(text(input.rank));
  if (!CHANNEL_ID_RE.test(targetChannelId)) throw new Error('invalid target channel');
  if (!VIDEO_ID_RE.test(videoId)) throw new Error('invalid candidate video');
  if (!INSPIRATION_DISTANCES.includes(distance)) throw new Error('invalid inspiration distance');
  if (!INSPIRATION_DECISIONS.includes(decision)) throw new Error('invalid inspiration decision');
  if (!Number.isInteger(rank) || rank < 1 || rank > 24) throw new Error('invalid inspiration rank');
  return { targetChannelId, videoId, distance, decision, rank };
}

export function validateInspirationFeedbackReceipt(
  input: InspirationFeedbackInput,
  returnedResults: Array<{ videoId: string; rank: number }>,
): InspirationFeedbackInput {
  const isReturnedResult = returnedResults.some(
    (result) => result.videoId === input.videoId && result.rank === input.rank,
  );
  if (!isReturnedResult) throw new Error('feedback must reference an exact returned result');
  return input;
}
