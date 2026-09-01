// Pure decision logic for nightly-ingest Step 0: which touch_queue captures
// become newly enrolled channels, and which are already tracked somewhere.
//
// "Tracked" means the channel exists in ANY registry:
//   - competitor_youtube_channels (curated list)
//   - discovered_channels (prior enrollments)
//   - channels (legacy registry from the original system)
//   - videos.channel_id (corpus membership predates the registries)
// Enrolling a channel that is already tracked anywhere is the duplicate-
// tracking bug this module exists to prevent.

export interface KnownChannels {
  competitor: Set<string>;
  discovered: Set<string>;
  legacy: Set<string>;
  withVideos: Set<string>;
}

export interface QueueResolution {
  queueId: number;
  channelId: string | null; // null = could not resolve (deleted video, bad handle)
}

export interface EnrollmentPlan {
  toEnroll: string[]; // unique channel ids needing a discovered_channels row
  results: Map<number, string>; // queueId -> touch_queue.result label
}

export function isTracked(channelId: string, known: KnownChannels): boolean {
  return (
    known.competitor.has(channelId) ||
    known.discovered.has(channelId) ||
    known.legacy.has(channelId) ||
    known.withVideos.has(channelId)
  );
}

export function planEnrollment(
  resolutions: QueueResolution[],
  known: KnownChannels
): EnrollmentPlan {
  const toEnroll = new Set<string>();
  const results = new Map<number, string>();
  for (const { queueId, channelId } of resolutions) {
    if (!channelId) {
      results.set(queueId, 'unresolved');
    } else if (isTracked(channelId, known)) {
      results.set(queueId, `already-tracked:${channelId}`);
    } else {
      toEnroll.add(channelId);
      results.set(queueId, `enrolled:${channelId}`);
    }
  }
  return { toEnroll: [...toEnroll], results };
}
