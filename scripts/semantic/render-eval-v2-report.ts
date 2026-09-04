import fs from 'fs/promises';
import path from 'path';
import { db, runMain } from './common';

const MANIFEST_PATH = path.resolve('docs/prd/semantic-eval-v2/queries/manifest.json');
const AUDIT_PATH = path.resolve('docs/prd/semantic-eval-v2/centroid-audit.json');
const OUT_PATH = path.resolve('docs/prd/2026-09-03-semantic-eval-v2.md');

function etNow(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(new Date());
}

async function qdrantCount(collection: string): Promise<number | null> {
  const baseUrl = (process.env.QDRANT_URL ?? 'http://localhost:6333').replace(/\/$/, '');
  try {
    const response = await fetch(`${baseUrl}/collections/${collection}`);
    if (!response.ok) return null;
    const json = await response.json() as { result?: { points_count?: number } };
    return json.result?.points_count ?? null;
  } catch {
    return null;
  }
}

function gate(status: 'pass' | 'fail' | 'pending', evidence: string): string {
  return `| ${status} | ${evidence} |`;
}

function tableRows(rows: string[]): string {
  return rows.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as {
      content_hash: string;
      jobs: Record<string, { queries: unknown[] }>;
    };
    const audit = JSON.parse(await fs.readFile(AUDIT_PATH, 'utf8')) as {
      by_created_date: Array<{
        created_date: string;
        rows: number;
        clusters_with_fewer_than_5_sources: number;
        placeholder_hierarchy_rows: number;
      }>;
      decision: string;
    };
    const [scores, facets, prototypes, cost, videosV2] = await Promise.all([
      db().query<{ rows: string; numeric_scores: string; trusted_outliers: string; channels: string }>(
        `select count(*)::bigint as rows,
                count(*) filter (where score is not null)::bigint as numeric_scores,
                count(*) filter (where score >= 2 and confidence in ('likely','confirmed'))::bigint as trusted_outliers,
                count(distinct channel_id)::bigint as channels
           from video_scores_by_version
          where model_version = 'v3.1-semantic-backfill-2026-09'`,
      ),
      db().query<{ rows: string; with_abs: string; packaging_only: string }>(
        `select count(*)::bigint as rows,
                count(*) filter (where facets ? 'purpose_abstract' and facets ? 'mechanism_abstract')::bigint as with_abs,
                count(*) filter (where facets->>'evidence_status' = 'packaging_only')::bigint as packaging_only
           from video_facets
          where prompt_version = 'semantic_facets_v2_2026_09_03'`,
      ),
      db().query<{ kind: string; prototypes: string; channels: string }>(
        `select kind, count(*)::bigint as prototypes, count(distinct channel_id)::bigint as channels
           from channel_prototypes
          group by kind
          order by kind`,
      ),
      db().query<{ tokens: string; usd: string }>(
        `select coalesce(sum(tokens),0)::bigint tokens, coalesce(sum(usd),0)::numeric usd
           from semantic_cost_ledger
          where date = current_date`,
      ),
      qdrantCount('videos_v2'),
    ]);

    const queryRows = Object.entries(manifest.jobs)
      .map(([job, config]) => `| ${job} | ${config.queries.length} |`);
    const centroidRows = audit.by_created_date
      .map((row) => `| ${row.created_date} | ${row.rows} | ${row.clusters_with_fewer_than_5_sources} | ${row.placeholder_hierarchy_rows} |`);
    const prototypeRows = prototypes.rows.length
      ? prototypes.rows.map((row) => `| ${row.kind} | ${row.prototypes} | ${row.channels} |`)
      : ['| — | 0 | 0 |'];
    const score = scores.rows[0];
    const facet = facets.rows[0];
    const dayCost = cost.rows[0];
    const gateRows = [
      gate('pass', 'Phase 0 mature score backfill completed: annual mature outlier pool now has versioned v3.1 coverage.'),
      gate('pass', 'Eval manifest is frozen before v2 systems are evaluated.'),
      gate('fail', 'J4 topic coverage from canonical topic columns is currently zero for the 40 human-readable topic strings; topic assignment/facets must carry topical search.'),
      gate('pending', 'Centroid shadow assignment threshold is not accepted: 0.65 assigned only 10/300; needs judged calibration or topic rebuild.'),
      gate('pending', 'Facet pilot produced structurally valid rows, but Brandon review packet is not accepted yet; do not scale extraction.'),
      gate('pending', 'Reranker, fusion comparison, analogue composite, and held-out nDCG/Recall tables are not run yet.'),
    ];

    const report = [
      '# Semantic eval v2 — current local status',
      '',
      `Generated: ${etNow()}`,
      '',
      'This report is generated from JSON/database state by `scripts/semantic/render-eval-v2-report.ts`. Do not hand-edit.',
      '',
      '## Frozen eval manifest',
      '',
      `Content hash: \`${manifest.content_hash}\``,
      '',
      '| Job | Frozen queries/seeds |',
      '|---|---:|',
      tableRows(queryRows),
      '',
      '## Phase 0 score coverage',
      '',
      '| Model | Rows | Numeric scores | Trusted outliers | Channels |',
      '|---|---:|---:|---:|---:|',
      `| v3.1-semantic-backfill-2026-09 | ${score.rows} | ${score.numeric_scores} | ${score.trusted_outliers} | ${score.channels} |`,
      '',
      '## Centroid audit',
      '',
      '| Created date | Rows | <5 source clusters | Placeholder hierarchy rows |',
      '|---|---:|---:|---:|',
      tableRows(centroidRows),
      '',
      `Decision: ${audit.decision}`,
      '',
      '## Facet pilot',
      '',
      '| Prompt/model | Rows | With required abstractions | Packaging-only evidence |',
      '|---|---:|---:|---:|',
      `| semantic_facets_v2_2026_09_03 / gpt-5-nano | ${facet.rows} | ${facet.with_abs} | ${facet.packaging_only} |`,
      '',
      'Review packet: `docs/prd/semantic-eval-v2/facet-pilot-review.json`.',
      '',
      '## videos_v2 / channel medoids',
      '',
      '| Collection | Points |',
      '|---|---:|',
      `| videos_v2 | ${videosV2 ?? 'unavailable'} |`,
      '',
      '| Prototype kind | Prototypes | Channels |',
      '|---|---:|---:|',
      tableRows(prototypeRows),
      '',
      '## Gate table',
      '',
      '| Status | Evidence |',
      '|---|---|',
      tableRows(gateRows),
      '',
      '## Cost',
      '',
      `Today's semantic ledger total: ${dayCost.tokens} tokens, $${Number(dayCost.usd).toFixed(6)}. This includes prior semantic work today, not only v2 facets.`,
      '',
    ].join('\n');

    await fs.writeFile(OUT_PATH, report);
    console.log(`wrote ${OUT_PATH}`);
  });
}
