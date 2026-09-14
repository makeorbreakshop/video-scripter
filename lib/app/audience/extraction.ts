import Anthropic from '@anthropic-ai/sdk';
import { q } from '../../admin/db';
import { batchesByVideo, extractionPrompt, parseModelJson, verifiedObservations, type MiningComment } from './extraction-core';
import { ownerChannel } from './owner';

export interface MineReceipt { comments: number; observations: number; rejected: number; calls: number }

export async function mineComments(channelId: string, opts: { limit?: number; sample?: boolean } = {}): Promise<MineReceipt> {
  await ownerChannel(channelId);
  const limit = Math.min(3000, Math.max(0, opts.limit ?? 3000));
  const comments = opts.sample ? await q<MiningComment>(
    `select comment_id, video_id, text from (
       select comment_id, video_id, text, row_number() over (partition by video_id order by published_at desc) as rank
       from audience_comments where channel_id = $1 and mined_at is null
     ) sampled where rank <= 10 order by video_id, rank limit $2`, [channelId, limit]) : await q<MiningComment>(
    `select comment_id, video_id, text from audience_comments where channel_id = $1 and mined_at is null
     order by video_id, published_at desc limit $2`, [channelId, limit]);
  const receipt: MineReceipt = { comments: 0, observations: 0, rejected: 0, calls: 0 };
  if (!comments.length) return receipt;
  const client = new Anthropic();
  for (const batch of batchesByVideo(comments)) {
    const response = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 4096,
      messages: [{ role: 'user', content: extractionPrompt(batch) }] });
    if (response.stop_reason !== 'end_turn') throw new Error(`extractor incomplete: ${response.stop_reason}`);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let raw: unknown;
    try { raw = parseModelJson(text); }
    catch (error) { throw new Error(`invalid extraction JSON (${(error as Error).message}): ${JSON.stringify(text.slice(0, 400))}`); }
    const verified = verifiedObservations(raw, batch);
    receipt.calls++;
    receipt.rejected += Array.isArray(raw) ? raw.length - verified.length : 0;
    const videoByComment = new Map(batch.map((c) => [c.comment_id, c.video_id]));
    for (const o of verified) {
      await q(`insert into audience_observations (channel_id, comment_id, video_id, type, quote, summary, confidence)
        values ($1,$2,$3,$4,$5,$6,$7) on conflict (comment_id, type, quote) do nothing`,
      [channelId, o.comment_id, videoByComment.get(o.comment_id), o.type, o.quote, o.summary, o.confidence]);
    }
    await q(`update audience_comments set mined_at = now() where channel_id = $1 and comment_id = any($2::text[])`,
      [channelId, batch.map((c) => c.comment_id)]);
    receipt.comments += batch.length;
    receipt.observations += verified.length;
  }
  return receipt;
}
