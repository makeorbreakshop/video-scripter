import fs from 'fs/promises';
import path from 'path';
import { EvalQuery, freezeEvalManifest, SemanticJob, validateEvalManifest } from '../../lib/semantic/eval-v2';
import { db, runMain } from './common';

const OUT_DIR = path.resolve('docs/prd/semantic-eval-v2/queries');

interface JobQueries {
  queries: EvalQuery[];
}

const TOPIC_STRINGS = [
  'laser engraver',
  'air fryer recipes',
  'woodworking jigs',
  'beginner 3d printing',
  'cheap tool comparison',
  'home coffee setup',
  'gardening mistakes',
  'small shop storage',
  'budget camera gear',
  'AI workflow tools',
  'meal prep',
  'electric vehicle repair',
  'home theater setup',
  'beginner welding',
  'CNC router project',
  'sewing for beginners',
  'epoxy table',
  'camping gear test',
  'fitness transformation',
  'creator business',
  'thumbnail design',
  'smart home automation',
  'permaculture',
  'barbecue brisket',
  'motorcycle maintenance',
  'travel packing',
  'chess improvement',
  'gaming setup',
  'phone camera comparison',
  'DIY bathroom remodel',
  'budget kitchen upgrade',
  'solar power',
  'drone review',
  'personal finance',
  'real estate investing',
  'parenting routines',
  'baking sourdough',
  'music production',
  'Disney trip planning',
  'movie review',
];

async function knownItemQueries(): Promise<JobQueries> {
  const rows = await db().query<{ channel_id: string; name: string; handle: string | null }>(
    `select channel_id, name, handle
       from channel_directory
      where name is not null
      order by video_count desc nulls last, channel_id
      limit 60`,
  );
  const queries = rows.rows.flatMap((row, index) => {
    const base = [{
      id: `j1-name-${String(index + 1).padStart(3, '0')}`,
      query: row.name,
      target_id: row.channel_id,
      source: 'channel_directory_video_count',
    }];
    if (!row.handle) return base;
    return [...base, {
      id: `j1-handle-${String(index + 1).padStart(3, '0')}`,
      query: `@${row.handle.replace(/^@/, '')}`,
      target_id: row.channel_id,
      source: 'channel_directory_handle',
    }];
  }).slice(0, 100);
  return { queries };
}

async function seedChannels(job: 'J2' | 'J5', limit: number): Promise<JobQueries> {
  const rows = await db().query<{
    channel_id: string;
    name: string;
    subscriber_count: string | null;
    topic_domain: string | null;
    video_count: string;
  }>(
    `with recent as (
       select v.channel_id,
              max(coalesce(cm.title, v.channel_name, v.channel_id)) as name,
              max(cm.subscriber_count)::bigint as subscriber_count,
              mode() within group (order by v.topic_domain) filter (where v.topic_domain is not null) as topic_domain,
              count(*)::bigint as video_count
         from videos v
         left join channel_meta cm on cm.channel_id = v.channel_id
        where v.published_at >= now() - interval '365 days'
          and coalesce(v.is_short,false) = false
          and coalesce(v.duration,'') <> 'P0D'
          and v.channel_id is not null
        group by v.channel_id
     )
     select channel_id, name, subscriber_count::text, topic_domain, video_count::text
       from recent
      where video_count >= 5
      order by coalesce(topic_domain, ''), coalesce(subscriber_count, 0), md5(channel_id)
      limit $1`,
    [limit],
  );
  return {
    queries: rows.rows.map((row, index) => ({
      id: `${job.toLowerCase()}-seed-${String(index + 1).padStart(3, '0')}`,
      channel_id: row.channel_id,
      channel_name: row.name,
      subscriber_count: row.subscriber_count == null ? null : Number(row.subscriber_count),
      topic_domain: row.topic_domain,
      video_count: Number(row.video_count),
      source: 'stratified_recent_channel_seed_not_truth',
    })),
  };
}

async function seedVideos(): Promise<JobQueries> {
  const rows = await db().query<{
    id: string;
    title: string;
    channel_id: string;
    channel_name: string;
    topic_domain: string | null;
    view_count: string | null;
  }>(
    `select v.id, v.title, v.channel_id, coalesce(v.channel_name, v.channel_id) as channel_name,
            v.topic_domain, v.view_count::text
       from videos v
      where v.published_at >= now() - interval '365 days'
        and coalesce(v.is_short,false) = false
        and coalesce(v.duration,'') <> 'P0D'
        and v.title is not null
      order by coalesce(v.topic_domain, ''), coalesce(v.view_count, 0), md5(v.id)
      limit 50`,
  );
  return {
    queries: rows.rows.map((row, index) => ({
      id: `j3-video-${String(index + 1).padStart(3, '0')}`,
      video_id: row.id,
      title: row.title,
      channel_id: row.channel_id,
      channel_name: row.channel_name,
      topic_domain: row.topic_domain,
      source: 'stratified_recent_video_seed_not_truth',
    })),
  };
}

async function topicQueries(): Promise<JobQueries> {
  const rows = await Promise.all(TOPIC_STRINGS.map(async (topic, index) => {
    const coverage = await db().query<{ outliers: string; channels: string }>(
      `select count(*)::bigint as outliers, count(distinct v.channel_id)::bigint as channels
         from videos v
         join video_scores s on s.video_id = v.id
        where v.published_at >= now() - interval '365 days'
          and coalesce(v.is_short,false) = false
          and coalesce(v.duration,'') <> 'P0D'
          and s.score >= 2
          and s.confidence in ('likely','confirmed')
          and (
            v.topic_domain = $1
            or v.topic_niche = $1
            or v.topic_micro = $1
          )`,
      [topic],
    );
    return {
      id: `j4-topic-${String(index + 1).padStart(3, '0')}`,
      query: topic,
      lexical_coverage: {
        trusted_outliers: Number(coverage.rows[0].outliers),
        channels: Number(coverage.rows[0].channels),
      },
      source: 'hand_authored_topic_string_coverage_count_only',
    };
  }));
  return { queries: rows };
}

function rubrics(): Record<SemanticJob, Record<string, unknown>> {
  return {
    J1: { target: 'single canonical channel id', metric: 'MRR', judgment: 'deterministic exact match' },
    J2: { scale: { 3: 'direct competitor/strong overlap', 2: 'useful adjacent overlap', 1: 'weak/background overlap', 0: 'not useful' } },
    J3: { dimensions: ['topic', 'packaging', 'format'], scale: { 3: 'strong', 2: 'partial', 1: 'weak', 0: 'none' } },
    J4: { scale: { 1: 'on-topic trusted outlier', 0: 'off-topic or not an outlier' } },
    J5: { labels: ['creative_adaptation', 'direct_application', 'background', 'none'], hit: 'creative_adaptation only' },
  };
}

export async function buildEvalManifest() {
  const jobs: Record<SemanticJob, JobQueries> = {
    J1: await knownItemQueries(),
    J2: await seedChannels('J2', 50),
    J3: await seedVideos(),
    J4: await topicQueries(),
    J5: await seedChannels('J5', 30),
  };
  const manifest = freezeEvalManifest({ version: 1, jobs, rubrics: rubrics() });
  validateEvalManifest(manifest);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    await fs.mkdir(OUT_DIR, { recursive: true });
    const manifest = await buildEvalManifest();
    await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const [job, data] of Object.entries(manifest.jobs)) {
      await fs.writeFile(path.join(OUT_DIR, `${job.toLowerCase()}.json`), `${JSON.stringify(data, null, 2)}\n`);
    }
    await fs.writeFile(path.join(OUT_DIR, 'rubrics.json'), `${JSON.stringify(manifest.rubrics, null, 2)}\n`);
    console.log(`wrote semantic eval v2 manifest ${manifest.content_hash} to ${OUT_DIR}`);
  });
}
