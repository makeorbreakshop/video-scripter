import Anthropic from '@anthropic-ai/sdk';
import { q, getPool } from '../../admin/db';
import { OBSERVATION_TYPES, parseModelJson, type ObservationType } from './extraction-core';
import { consolidationPrompt, themePrompt, verifiedConsolidation, verifiedThemes,
  type CandidateTheme, type ThemeObservation, type ThemeInput } from './themes-core';
import { ownerChannel } from './owner';

export interface ThemeReceipt { themes: number; assigned: number; calls: number }

/** A new profile version can reuse unchanged evidence without another long model run. */
export async function carryThemes(channelId: string, version: number): Promise<ThemeReceipt> {
  await ownerChannel(channelId);
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const { rows: existingTarget } = await client.query<{ n: number }>(
      `select count(*)::integer n from audience_themes where channel_id=$1 and profile_version=$2`, [channelId,version]);
    if (existingTarget[0].n > 0) {
      await client.query('rollback');
      return buildThemes(channelId, version);
    }
    const { rows: prior } = await client.query<{ id: string; type: ObservationType; label: string; description: string;
      observation_count: number; video_count: number; author_count: number; sample_observation_ids: string[] }>(
      `select id,type,label,description,observation_count,video_count,author_count,sample_observation_ids
       from audience_themes where channel_id=$1 and profile_version=(
         select max(profile_version) from audience_themes where channel_id=$1 and profile_version < $2)
       order by id`, [channelId,version]);
    if (!prior.length) {
      await client.query('rollback');
      return buildThemes(channelId, version);
    }
    for (const theme of prior) {
      const { rows: saved } = await client.query<{ id: string }>(
        `insert into audience_themes (channel_id,profile_version,type,label,description,
         observation_count,video_count,author_count,sample_observation_ids)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint[]) returning id`,
        [channelId,version,theme.type,theme.label,theme.description,theme.observation_count,
          theme.video_count,theme.author_count,theme.sample_observation_ids]);
      await client.query(`update audience_observations set theme_id=$1 where channel_id=$2 and theme_id=$3`,
        [saved[0].id,channelId,theme.id]);
    }
    await client.query('commit');
    return { themes: prior.length, assigned: prior.reduce((n,t)=>n+Number(t.observation_count),0), calls: 0 };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

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
    const batches = Array.from({ length: Math.ceil(group.length / 40) }, (_, i) => group.slice(i * 40, (i + 1) * 40));
    const partial: ThemeInput[][] = new Array(batches.length);
    let cursor = 0;
    async function clusterPart(batch: ThemeObservation[]): Promise<ThemeInput[]> {
      let response;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 8192,
            messages: [{ role: 'user', content: themePrompt(type, batch) }] });
          break;
        } catch (error) {
          if (attempt >= 2 || (error as { status?: number }).status !== 429) throw error;
          await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
        }
      }
      if (response.stop_reason !== 'end_turn') {
        if (response.stop_reason === 'max_tokens' && batch.length > 5) {
          const middle = Math.floor(batch.length / 2);
          return [...await clusterPart(batch.slice(0,middle)), ...await clusterPart(batch.slice(middle))];
        }
        throw new Error(`theme batch incomplete: ${type} ${batch.length} ${response.stop_reason}`);
      }
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      try {
        const result = verifiedThemes(parseModelJson(text), batch);
        receipt.calls++;
        return result;
      } catch (error) {
        if (batch.length > 5) {
          const middle = Math.floor(batch.length / 2);
          return [...await clusterPart(batch.slice(0,middle)), ...await clusterPart(batch.slice(middle))];
        }
        throw error;
      }
    }
    async function clusterWorker() {
      while (cursor < batches.length) {
        const index = cursor++;
        partial[index] = await clusterPart(batches[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(6,batches.length) }, () => clusterWorker()));
    let candidates: CandidateTheme[] = partial.flat().map((theme, i) => ({ ...theme, candidate_id: i + 1 }));
    async function mergePart(chunk: CandidateTheme[]): Promise<ThemeInput[]> {
      const response = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 8192,
        messages: [{ role: 'user', content: consolidationPrompt(type, chunk) }] });
      if (response.stop_reason !== 'end_turn') {
        if (response.stop_reason === 'max_tokens' && chunk.length > 3) {
          const middle = Math.floor(chunk.length / 2);
          return [...await mergePart(chunk.slice(0,middle)), ...await mergePart(chunk.slice(middle))];
        }
        throw new Error(`theme consolidation incomplete: ${type} ${chunk.length} ${response.stop_reason}`);
      }
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      try {
        const result = verifiedConsolidation(parseModelJson(text), chunk);
        receipt.calls++;
        return result;
      } catch (error) {
        if (chunk.length > 3) {
          const middle = Math.floor(chunk.length / 2);
          return [...await mergePart(chunk.slice(0,middle)), ...await mergePart(chunk.slice(middle))];
        }
        throw error;
      }
    }
    let firstRound = group.length > 40 && candidates.length > 1;
    while (candidates.length > 8 || firstRound) {
      firstRound = false;
      const chunks = Array.from({ length: Math.ceil(candidates.length / 24) }, (_, i) => candidates.slice(i * 24, (i + 1) * 24));
      const merged = (await Promise.all(chunks.map((chunk) => mergePart(chunk)))).flat();
      candidates = merged.map((theme, i) => ({ ...theme, candidate_id: i + 1 }));
      if (!candidates.length) break;
    }
    const themes: ThemeInput[] = candidates;
    for (const theme of themes) {
      const saved = await q<{ id: string }>(
        `insert into audience_themes (channel_id, profile_version, type, label, description,
           observation_count, video_count, author_count, sample_observation_ids)
         select $1,$2,$3,$4,$5,count(*)::integer,count(distinct o.video_id)::integer,
           count(distinct c.author_hash)::integer,$6::bigint[]
         from audience_observations o join audience_comments c using (comment_id)
         where o.channel_id=$1 and o.id=any($7::bigint[]) returning id`,
        [channelId, version, type, theme.label, theme.description, theme.observation_ids.slice(0, 5), theme.observation_ids]);
      await q(`update audience_observations set theme_id = $1 where channel_id = $2 and type = $3 and id = any($4::bigint[])`,
        [saved[0].id, channelId, type, theme.observation_ids]);
      receipt.themes++;
      receipt.assigned += theme.observation_ids.length;
    }
  }
  return receipt;
}
