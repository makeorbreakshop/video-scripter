import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  CorpusEligibilityRow,
  V4Lane,
  V4Task,
  freezeV4CorpusManifest,
  freezeV4TaskManifest,
  isEligibleCorpusRow,
} from '../../lib/semantic/eval-v4';
import { CHANNELS_COLLECTION, SemanticQdrant } from '../../lib/semantic/qdrant';
import { chunks, db, READ_BATCH_SIZE, runMain } from './common';

const OUT_DIR = path.resolve('docs/prd/semantic-eval-v4');
const AS_OF = '2026-09-03T09:30:00-04:00';
const VIDEO_PREDICATE = [
  "v.published_at between as_of - interval '365 days' and as_of",
  "coalesce(v.is_short, false) = false",
  "coalesce(v.duration, '') <> 'P0D'",
  "nullif(btrim(v.title), '') is not null",
  'v.channel_id is not null',
  'coalesce(v.is_institutional, false) = false',
  's.score >= 2',
  "s.confidence in ('likely', 'confirmed')",
  's.n_baseline >= 5',
  's.baseline >= 5000',
  's.scored_at <= as_of',
].join(' and ');
const CHANNEL_PREDICATE = [
  'channel id is present in channel_directory, channel_meta, and channels_v1 at as_of',
  "nullif(btrim(channel_directory.name), '') is not null",
  'channel_meta.subscriber_count is not null',
  'at least five non-institutional long-form videos in the 365-day window',
].join('; ');

type TaskSpec =
  | { id: string; lane: 'J1'; split: 'dev' | 'heldout'; query: string; targetChannelId: string }
  | { id: string; lane: 'J2' | 'J5'; split: 'dev' | 'heldout'; seedChannelId: string; intent: string }
  | { id: string; lane: 'J3'; split: 'dev' | 'heldout'; seedVideoId: string; intent: string }
  | { id: string; lane: 'J4'; split: 'dev' | 'heldout'; query: string; intent: string };

// Authored before any v4 retrieval run. SQL below resolves and verifies identities only.
const TASK_SPECS: TaskSpec[] = [
  { id: 'j1-make-or-break', lane: 'J1', split: 'dev', query: 'Make or Break Shop', targetChannelId: 'UCjWkNxpp3UHdEavpM_19--Q' },
  { id: 'j1-mkbhd', lane: 'J1', split: 'heldout', query: 'MKBHD', targetChannelId: 'UCBJycsmduvYEL83R_U4JriQ' },
  { id: 'j2-maker-channel', lane: 'J2', split: 'dev', seedChannelId: 'UCjWkNxpp3UHdEavpM_19--Q', intent: 'Find channels with meaningfully useful audience or subject overlap for Make or Break Shop.' },
  { id: 'j2-tech-review-channel', lane: 'J2', split: 'dev', seedChannelId: 'UCBJycsmduvYEL83R_U4JriQ', intent: 'Find channels with meaningfully useful audience or subject overlap for Marques Brownlee.' },
  { id: 'j2-build-explainer-channel', lane: 'J2', split: 'heldout', seedChannelId: 'UCiDJtJKMICpb9B1qf7qjEOA', intent: 'Find channels with meaningfully useful audience or subject overlap for Adam Savage’s Tested.' },
  { id: 'j3-laser-product-explainer', lane: 'J3', split: 'dev', seedVideoId: '9mVaKmmhYFc', intent: 'Find outlier videos similar in topic or packaging to this laser product explainer.' },
  { id: 'j3-kitchen-hacks-list', lane: 'J3', split: 'heldout', seedVideoId: 'MpGDoiSH_PQ', intent: 'Find outlier videos similar in topic or packaging to this practical hacks list.' },
  { id: 'j3-unusual-camera-demo', lane: 'J3', split: 'heldout', seedVideoId: 'v-_d2e7x4KA', intent: 'Find outlier videos similar in topic or packaging to this unusual technology demonstration.' },
  { id: 'j4-laser-engraver', lane: 'J4', split: 'dev', query: 'laser engraver', intent: 'Find current valid outliers about laser engravers.' },
  { id: 'j4-woodworking-jigs', lane: 'J4', split: 'dev', query: 'woodworking jigs', intent: 'Find current valid outliers about woodworking jigs.' },
  { id: 'j4-air-fryer-recipes', lane: 'J4', split: 'heldout', query: 'air fryer recipes', intent: 'Find current valid outliers about air fryer recipes.' },
  { id: 'j4-budget-camera-gear', lane: 'J4', split: 'heldout', query: 'budget camera gear', intent: 'Find current valid outliers about budget camera gear.' },
  { id: 'j5-maker-transfer', lane: 'J5', split: 'dev', seedChannelId: 'UCjWkNxpp3UHdEavpM_19--Q', intent: 'Find proven ideas from unrelated niches whose framing could transfer to Make or Break Shop.' },
  { id: 'j5-tech-transfer', lane: 'J5', split: 'dev', seedChannelId: 'UCBJycsmduvYEL83R_U4JriQ', intent: 'Find proven ideas from unrelated niches whose framing could transfer to Marques Brownlee.' },
  { id: 'j5-gardening-transfer', lane: 'J5', split: 'heldout', seedChannelId: 'UCSbyncU597LMwb3HhnAI_4w', intent: 'Find proven ideas from unrelated niches whose framing could transfer to Epic Gardening.' },
  { id: 'j5-build-transfer', lane: 'J5', split: 'heldout', seedChannelId: 'UCiDJtJKMICpb9B1qf7qjEOA', intent: 'Find proven ideas from unrelated niches whose framing could transfer to Adam Savage’s Tested.' },
];

const RUBRICS: Record<V4Lane, Record<string, unknown>> = {
  J1: { judgment: 'exact canonical channel id', metric: 'MRR' },
  J2: { scale: { 3: 'strong useful overlap', 2: 'useful adjacency', 1: 'weak background overlap', 0: 'not useful' } },
  J3: { dimensions: ['topic', 'packaging'], scale: { 3: 'strong', 2: 'partial', 1: 'weak', 0: 'none' } },
  J4: { scale: { 1: 'on-topic and valid guarded outlier', 0: 'off-topic or invalid outlier' } },
  J5: { labels: ['creative_adaptation', 'direct_application', 'background', 'none'], hit: 'creative_adaptation only' },
};

interface ChannelIdentity {
  channel_id: string;
  name: string;
  subscriber_count: string;
}

interface ChannelCorpusEvidence {
  channel_id: string;
  name: string;
  subscriber_count: number;
  eligible_video_count: number;
  doc_hash: string;
}

interface VideoIdentity {
  id: string;
  title: string;
  channel_id: string;
  channel_name: string;
}

interface VideoCorpusRow extends CorpusEligibilityRow {
  model_version: string;
}

async function qdrantChannelIds(): Promise<string[]> {
  const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
  const ids = new Set<string>();
  let offset: string | number | undefined;
  do {
    const page = await qdrant.scroll<{ channel_id?: string }>(CHANNELS_COLLECTION, { limit: 1_000, offset });
    for (const point of page.points) {
      if (point.payload.channel_id) ids.add(point.payload.channel_id);
    }
    offset = page.nextPageOffset;
  } while (offset != null);
  return [...ids];
}

async function channelUniverse(asOf: string): Promise<ChannelCorpusEvidence[]> {
  const qdrantIds = await qdrantChannelIds();
  const eligible: ChannelCorpusEvidence[] = [];
  for (const batch of chunks(qdrantIds, READ_BATCH_SIZE)) {
    const result = await db().query<{
      channel_id: string;
      name: string;
      subscriber_count: string;
      eligible_video_count: string;
      doc_hash: string;
    }>(
      `select input.channel_id, cd.name, cm.subscriber_count::text,
              count(*)::text as eligible_video_count, e.doc_hash
         from unnest($1::text[]) as input(channel_id)
         join channel_directory cd on cd.channel_id = input.channel_id
         join channel_meta cm on cm.channel_id = input.channel_id
         join embeddings_v1 e on e.entity = 'channel' and e.id = input.channel_id
         join videos v on v.channel_id = input.channel_id
        where nullif(btrim(cd.name), '') is not null
          and cm.subscriber_count is not null
          and v.published_at between $2::timestamptz - interval '365 days' and $2::timestamptz
          and coalesce(v.is_short, false) = false
          and coalesce(v.duration, '') <> 'P0D'
          and coalesce(v.is_institutional, false) = false
        group by input.channel_id, cd.name, cm.subscriber_count, e.doc_hash
       having count(*) >= 5
        order by input.channel_id`,
      [batch, asOf],
    );
    eligible.push(...result.rows.map((row) => ({
      channel_id: row.channel_id,
      name: row.name,
      subscriber_count: Number(row.subscriber_count),
      eligible_video_count: Number(row.eligible_video_count),
      doc_hash: row.doc_hash,
    })));
  }
  return eligible;
}

async function videoUniverse(asOf: string): Promise<VideoCorpusRow[]> {
  const result = await db().query<VideoCorpusRow>(
    `select v.id, v.channel_id, v.title, v.published_at, v.is_short, v.duration,
            v.is_institutional, s.score, s.confidence, s.n_baseline, s.baseline, s.scored_at, s.model_version
       from video_scores s
       join videos v on v.id = s.video_id
      where v.published_at between $1::timestamptz - interval '365 days' and $1::timestamptz
        and coalesce(v.is_short, false) = false
        and coalesce(v.duration, '') <> 'P0D'
        and nullif(btrim(v.title), '') is not null
        and v.channel_id is not null
        and coalesce(v.is_institutional, false) = false
        and s.score >= 2
        and s.confidence in ('likely', 'confirmed')
        and s.n_baseline >= 5
        and s.baseline >= 5000
        and s.scored_at <= $1::timestamptz
      order by s.score desc, v.id`,
    [asOf],
  );
  const invalid = result.rows.filter((row) => !isEligibleCorpusRow(row, asOf));
  if (invalid.length) throw new Error(`SQL corpus violated pure eligibility contract for ${invalid.length} rows`);
  return result.rows;
}

async function resolveTasks(channelIds: Set<string>): Promise<V4Task[]> {
  const taskChannelIds = [...new Set(TASK_SPECS.flatMap((task) => {
    if ('targetChannelId' in task) return [task.targetChannelId];
    if ('seedChannelId' in task) return [task.seedChannelId];
    return [];
  }))];
  const channelResult = await db().query<ChannelIdentity>(
    `select input.channel_id, cd.name, cm.subscriber_count::text
       from unnest($1::text[]) as input(channel_id)
       join channel_directory cd on cd.channel_id = input.channel_id
       join channel_meta cm on cm.channel_id = input.channel_id`,
    [taskChannelIds],
  );
  const channelById = new Map(channelResult.rows.map((row) => [row.channel_id, row]));
  for (const id of taskChannelIds) {
    if (!channelIds.has(id)) throw new Error(`task channel ${id} is absent from the frozen channel universe`);
    if (!channelById.has(id)) throw new Error(`task channel ${id} has no exact identity metadata`);
  }

  const taskVideoIds = TASK_SPECS.flatMap((task) => 'seedVideoId' in task ? [task.seedVideoId] : []);
  const videoResult = await db().query<VideoIdentity>(
    `select input.video_id as id, v.title, v.channel_id, coalesce(v.channel_name, cm.title, v.channel_id) as channel_name
       from unnest($1::text[]) as input(video_id)
       join videos v on v.id = input.video_id
       left join channel_meta cm on cm.channel_id = v.channel_id
      where nullif(btrim(v.title), '') is not null
        and v.channel_id is not null
        and coalesce(v.is_short, false) = false
        and coalesce(v.is_institutional, false) = false`,
    [taskVideoIds],
  );
  const videoById = new Map(videoResult.rows.map((row) => [row.id, row]));

  return TASK_SPECS.map((task): V4Task => {
    if (task.lane === 'J1') return {
      id: task.id, lane: task.lane, split: task.split, query: task.query, target_id: task.targetChannelId,
    };
    if (task.lane === 'J2' || task.lane === 'J5') {
      const channel = channelById.get(task.seedChannelId);
      if (!channel) throw new Error(`missing channel identity ${task.seedChannelId}`);
      return {
        id: task.id,
        lane: task.lane,
        split: task.split,
        intent: task.intent,
        seed: {
          channel_id: channel.channel_id,
          channel_name: channel.name,
          subscriber_count: Number(channel.subscriber_count),
        },
      };
    }
    if (task.lane === 'J3') {
      const video = videoById.get(task.seedVideoId);
      if (!video) throw new Error(`missing eligible video identity ${task.seedVideoId}`);
      return {
        id: task.id,
        lane: task.lane,
        split: task.split,
        intent: task.intent,
        seed: {
          video_id: video.id,
          title: video.title,
          channel_id: video.channel_id,
          channel_name: video.channel_name,
        },
      };
    }
    if ('query' in task) {
      return { id: task.id, lane: task.lane, split: task.split, query: task.query, intent: task.intent };
    }
    throw new Error(`unsupported task spec ${task.id}`);
  });
}

function evidenceHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function writeImmutableJson(filePath: string, value: unknown, force: boolean, pretty = false): Promise<void> {
  const content = `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    if (existing === content) return;
    if (!force) throw new Error(`refusing to replace frozen artifact ${filePath}; pass --force before any retrieval run`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.writeFile(filePath, content);
}

async function freeze(): Promise<void> {
  const force = process.argv.includes('--force');
  const [videos, channelEvidence] = await Promise.all([videoUniverse(AS_OF), channelUniverse(AS_OF)]);
  const channels = channelEvidence.map((row) => row.channel_id);
  const channelSet = new Set(channels);
  const tasks = await resolveTasks(channelSet);
  const modelCounts = new Map<string, number>();
  const videoChannels = new Set<string>();
  for (const row of videos) {
    modelCounts.set(row.model_version, (modelCounts.get(row.model_version) ?? 0) + 1);
    if (row.channel_id) videoChannels.add(row.channel_id);
  }
  const videoEvidence = videos
    .map((row) => ({
      id: row.id,
      channel_id: row.channel_id,
      published_at: row.published_at,
      model_version: row.model_version,
      scored_at: row.scored_at,
      score: Number(row.score),
      confidence: row.confidence,
      n_baseline: Number(row.n_baseline),
      baseline: Number(row.baseline),
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  channelEvidence.sort((a, b) => a.channel_id.localeCompare(b.channel_id));

  const taskManifest = freezeV4TaskManifest({ version: 4, as_of: AS_OF, tasks, rubrics: RUBRICS });
  const videoManifest = freezeV4CorpusManifest({
    version: 4,
    entity_type: 'video',
    as_of: AS_OF,
    predicate: VIDEO_PREDICATE,
    document_recipe: 'semantic-v4-title-channel-clean-description-v1',
    ids: videos.map((row) => row.id as string),
    source: {
      created_at_et: AS_OF,
      distinct_channels: videoChannels.size,
      eligibility_evidence_hash: evidenceHash(videoEvidence),
      score_model_versions: Object.fromEntries([...modelCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    },
  });
  const channelManifest = freezeV4CorpusManifest({
    version: 4,
    entity_type: 'channel',
    as_of: AS_OF,
    predicate: CHANNEL_PREDICATE,
    document_recipe: 'semantic-v4-channel-name-top20-viewed-365d-and-available-niches-v1',
    ids: channels,
    source: {
      created_at_et: AS_OF,
      eligibility_evidence_hash: evidenceHash(channelEvidence),
      qdrant_collection: CHANNELS_COLLECTION,
    },
  });

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeImmutableJson(path.join(OUT_DIR, 'tasks.json'), taskManifest, force, true),
    writeImmutableJson(path.join(OUT_DIR, 'video-corpus.json'), videoManifest, force),
    writeImmutableJson(path.join(OUT_DIR, 'channel-corpus.json'), channelManifest, force),
    writeImmutableJson(path.join(OUT_DIR, 'video-corpus-evidence.json'), videoEvidence, force),
    writeImmutableJson(path.join(OUT_DIR, 'channel-corpus-evidence.json'), channelEvidence, force),
  ]);
  console.log(JSON.stringify({
    as_of_et: AS_OF,
    tasks: taskManifest.tasks.length,
    task_hash: taskManifest.content_hash,
    videos: videoManifest.entity_count,
    video_channels: videoChannels.size,
    video_ids_hash: videoManifest.ids_hash,
    channels: channelManifest.entity_count,
    channel_ids_hash: channelManifest.ids_hash,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) runMain(freeze);
