// Inspect the relative niche buckets for a channel: the thresholds derived from its own score
// spread, the size of each bucket, and the last few entries of near and adjacent so the boundary
// itself is readable.
//
// Usage: npx tsx scripts/semantic/channel-buckets.ts --channel UC... [--limit 2000]
import { channelRelations, RelatedChannel } from '../../lib/semantic/channel-relations';
import { argValue, intArg, runMain } from './common';

function tail(label: string, entries: RelatedChannel[], n = 5): void {
  console.log(`\n-- last ${Math.min(n, entries.length)} of ${label} (${entries.length})`);
  for (const entry of entries.slice(-n)) {
    console.log(`${entry.score.toFixed(3)}  ${entry.channel_name}  · ${entry.medoid_title ?? ''}`);
  }
}

async function main(): Promise<void> {
  const channelId = argValue(process.argv, '--channel');
  if (!channelId) throw new Error('--channel UC... is required');
  const relations = await channelRelations(channelId, { limit: intArg(process.argv, '--limit') ?? 2_000 });
  const { thresholds } = relations;
  console.log(JSON.stringify({
    channel_id: channelId,
    near_min: +thresholds.near_min.toFixed(4), adjacent_min: +thresholds.adjacent_min.toFixed(4),
    top: +thresholds.top.toFixed(4), anchor: +thresholds.anchor.toFixed(4), anchor_rank: thresholds.anchor_rank,
    near: relations.near.length, adjacent: relations.adjacent.length, far: relations.far_count,
  }));
  tail('near', relations.near);
  tail('adjacent', relations.adjacent);
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(main);
