import Anthropic from '@anthropic-ai/sdk';
import { q, one } from '../../admin/db';
import { ownerChannel } from './owner';
import { ownerBuckets, parseBrief, profilePrompt, type ThemeEvidence, type WinningVideo } from './profile-core';

export interface StatedAudience {
  name?: string; income?: string; occupation?: string; before?: string; after?: string;
  core_beliefs?: string; emotional_drivers?: string; specific_interests?: string; content_buckets?: string;
}
export interface StoredProfile { channel_id: string; version: number; name: string | null; sections: Record<string, unknown>; stated: StatedAudience; built_at: string }

export function parseStated(raw: unknown): StatedAudience {
  if (!raw || typeof raw !== 'object') return {};
  const fields = ['name','income','occupation','before','after','core_beliefs','emotional_drivers','specific_interests','content_buckets'] as const;
  const values = raw as Record<string, unknown>;
  return Object.fromEntries(fields.filter((key) => key in values).map((key) =>
    [key, typeof values[key] === 'string' ? values[key].trim().slice(0,
      ['name','income','occupation'].includes(key) ? 120 : 1500) : ''])) as StatedAudience;
}

async function evidence(channelId: string) {
  const [facts, themes, winners] = await Promise.all([
    q<{ dimension: string; key: string; value: string; window_end: string }>(
      `select dimension,key,value,window_end from channel_audience where channel_id=$1
       and window_end=(select max(window_end) from channel_audience where channel_id=$1)`, [channelId]),
    q<ThemeEvidence>(
      `select t.id,t.type,t.label,t.description,t.observation_count,t.video_count,t.author_count,
       coalesce((select json_agg(json_build_object('quote',o.quote,'video_id',o.video_id,'comment_id',o.comment_id)
         order by o.id) from audience_observations o where o.id=any(t.sample_observation_ids)), '[]'::json) quotes
       from audience_themes t where t.channel_id=$1 and t.profile_version=(
         select max(profile_version) from audience_themes where channel_id=$1)
       order by t.observation_count desc,t.id`, [channelId]),
    q<WinningVideo>(
      `select v.id video_id,v.title,sum(d.views)::integer views,
       sum(d.subscribers_gained)::integer subscribers_gained,
       round((1000.0*sum(d.subscribers_gained)/nullif(sum(d.views),0))::numeric,2)::float subs_per_1000
       from daily_analytics d join videos v on v.id=d.video_id
       where d.channel_id=$1 and d.date > (
         select max(window_end)-90 from channel_audience where channel_id=$1)
         and d.date <= (select max(window_end) from channel_audience where channel_id=$1)
       group by v.id,v.title having sum(d.views)>=1000
       order by sum(d.views) desc limit 60`, [channelId]),
  ]);
  return { facts, themes, winners };
}

function measured(facts: { dimension: string; key: string; value: string; window_end: string }[]) {
  const byDimension = (dimension: string) => facts.filter((r) => r.dimension === dimension);
  const age = byDimension('age_gender');
  const sum = (rows: typeof facts) => rows.reduce((n, r) => n + Number(r.value), 0);
  const locations = byDimension('country').slice().sort((a,b)=>Number(b.value)-Number(a.value)).slice(0,5);
  return {
    window_end: facts[0]?.window_end ?? null,
    demographics: [
      { field: 'gender', value: `${sum(age.filter((r)=>r.key.endsWith('|male'))).toFixed(1)}% male`, source: 'measured' },
      { field: 'age', value: `${sum(age.filter((r)=>/^age(35-44|45-54|55-64)\|/.test(r.key))).toFixed(1)}% ages 35–64`, source: 'measured' },
      { field: 'location', value: locations.map((r)=>`${r.key} ${Number(r.value).toLocaleString()} views`).join(' · '), source: 'measured' },
      { field: 'income', value: null, source: 'stated' },
      { field: 'occupation', value: null, source: 'stated' },
    ],
    devices: byDimension('device').map((r)=>({ key:r.key, views:Number(r.value) })),
    traffic_sources: byDimension('traffic_source').map((r)=>({ key:r.key, views:Number(r.value) })),
    subscribed_status: byDimension('subscribed_status').map((r)=>({ key:r.key, views:Number(r.value) })),
  };
}

export async function buildProfile(channelId: string, statedUpdate?: StatedAudience): Promise<StoredProfile> {
  await ownerChannel(channelId);
  const previous = await one<StoredProfile>(
    `select * from audience_profile where channel_id=$1 order by version desc limit 1`, [channelId]);
  const stated = parseStated({ ...(previous?.stated ?? {}), ...(statedUpdate ?? {}) });
  const { facts, themes, winners } = await evidence(channelId);
  if (!facts.length || !themes.length || !winners.length) throw new Error('audience evidence is incomplete');
  ownerBuckets(stated.content_buckets, winners);
  const client = new Anthropic();
  const response = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 8192,
    messages: [{ role: 'user', content: profilePrompt(themes, winners, stated) }] });
  if (response.stop_reason !== 'end_turn') throw new Error(`profile model incomplete: ${response.stop_reason}`);
  const text = response.content.filter((b)=>b.type==='text').map((b)=>b.text).join('');
  const inferred = parseBrief(text, themes, winners);
  const sections = {
    ...inferred,
    ...measured(facts),
    transformation: {
      before: stated.before ? { text: stated.before, source: 'stated' } : null,
      after: stated.after ? { text: stated.after, source: 'stated' } : null,
    },
  };
  const version = Number(previous?.version ?? 0) + 1;
  const saved = await q<StoredProfile>(
    `insert into audience_profile (channel_id,version,name,sections,stated)
     values ($1,$2,$3,$4::jsonb,$5::jsonb) returning *`,
    [channelId,version,stated.name || null,JSON.stringify(sections),JSON.stringify(stated)]);
  return saved[0];
}

export async function latestProfile(channelId: string): Promise<StoredProfile | null> {
  await ownerChannel(channelId);
  return one<StoredProfile>(`select * from audience_profile where channel_id=$1 order by version desc limit 1`, [channelId]);
}

export async function profileEvidence(channelId: string) {
  await ownerChannel(channelId);
  return evidence(channelId);
}
