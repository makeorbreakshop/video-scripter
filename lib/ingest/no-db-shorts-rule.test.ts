// There is exactly one Shorts rule, and it lives in lib/ingest/classify.ts: <= 62s is a Short,
// 63-180s is undecidable from duration and settled only by YouTube's own /shorts/<id> routing,
// > 180s is long-form. The database may constrain is_short; it must never compute it.
//
// is-short-trigger.test.ts holds the line for triggers on `videos`. This one holds it for stored
// functions: a plpgsql/sql body that calls the legacy duration-only `is_youtube_short()`, or that
// carries its own `duration <= 180` / `<= 62` Shorts rule, is the same bug one layer over.
// sql/2026-09-04-drop-legacy-baseline-shorts-rule.sql dropped the three pre-v3 baseline functions
// that did this (process_baseline_batch, calculate_rolling_baselines_batch,
// get_packaging_performance).
//
// Integration test: needs DATABASE_URL (.env.local); read-only. Skipped without one.
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const DSN = process.env.DATABASE_URL;
const maybe = DSN ? describe : describe.skip;

// A function body that reaches for the legacy duration-only helper.
const CALLS_LEGACY_HELPER = /\bis_youtube_short\s*\(/i;

// A hand-rolled duration-only Shorts rule: a Shorts/duration comparison against the 180s or 62s
// ceiling. Matched on the whole body only when the body also talks about Shorts, so that an
// unrelated `interval '180 seconds'` elsewhere in the schema is not a false positive.
const MENTIONS_SHORTS = /short/i;
const DURATION_CEILING = /duration[^;]{0,80}<=\s*(180|181|121|62|63)\b|<=\s*(180|181|121|62|63)\b[^;]{0,80}duration/i;

// Known-good functions: these decide is_short from a routing verdict the app supplies, or merely
// read the column. Add an entry only with a reason.
const ALLOWLIST = new Set<string>([]);

maybe('no stored function re-derives the Shorts rule', () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DSN, max: 1 }); });
  afterAll(async () => { await pool?.end(); });

  it('has no pg_proc body calling is_youtube_short() or carrying a duration-only Shorts rule', async () => {
    const { rows } = await pool.query(
      `select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosrc
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname not in ('pg_catalog', 'information_schema')
          and p.prosrc is not null`);

    const offenders: string[] = [];
    for (const r of rows) {
      const sig = `${r.nspname}.${r.proname}(${r.args})`;
      if (ALLOWLIST.has(sig)) continue;
      const src = String(r.prosrc);
      // The helper itself is not dropped yet (packaging_performance still depends on it);
      // what must not exist is anything that *uses* a duration-only rule to decide Shorts.
      if (r.proname === 'is_youtube_short') continue;
      if (CALLS_LEGACY_HELPER.test(src)) offenders.push(`${sig}  [calls is_youtube_short()]`);
      else if (MENTIONS_SHORTS.test(src) && DURATION_CEILING.test(src)) offenders.push(`${sig}  [own duration-only rule]`);
    }
    expect(offenders).toEqual([]);
  }, 60000);

  it('no longer defines the pre-v3 baseline functions that filtered Shorts by duration', async () => {
    const { rows } = await pool.query(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and proname in ('process_baseline_batch', 'calculate_rolling_baselines_batch',
                          'get_packaging_performance', 'trigger_baseline_processing')`);
    expect(rows.map((r) => r.proname).sort()).toEqual([]);
  }, 60000);
});
