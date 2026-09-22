// Seed angle_families + angles for taxonomy v3 from the checked-in scripts/angles/taxonomy-v3.json.
// Upsert on (id, taxonomy_version), so an edit to a definition re-labels v3 in place and never
// touches the v1 rows kept beside it for provenance.
//
//   npx tsx scripts/angles/seed-taxonomy-v3.ts
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env.local') });

import { q, getPool } from '../../lib/admin/db';
import { readTaxonomyV3, TAXONOMY_VERSION } from './taxonomy-v3';

async function main() {
  const { families, angles } = readTaxonomyV3();

  for (const [i, f] of families.entries()) {
    await q(
      `insert into angle_families (id, label, definition, surface, position)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set label = excluded.label,
                                      definition = excluded.definition,
                                      surface = excluded.surface,
                                      position = excluded.position`,
      [f.family_id, f.family_label, f.family_definition, f.surface, i]
    );
  }

  for (const a of angles) {
    await q(
      `insert into angles (id, family_id, kind, label, definition, taxonomy_version, active)
       values ($1, $2, 'title', $3, $4, $5, true)
       on conflict (id, taxonomy_version) do update set family_id = excluded.family_id,
                                                        label = excluded.label,
                                                        definition = excluded.definition,
                                                        active = true`,
      [a.angle_id, a.family_id, a.angle_label, a.definition, TAXONOMY_VERSION]
    );
  }

  const [counts] = await q<{ v3: string; v1_active: string }>(
    `select (select count(*) from angles where taxonomy_version = 3)::text as v3,
            (select count(*) from angles where taxonomy_version = 1 and active)::text as v1_active`
  );
  console.log(`v3 angles ${counts.v3} · v1 rows still active ${counts.v1_active}`);
  await getPool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
