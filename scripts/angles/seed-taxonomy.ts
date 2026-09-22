// Seed angle_families + angles from the closed enum the MVP tagger was built against
// (scripts/scratch/angles-mvp/angles.json). Upsert, so re-running after an enum edit
// re-labels in place rather than duplicating. taxonomy_version 1 == angles_v1.
//
//   npx tsx scripts/angles/seed-taxonomy.ts
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env.local') });

import { q, getPool } from '../../lib/admin/db';

export const TAXONOMY_VERSION = 1;
export const ANGLES_JSON = path.resolve(process.cwd(), 'scripts/scratch/angles-mvp/angles.json');

/**
 * `family_label` is the short noun the board prints as a section heading ("Ranking"); the
 * sentence that used to live there is `family_definition`, which only the tagger's prompt reads.
 * A heading that is a definition is explainer copy, and in caps it was the loudest thing on the
 * page.
 */
interface Family { family_id: string; family_label: string; family_definition: string; surface: 'title' | 'thumbnail' }
interface Angle { angle_id: string; family_id: string; angle_label: string; definition: string; surface: 'title' | 'thumbnail' }

export function readTaxonomy(file = ANGLES_JSON): { families: Family[]; angles: Angle[] } {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    families: raw.families as Family[],
    // The enum keeps title angles and thumbnail angles in two arrays because the tagger asks
    // for them separately; here they are one table keyed by kind.
    angles: [...raw.angles, ...raw.thumbnail_angles] as Angle[],
  };
}

async function main() {
  const { families, angles } = readTaxonomy();

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
       values ($1, $2, $3, $4, $5, $6, true)
       on conflict (id) do update set family_id = excluded.family_id,
                                      kind = excluded.kind,
                                      label = excluded.label,
                                      definition = excluded.definition,
                                      taxonomy_version = excluded.taxonomy_version,
                                      active = true`,
      [a.angle_id, a.family_id, a.surface, a.angle_label, a.definition, TAXONOMY_VERSION]
    );
  }

  const [counts] = await q<{ families: string; title: string; thumb: string }>(
    `select (select count(*) from angle_families)::text as families,
            (select count(*) from angles where kind = 'title')::text as title,
            (select count(*) from angles where kind = 'thumbnail')::text as thumb`
  );
  console.log(`families ${counts.families} · title angles ${counts.title} · thumbnail angles ${counts.thumb}`);
  await getPool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
