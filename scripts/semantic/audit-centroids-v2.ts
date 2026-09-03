import fs from 'fs/promises';
import path from 'path';
import { db, runMain } from './common';

const OUT_DIR = path.resolve('docs/prd/semantic-eval-v2');

export async function auditCentroids() {
  const [columns, byDate, examples] = await Promise.all([
    db().query<{ column_name: string; data_type: string }>(
      `select column_name, data_type
         from information_schema.columns
        where table_schema = 'public' and table_name = 'bertopic_clusters'
        order by ordinal_position`,
    ),
    db().query<{ created_date: string; rows: string; lt5: string; placeholders: string }>(
      `select created_at::date::text as created_date,
              count(*)::bigint as rows,
              count(*) filter (where video_count < 5)::bigint as lt5,
              count(*) filter (
                where topic_name ilike '%-1%'
                   or parent_topic ilike '%-1%'
                   or grandparent_topic ilike '%-1%'
              )::bigint as placeholders
         from bertopic_clusters
        group by 1
        order by 1`,
    ),
    db().query<{ cluster_id: number; topic_name: string; parent_topic: string | null; grandparent_topic: string | null; video_count: number; dims: number }>(
      `select cluster_id, topic_name, parent_topic, grandparent_topic, video_count,
              vector_dims(centroid_embedding)::int as dims
         from bertopic_clusters
        where created_at::date = date '2025-08-03'
        order by cluster_id
        limit 10`,
    ),
  ]);
  return {
    audited_at: new Date().toISOString(),
    table: 'bertopic_clusters',
    columns: columns.rows,
    by_created_date: byDate.rows.map((row) => ({
      created_date: row.created_date,
      rows: Number(row.rows),
      clusters_with_fewer_than_5_sources: Number(row.lt5),
      placeholder_hierarchy_rows: Number(row.placeholders),
    })),
    august_2025_examples: examples.rows,
    provenance_evidence: [
      {
        path: 'scripts/load-bertopic-centroids-to-db.js',
        finding: 'August 2025 loader read bertopic_centroids_complete_20250803.json and inserted blended_centroid || title_centroid into bertopic_clusters via Supabase JS at the time.',
      },
      {
        path: 'scripts/clustering/incremental/incremental-assignment.js',
        finding: 'Historical assignment compared title_embedding to bertopic_clusters.centroid_embedding with cosine threshold 0.65.',
      },
    ],
    decision: 'Use August 2025 216 centroids only for shadow assignment/eval. Exclude July 2025 rows with low source counts or placeholder hierarchy from v2 canonical topic assignment.',
  };
}

function markdown(audit: Awaited<ReturnType<typeof auditCentroids>>): string {
  const table = audit.by_created_date
    .map((row) => `| ${row.created_date} | ${row.rows} | ${row.clusters_with_fewer_than_5_sources} | ${row.placeholder_hierarchy_rows} |`)
    .join('\n');
  return `# Semantic v2 centroid audit\n\nGenerated: ${audit.audited_at}\n\n| Created date | Rows | <5 source clusters | Placeholder hierarchy rows |\n|---|---:|---:|---:|\n${table}\n\nDecision: ${audit.decision}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    await fs.mkdir(OUT_DIR, { recursive: true });
    const audit = await auditCentroids();
    await fs.writeFile(path.join(OUT_DIR, 'centroid-audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    await fs.writeFile(path.join(OUT_DIR, 'centroid-audit.md'), markdown(audit));
    console.log(`wrote centroid audit to ${OUT_DIR}`);
  });
}
