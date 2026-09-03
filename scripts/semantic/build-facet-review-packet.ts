import fs from 'fs/promises';
import path from 'path';
import { db, intArg, runMain } from './common';

const OUT_PATH = path.resolve('docs/prd/semantic-eval-v2/facet-pilot-review.json');

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    const limit = intArg(process.argv, '--limit') ?? 40;
    const result = await db().query(
      `select f.video_id,
              v.title,
              coalesce(v.channel_name, cm.title, v.channel_id) as channel_name,
              f.model,
              f.prompt_version,
              f.facets,
              null::text as brandon_acceptance,
              null::text as brandon_notes
         from video_facets f
         join videos v on v.id = f.video_id
         left join channel_meta cm on cm.channel_id = v.channel_id
        where f.prompt_version = 'semantic_facets_v2_2026_09_03'
        order by md5(f.video_id)
        limit $1`,
      [limit],
    );
    await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
    await fs.writeFile(OUT_PATH, `${JSON.stringify({
      instructions: 'Brandon reviews brandon_acceptance as accept|edit|reject and optional brandon_notes. Do not scale facet extraction until this review is accepted.',
      count: result.rows.length,
      rows: result.rows,
    }, null, 2)}\n`);
    console.log(`wrote ${result.rows.length} facet-review rows to ${OUT_PATH}`);
  });
}
