// Channel identity: avatar, title and the headline counts, cached in channel_meta.
//
// The write side is fed by the channels.list responses we already pay for
// (lib/app/channels.ts on resolve/track, scripts/channel-meta-backfill.ts in bulk),
// so rendering an avatar never costs a YouTube unit.
//
// Direct Postgres only (lib/admin/db.ts) — never supabase-js.
import { q } from '../admin/db';

export interface ChannelMeta {
  channel_id: string;
  title: string | null;
  avatar_url: string | null;
  subscriber_count: number | null;
  video_count: number | null;
  fetched_at: string;
}

/** The channels.list item shape we care about — pure, so it is testable without the network. */
export interface ChannelsListItem {
  id?: string;
  snippet?: { title?: string; thumbnails?: Record<string, { url?: string } | undefined> };
  statistics?: { subscriberCount?: string; videoCount?: string };
}

/** Prefer a crisp avatar but take whatever size YouTube gave us. */
export function pickAvatar(thumbs: Record<string, { url?: string } | undefined> | undefined): string | null {
  if (!thumbs) return null;
  for (const size of ['high', 'medium', 'default']) {
    const url = thumbs[size]?.url;
    if (url) return url;
  }
  return null;
}

function int(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export type MetaUpsert = {
  channel_id: string;
  title: string | null;
  avatar_url: string | null;
  subscriber_count: number | null;
  video_count: number | null;
};

/** channels.list item -> the row we store. Returns null for an item with no id. */
export function metaFromListItem(item: ChannelsListItem | null | undefined): MetaUpsert | null {
  if (!item?.id) return null;
  return {
    channel_id: item.id,
    title: item.snippet?.title ?? null,
    avatar_url: pickAvatar(item.snippet?.thumbnails),
    subscriber_count: int(item.statistics?.subscriberCount),
    video_count: int(item.statistics?.videoCount),
  };
}

/** Upsert one or many rows. Never throws — a missing avatar must not fail a track. */
export async function saveChannelMeta(rows: (MetaUpsert | null | undefined)[]): Promise<number> {
  const good = rows.filter((r): r is MetaUpsert => !!r?.channel_id);
  let n = 0;
  for (const r of good) {
    try {
      await q(
        `insert into channel_meta (channel_id, title, avatar_url, subscriber_count, video_count, fetched_at)
         values ($1,$2,$3,$4,$5, now())
         on conflict (channel_id) do update
           set title = coalesce(excluded.title, channel_meta.title),
               avatar_url = coalesce(excluded.avatar_url, channel_meta.avatar_url),
               subscriber_count = coalesce(excluded.subscriber_count, channel_meta.subscriber_count),
               video_count = coalesce(excluded.video_count, channel_meta.video_count),
               fetched_at = now()`,
        [r.channel_id, r.title, r.avatar_url, r.subscriber_count, r.video_count]
      );
      n++;
    } catch (e: any) {
      console.error(`saveChannelMeta ${r.channel_id}: ${e.message}`);
    }
  }
  return n;
}

/** channel_id -> avatar url, for the ids that have one. One indexed lookup. */
export async function avatarsFor(channelIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set((channelIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const rows = await q<{ channel_id: string; avatar_url: string | null }>(
    `select channel_id, avatar_url from channel_meta where channel_id = any($1)`,
    [ids]
  ).catch(() => [] as { channel_id: string; avatar_url: string | null }[]);
  const out: Record<string, string> = {};
  for (const r of rows) if (r.avatar_url) out[r.channel_id] = r.avatar_url;
  return out;
}

export async function channelMeta(channelId: string): Promise<ChannelMeta | null> {
  const rows = await q<ChannelMeta>(
    `select channel_id, title, avatar_url, subscriber_count, video_count, fetched_at
       from channel_meta where channel_id = $1`,
    [channelId]
  ).catch(() => [] as ChannelMeta[]);
  return rows[0] ?? null;
}
