// Channel groups, membership and notify: the per-user reads and writes behind
// /app/channels. Direct Postgres only (lib/admin/db.ts) — never supabase-js.
//
// Every statement here is predicated on user_id (and often channel_id), so each one probes
// channel_groups_user_position_idx / channel_group_members_user_channel_idx or the primary
// key. Nothing scans.
import { q, one } from '../admin/db';
import { nextGroupColor, normalizeGroupName, isGroupColor, type GroupColor } from './groups-view';

export interface ChannelGroup {
  id: string;
  name: string;
  color: GroupColor | string;
  position: number;
  created_at: string;
}

export class GroupNameTakenError extends Error {}

export async function listGroups(userId: string): Promise<ChannelGroup[]> {
  return q<ChannelGroup>(
    `select id, name, color, position, created_at
       from channel_groups where user_id = $1
      order by position asc, created_at asc`,
    [userId]
  );
}

/** groupId -> channel ids, and channelId -> group ids, in one read of the user's rows. */
export async function listMemberships(userId: string): Promise<Record<string, string[]>> {
  const rows = await q<{ channel_id: string; group_id: string }>(
    `select channel_id, group_id from channel_group_members where user_id = $1`,
    [userId]
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.channel_id] ||= []).push(r.group_id);
  return out;
}

/** Create a group. The colour is the next one in the palette, by how many exist already. */
export async function createGroup(userId: string, rawName: string): Promise<ChannelGroup> {
  const name = normalizeGroupName(rawName);
  if (!name) throw new Error('A group needs a name.');
  const agg = await one<{ n: string; p: number | null }>(
    `select count(*) as n, max(position) as p from channel_groups where user_id = $1`,
    [userId]
  );
  const count = parseInt(agg?.n || '0', 10);
  const row = await one<ChannelGroup>(
    `insert into channel_groups (user_id, name, color, position)
     values ($1, $2, $3, $4)
     on conflict (user_id, name) do nothing
     returning id, name, color, position, created_at`,
    [userId, name, nextGroupColor(count), (agg?.p ?? -1) + 1]
  );
  if (!row) throw new GroupNameTakenError(`You already have a group called ${name}.`);
  return row;
}

export async function renameGroup(userId: string, groupId: string, rawName: string): Promise<ChannelGroup | null> {
  const name = normalizeGroupName(rawName);
  if (!name) throw new Error('A group needs a name.');
  const clash = await one<{ id: string }>(
    `select id from channel_groups where user_id = $1 and name = $2 and id <> $3`,
    [userId, name, groupId]
  );
  if (clash) throw new GroupNameTakenError(`You already have a group called ${name}.`);
  return one<ChannelGroup>(
    `update channel_groups set name = $3 where user_id = $1 and id = $2
     returning id, name, color, position, created_at`,
    [userId, groupId, name]
  );
}

/** Recolour a group — only ever to a palette key. */
export async function recolorGroup(userId: string, groupId: string, color: string): Promise<ChannelGroup | null> {
  if (!isGroupColor(color)) throw new Error('Not a group colour.');
  return one<ChannelGroup>(
    `update channel_groups set color = $3 where user_id = $1 and id = $2
     returning id, name, color, position, created_at`,
    [userId, groupId, color]
  );
}

export async function deleteGroup(userId: string, groupId: string): Promise<boolean> {
  const del = await q<{ id: string }>(
    `delete from channel_groups where user_id = $1 and id = $2 returning id`,
    [userId, groupId]
  );
  return del.length > 0;
}

/** Reorder: the given ids take positions 0..n-1, in the order handed in. */
export async function reorderGroups(userId: string, ids: string[]): Promise<void> {
  if (!ids?.length) return;
  await q(
    `update channel_groups g set position = v.pos
       from (select unnest($2::uuid[]) as id, generate_subscripts($2::uuid[], 1) - 1 as pos) v
      where g.user_id = $1 and g.id = v.id`,
    [userId, ids]
  );
}

/** Put a set of channels into a group. Idempotent; only ever the user's own group. */
export async function addToGroup(userId: string, groupId: string, channelIds: string[]): Promise<number> {
  const ids = uniq(channelIds);
  if (!ids.length) return 0;
  const rows = await q<{ channel_id: string }>(
    `insert into channel_group_members (group_id, user_id, channel_id)
     select g.id, $1, c.channel_id
       from channel_groups g
       join unnest($3::text[]) as c(channel_id) on true
       join user_channels uc on uc.user_id = $1 and uc.channel_id = c.channel_id
      where g.user_id = $1 and g.id = $2
     on conflict (group_id, channel_id) do nothing
     returning channel_id`,
    [userId, groupId, ids]
  );
  return rows.length;
}

export async function removeFromGroup(userId: string, groupId: string, channelIds: string[]): Promise<number> {
  const ids = uniq(channelIds);
  if (!ids.length) return 0;
  const rows = await q<{ channel_id: string }>(
    `delete from channel_group_members
      where user_id = $1 and group_id = $2 and channel_id = any($3::text[])
     returning channel_id`,
    [userId, groupId, ids]
  );
  return rows.length;
}

// ------------------------------------------------------------------- notify --

export async function notifyCount(userId: string): Promise<number> {
  const row = await one<{ n: string }>(
    `select count(*) as n from user_channels where user_id = $1 and notify`,
    [userId]
  );
  return parseInt(row?.n || '0', 10);
}

/** Switch notify on or off for a set of the user's channels. Returns how many moved. */
export async function setNotify(userId: string, channelIds: string[], on: boolean): Promise<number> {
  const ids = uniq(channelIds);
  if (!ids.length) return 0;
  const rows = await q<{ channel_id: string }>(
    `update user_channels set notify = $3
      where user_id = $1 and channel_id = any($2::text[]) and notify is distinct from $3
     returning channel_id`,
    [userId, ids, on]
  );
  return rows.length;
}

/** How many of these are currently off — what a bulk "Notify" would add. */
export async function notifyOffCount(userId: string, channelIds: string[]): Promise<number> {
  const ids = uniq(channelIds);
  if (!ids.length) return 0;
  const row = await one<{ n: string }>(
    `select count(*) as n from user_channels
      where user_id = $1 and channel_id = any($2::text[]) and not notify`,
    [userId, ids]
  );
  return parseInt(row?.n || '0', 10);
}

function uniq(ids: string[] | null | undefined): string[] {
  return Array.from(new Set((ids || []).filter((s) => typeof s === 'string' && s.length > 0)));
}
