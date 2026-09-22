// Assign the v3 angle library to every packaged video in the stage-1 framing set, one Jev request
// per video carrying the whole library at once.
//
// Why one request per video rather than one per angle: `state` is the video, the questions are
// independent, and the ~278-token fixed overhead is paid once instead of 38 times. The model
// answers each angle with a probability, so nothing is forced — a video can be three angles or
// none, and the threshold that turns probability into a row lives here, not in the model.
//
// Two questions ride along that are not angles: `unpackaged`, which is a second opinion on the
// stage-1 flag rather than a filter, and two 4-level scores for the continuous packaging
// readings. They land in video_packaging_scores, one row per video.
//
// Resume-safe: every answered video is appended to a jsonl with ALL probabilities (the database
// only keeps rows over the threshold, but calibration needs the ones below it), and a re-run
// skips whatever the jsonl already holds.
//
//   npx tsx scripts/angles/assign-jev.ts --out <dir> [--limit N] [--concurrency 12] [--unpackaged-only]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env.local') });

import { q, getPool } from '../../lib/admin/db';
import { askJev, Question } from './jev';
import { readTaxonomyV3, TAXONOMY_VERSION, AngleV3 } from './taxonomy-v3';

export const MEMBERSHIP_THRESHOLD = 0.5;

/** The reserved question keys, kept in one place so the taxonomy validator can refuse to collide. */
export const UNPACKAGED_KEY = 'unpackaged';

export const UNPACKAGED_QUESTION: Question = {
  type: 'noul',
  instructions:
    'Is this video "unpackaged" — that is, is its title a contents manifest rather than a pitch, '
    + 'so there is no angle to read off it?',
  criteria: {
    true:
      'The title just lists or labels what is inside: a music mix or compilation, a playlist, a '
      + 'livestream or stream VOD, a numbered episode of a fixture (a podcast, a news bulletin, a '
      + 'daily market report), a full match or set recording, ambient or study background content, '
      + 'or a bare product/song/chapter name with no claim attached.',
    false:
      'The title makes a claim, asks a question, promises a reveal, names a comparison, warns, '
      + 'ranks, or otherwise frames the subject to make someone want it. Anything with a pitch.',
  },
};

export const SCORE_QUESTIONS: Record<string, Question> = {
  curiosity_gap: {
    type: 'score',
    instructions:
      'How large is the curiosity gap this title opens — how much does it make a viewer need to '
      + 'click to find out something it deliberately does not tell them?',
    criteria: [
      'None: the title states the whole proposition; nothing is held back.',
      'Slight: mostly complete, with one small unstated detail.',
      'Strong: a clear question or withheld outcome the video exists to answer.',
      'Extreme: the title is almost entirely a tease; the subject or result is unknowable without clicking.',
    ],
  },
  specificity: {
    type: 'score',
    instructions:
      'How specific is this title — how much concrete, checkable detail (named things, numbers, '
      + 'quantities, prices, timeframes) does it commit to?',
    criteria: [
      'Vague: generic nouns only, nothing named or numbered.',
      'Some: one named thing or one loose quantity.',
      'Specific: several named things, or a named thing plus a real number.',
      'Very specific: exact figures, model names, prices or timeframes that could be checked.',
    ],
  },
};

/** The literal request body's `questions` map, so its construction is testable without a network. */
export function buildQuestions(angles: AngleV3[], opts: { anglesOn?: boolean } = {}): Record<string, Question> {
  const questions: Record<string, Question> = {};
  if (opts.anglesOn !== false) {
    for (const a of angles) {
      questions[a.angle_id] = { type: 'noul', instructions: a.definition, criteria: a.criteria };
    }
    Object.assign(questions, SCORE_QUESTIONS);
  }
  questions[UNPACKAGED_KEY] = UNPACKAGED_QUESTION;
  return questions;
}

export interface VideoRow { id: string; title: string; description: string | null; channel_name: string | null }

/**
 * The state is the packaging and nothing else: title first because it is what every question asks
 * about, a clipped description for disambiguation, and the channel because "is this a fixture"
 * is partly a question about who publishes it.
 */
export function buildState(v: VideoRow): string {
  const description = (v.description ?? '').replace(/\s+/g, ' ').trim();
  return [
    `Title: ${v.title}`,
    `Channel: ${v.channel_name ?? 'unknown'}`,
    description ? `Description: ${description}` : 'Description: (none)',
  ].join('\n');
}

/** Everything the model said about one video, before any threshold is applied. */
export interface Assignment {
  video_id: string;
  model: string;
  probabilities: Record<string, number>;
  unpackaged_p: number;
  curiosity_gap: number | null;
  specificity: number | null;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Load the jsonl into Postgres. Separate from the asking so a threshold change is a re-load of a
 * file we already paid for, and so a crashed run can be loaded from whatever it did finish.
 */
export async function loadFromJsonl(file: string, threshold = MEMBERSHIP_THRESHOLD): Promise<{ videos: number; rows: number }> {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let videos = 0, rows = 0;
  let angleBatch: Array<[string, string, number, string]> = [];
  let scoreBatch: Array<[string, number | null, number | null, number, string]> = [];

  const flush = async () => {
    if (angleBatch.length) {
      const values = angleBatch
        .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, 'title', $${i * 4 + 3}, $${i * 4 + 4}, ${TAXONOMY_VERSION})`)
        .join(', ');
      await q(
        `insert into video_angles (video_id, angle_id, kind, probability, model_version, taxonomy_version)
         values ${values}
         on conflict (video_id, angle_id, taxonomy_version)
         do update set probability = excluded.probability, model_version = excluded.model_version`,
        angleBatch.flat()
      );
      angleBatch = [];
    }
    if (scoreBatch.length) {
      const values = scoreBatch
        .map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`)
        .join(', ');
      await q(
        `insert into video_packaging_scores (video_id, curiosity_gap, specificity, unpackaged_p, model_version)
         values ${values}
         on conflict (video_id) do update set curiosity_gap = excluded.curiosity_gap,
                                              specificity = excluded.specificity,
                                              unpackaged_p = excluded.unpackaged_p,
                                              model_version = excluded.model_version`,
        scoreBatch.flat()
      );
      scoreBatch = [];
    }
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let row: Assignment;
    try { row = JSON.parse(line); } catch { continue; }
    videos++;
    for (const [angleId, p] of Object.entries(row.probabilities)) {
      if (p >= threshold) { angleBatch.push([row.video_id, angleId, p, row.model]); rows++; }
    }
    scoreBatch.push([row.video_id, row.curiosity_gap, row.specificity, row.unpackaged_p, row.model]);
    if (angleBatch.length >= 400 || scoreBatch.length >= 400) await flush();
  }
  await flush();
  return { videos, rows };
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (flag: string) => process.argv.includes(flag);

async function alreadyDone(file: string): Promise<Set<string>> {
  const done = new Set<string>();
  if (!fs.existsSync(file)) return done;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).video_id); } catch { /* a torn last line */ }
  }
  return done;
}

async function main() {
  const outDir = argValue('--out');
  if (!outDir) throw new Error('--out <dir> is required');
  fs.mkdirSync(outDir, { recursive: true });

  // --unpackaged-only is the cheap second pass over the videos stage 1 already called unpackaged:
  // one question instead of 41, purely to fill in the other half of the confusion matrix.
  const unpackagedOnly = hasFlag('--unpackaged-only');
  // --v3-gate reads the corrected packaging gate (jev unpackaged_p) instead of stage-1 nano's flag.
  const gateColumn = hasFlag('--v3-gate') ? 'f.unpackaged_v3' : 'f.unpackaged';
  const concurrency = Number(argValue('--concurrency') ?? 12);
  const limit = argValue('--limit') ? Number(argValue('--limit')) : null;
  const jsonl = path.join(outDir, unpackagedOnly ? 'unpackaged_only.jsonl' : 'assignments.jsonl');

  if (hasFlag('--load-only')) {
    const loaded = await loadFromJsonl(jsonl);
    console.log(`loaded ${loaded.rows} video_angles rows over ${loaded.videos} videos`);
    await getPool().end();
    return;
  }

  const { angles } = readTaxonomyV3();
  const questions = buildQuestions(angles, { anglesOn: !unpackagedOnly });

  // --video-ids-file names an explicit set (one video id per line) instead of the gate, for
  // backfilling a channel the band query never covered. The gate is still ANDed on, so a file
  // plus --unpackaged-only means "these ids, stage-1-unpackaged half".
  const idsFile = argValue('--video-ids-file');
  const explicitIds = idsFile
    ? [...new Set(fs.readFileSync(idsFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean))]
    : null;

  // One bounded query: the stage-1 half we want, projected to the four columns the state needs.
  const videos = await q<VideoRow>(
    `select v.id, v.title, left(coalesce(v.description, ''), 300) as description, v.channel_name
       from video_framing f
       join videos v on v.id = f.video_id
      where ${gateColumn} = $1
      ${explicitIds ? 'and v.id = any($2::text[])' : ''}
      order by v.id
      ${limit ? `limit ${Number(limit)}` : ''}`,
    explicitIds ? [unpackagedOnly, explicitIds] : [unpackagedOnly]
  );

  const done = await alreadyDone(jsonl);
  const todo = videos.filter((v) => !done.has(v.id));
  console.log(`${videos.length} videos · ${done.size} already answered · ${todo.length} to go · ${Object.keys(questions).length} questions each`);

  const sink = fs.createWriteStream(jsonl, { flags: 'a' });
  let inTok = 0, outTok = 0, failures = 0, n = 0;
  const models = new Set<string>();
  const started = Date.now();

  const worker = async (slot: number) => {
    for (let i = slot; i < todo.length; i += concurrency) {
      const v = todo[i];
      try {
        const res = await askJev(buildState(v), questions);
        const probabilities: Record<string, number> = {};
        for (const a of angles) {
          const answer = res.answers[a.angle_id];
          if (answer?.noul != null) probabilities[a.angle_id] = answer.noul;
        }
        const row: Assignment = {
          video_id: v.id,
          model: res.model,
          probabilities,
          unpackaged_p: res.answers[UNPACKAGED_KEY]?.noul ?? NaN,
          curiosity_gap: res.answers.curiosity_gap?.score ?? null,
          specificity: res.answers.specificity?.score ?? null,
          input_tokens: res.usage.input_tokens,
          output_tokens: res.usage.output_tokens,
        };
        sink.write(`${JSON.stringify(row)}\n`);
        models.add(res.model);
        inTok += res.usage.input_tokens; outTok += res.usage.output_tokens;
      } catch (e) {
        failures++;
        if (failures <= 10) console.error(`${v.id}: ${(e as Error).message}`);
      }
      if (++n % 250 === 0) {
        const rate = n / ((Date.now() - started) / 1000);
        console.log(`${n}/${todo.length} · ${rate.toFixed(1)}/s · ${inTok + outTok} tok · ${failures} failed`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, (_, s) => worker(s)));
  await new Promise((r) => sink.end(r));

  if (!unpackagedOnly) {
    const loaded = await loadFromJsonl(jsonl);
    console.log(`loaded ${loaded.rows} video_angles rows over ${loaded.videos} videos`);
  }

  console.log(`done: ${n - failures} answered · ${failures} failed · in ${inTok} out ${outTok} · models ${[...models].join(',')}`);
  fs.writeFileSync(path.join(outDir, unpackagedOnly ? 'usage_unpackaged.json' : 'usage.json'),
    JSON.stringify({ answered: n - failures, failures, input_tokens: inTok, output_tokens: outTok, models: [...models] }, null, 2));
  await getPool().end();
}

// CLI entry: run only when invoked directly (no import.meta so the module also loads under ts-jest).
if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("scripts", "angles", "assign-jev.ts"))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
