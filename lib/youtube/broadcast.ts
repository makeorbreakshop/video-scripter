/** Persist YouTube's broadcast timing separately from the mutable publication timestamp.
 * concurrentViewers is intentionally absent: it is not a cumulative view count.
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

export function broadcastMetadata(item: any): Record<string, unknown> | null {
  const details = isObject(item?.liveStreamingDetails) ? item.liveStreamingDetails : null;
  const status = item?.snippet?.liveBroadcastContent;
  if (!details && status !== 'live' && status !== 'upcoming') return null;
  const times: Record<string, string> = {};
  for (const key of ['actualStartTime', 'actualEndTime', 'scheduledStartTime', 'scheduledEndTime']) {
    const value = details?.[key];
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) times[key] = value;
  }
  return { live_streaming_details: times, live_broadcast_content: status ?? null };
}

export function broadcastContext(video: { published_at: string; duration?: string | null; metadata?: any }, now: number, observations: { at: string | Date; views: number | string }[] = []) {
  const details = isObject(video.metadata?.live_streaming_details) ? video.metadata.live_streaming_details : null;
  const status = video.metadata?.live_broadcast_content;
  const isBroadcast = details != null || status === 'live' || status === 'upcoming' || video.duration === 'P0D';
  const start = details?.actualStartTime;
  const startedAt = typeof start === 'string' && Number.isFinite(Date.parse(start)) && Date.parse(start) <= now ? start : null;
  const recorded = observations.filter(o => Number.isFinite(Number(o.views)) && Number(o.views) >= 0)
    .map(o => new Date(o.at).getTime()).filter(t => Number.isFinite(t) && t <= now);
  const fallback = isBroadcast && !startedAt
    ? Math.min(new Date(video.published_at).getTime(), ...recorded) : new Date(video.published_at).getTime();
  return {
    isBroadcast,
    chartOriginAt: startedAt ?? new Date(fallback).toISOString(),
    broadcastNotice: !isBroadcast ? null : startedAt
      ? 'Livestream · views since stream start. Comparison and forecast are not yet available for livestreams.'
      : 'Livestream start time is unknown. Showing recorded views only; no reconstructed history or forecast.',
    timeLabel: !isBroadcast ? null : startedAt ? 'Stream started' : 'Published · stream start unknown',
  };
}
