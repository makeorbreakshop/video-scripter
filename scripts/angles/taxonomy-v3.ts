// The v3 angle library, read and validated as data. Pure: no database, no network, so the shape
// of the thing that becomes the Jev prompt is testable on its own.
import fs from 'node:fs';
import path from 'node:path';

export const TAXONOMY_VERSION = 3;
export const TAXONOMY_JSON = path.resolve(process.cwd(), 'scripts/angles/taxonomy-v3.json');

export interface FamilyV3 {
  family_id: string;
  family_label: string;
  family_definition: string;
  surface: 'title' | 'thumbnail';
}

export interface AngleV3 {
  angle_id: string;
  family_id: string;
  angle_label: string;
  /** Written to be the literal Jev noul `instructions` string. */
  definition: string;
  criteria: { true: string; false: string };
  source: 'enum' | 'emergent' | 'merged';
  merged_from?: string[];
  emergent_id?: string;
}

export interface TaxonomyV3 { families: FamilyV3[]; angles: AngleV3[] }

/** Reject a taxonomy that would silently produce a malformed or ambiguous Jev request. */
export function validateTaxonomy(t: TaxonomyV3): string[] {
  const problems: string[] = [];
  const families = new Set(t.families.map((f) => f.family_id));
  if (families.size !== t.families.length) problems.push('duplicate family_id');

  const seen = new Set<string>();
  for (const a of t.angles) {
    if (seen.has(a.angle_id)) problems.push(`duplicate angle_id ${a.angle_id}`);
    seen.add(a.angle_id);
    if (!/^[a-z][a-z0-9_]*$/.test(a.angle_id)) problems.push(`angle_id not snake_case: ${a.angle_id}`);
    if (!families.has(a.family_id)) problems.push(`${a.angle_id}: unknown family ${a.family_id}`);
    if (a.angle_label.trim().split(/\s+/).length > 5) problems.push(`${a.angle_id}: label over 5 words`);
    // The definition IS the question Jev is asked, so it has to read as one.
    if (!a.definition.trim().endsWith('?')) problems.push(`${a.angle_id}: definition is not a question`);
    if (!a.criteria?.true?.trim() || !a.criteria?.false?.trim()) problems.push(`${a.angle_id}: missing criteria`);
  }
  // `unpackaged` is a reserved question key in the assignment request.
  if (seen.has('unpackaged')) problems.push('angle_id collides with the reserved key "unpackaged"');
  for (const k of ['curiosity_gap', 'specificity']) {
    if (seen.has(k)) problems.push(`angle_id collides with the reserved key "${k}"`);
  }
  return problems;
}

export function readTaxonomyV3(file = TAXONOMY_JSON): TaxonomyV3 {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as TaxonomyV3;
  const problems = validateTaxonomy(raw);
  if (problems.length) throw new Error(`taxonomy-v3.json invalid:\n  ${problems.join('\n  ')}`);
  return raw;
}
