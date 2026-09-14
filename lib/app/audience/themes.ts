import Anthropic from '@anthropic-ai/sdk';
import { q } from '../../admin/db';
import { OBSERVATION_TYPES, parseModelJson, type ObservationType } from './extraction-core';
import { themePrompt, verifiedThemes, type ThemeObservation } from './themes-core';
import { ownerChannel } from './owner';

export interface ThemeReceipt { themes: number; assigned: number; calls: number }

export async function buildThemes(channelId: string, version: number): Promise<ThemeReceipt> {
  await ownerChannel(channelId);
  const rows = await q<ThemeObservation>(
    `select id, type, summary from audience_observations where channel_id = $1 order by type,id limit 3000`, [channelId]);
  const receipt: ThemeReceipt = { themes: 0, assigned: 0, calls: 0 };
  const client = new Anthropic();
  // A failed retry for the same version must not accumulate duplicate clusters.
  await q(`update audience_observations set theme_id = null where channel_id = $1`, [channelId]);
  await q(`delete from audience_themes where channel_id = $1 and profile_version = $2`, [channelId, version]);
  for (const type of OBSERVATION_TYPES) {
    const group = rows.filter((o) => o.type === type);
    if (group.length < 5) continue;
    const response = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 4096,
      messages: [{ role: 'user', content: themePrompt(type, group) }] });
    if (response.stop_reason !== 'end_turn') throw new Error(`theme model incomplete: ${response.stop_reason}`);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const themes = verifiedThemes(parseModelJson(text), group);
    receipt.calls++;
    for (const theme of themes) {
      const saved = await q<{ id: string }>(
        `insert into audience_themes (channel_id, profile_version, type, label, description, observation_count, sample_observation_ids)
         values ($1,$2,$3,$4,$5,$6,$7::bigint[]) returning id`,
        [channelId, version, type, theme.label, theme.description, theme.observation_ids.length, theme.observation_ids.slice(0, 5)]);
      await q(`update audience_observations set theme_id = $1 where channel_id = $2 and type = $3 and id = any($4::bigint[])`,
        [saved[0].id, channelId, type, theme.observation_ids]);
      receipt.themes++;
      receipt.assigned += theme.observation_ids.length;
    }
  }
  return receipt;
}
