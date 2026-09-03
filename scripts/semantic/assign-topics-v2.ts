import { assignNearestCentroid, parsePgVector } from '../../lib/semantic/topic-assignment';
import { SemanticQdrant, VIDEOS_COLLECTION } from '../../lib/semantic/qdrant';
import { db, intArg, runMain } from './common';

const METHOD = 'august_2025_centroid_shadow_openai512_v1';

interface VideoSeed {
  id: string;
  title: string;
}

interface CentroidRow {
  cluster_id: number;
  embedding: string;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    const limit = intArg(process.argv, '--limit') ?? 300;
    const thresholdRaw = process.argv.includes('--threshold')
      ? Number(process.argv[process.argv.indexOf('--threshold') + 1])
      : 0.65;
    if (!Number.isFinite(thresholdRaw) || thresholdRaw < -1 || thresholdRaw > 1) {
      throw new Error('--threshold must be between -1 and 1');
    }
    const write = process.argv.includes('--write');

    const [centroidsResult, videosResult] = await Promise.all([
      db().query<CentroidRow>(
        `select cluster_id, centroid_embedding::text as embedding
           from bertopic_clusters
          where created_at::date = date '2025-08-03'
            and video_count >= 5
          order by cluster_id`,
      ),
      db().query<VideoSeed>(
        `select v.id, v.title
           from videos v
           join embeddings_v1 e on e.entity = 'video' and e.id = v.id
          where v.published_at >= now() - interval '30 days'
            and coalesce(v.is_short,false) = false
            and coalesce(v.duration,'') <> 'P0D'
          order by md5(v.id)
          limit $1`,
        [limit],
      ),
    ]);

    const centroids = centroidsResult.rows.map((row) => ({
      cluster_id: row.cluster_id,
      vector: parsePgVector(row.embedding),
    }));
    const qdrant = new SemanticQdrant({ timeoutMs: 30_000 });
    const assignments: Array<{ video_id: string; cluster_id: number; cosine: number }> = [];
    const misses: string[] = [];

    for (const video of videosResult.rows) {
      try {
        const point = await qdrant.point(VIDEOS_COLLECTION, video.id);
        const assignment = assignNearestCentroid(point.vector, centroids, thresholdRaw);
        if (assignment) assignments.push({ video_id: video.id, ...assignment });
        else misses.push(video.id);
      } catch {
        misses.push(video.id);
      }
    }

    if (write && assignments.length) {
      await db().query(
        `insert into video_topic_assignments_v2 (video_id, cluster_id, cosine, method, assigned_at)
         select input.video_id, input.cluster_id, input.cosine, $4, now()
           from unnest($1::text[], $2::int[], $3::double precision[]) as input(video_id, cluster_id, cosine)
         on conflict (video_id, method) do update
           set cluster_id = excluded.cluster_id,
               cosine = excluded.cosine,
               assigned_at = excluded.assigned_at`,
        [
          assignments.map((row) => row.video_id),
          assignments.map((row) => row.cluster_id),
          assignments.map((row) => row.cosine),
          METHOD,
        ],
      );
    }

    console.log(JSON.stringify({
      method: METHOD,
      write,
      videos_checked: videosResult.rows.length,
      centroids: centroids.length,
      threshold: thresholdRaw,
      assigned: assignments.length,
      unassigned: misses.length,
      mean_cosine: assignments.length
        ? assignments.reduce((sum, row) => sum + row.cosine, 0) / assignments.length
        : null,
    }, null, 2));
  });
}
