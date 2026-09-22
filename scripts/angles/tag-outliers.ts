// Label untagged guarded outliers against the closed angle enum with Claude Haiku 4.5.
//
// The one-off MVP (scripts/scratch/angles-mvp/tag-videos.mjs) read a JSON dump and appended to a
// jsonl; this reads the same pool straight out of Postgres, skips anything video_angles already
// has, and writes per batch so a crash costs one batch. Bounded three ways — --limit rows,
// --max-usd spend, --days recency — because it is a paid loop over a table that grows.
//
// NOT scheduled. No LaunchAgent, no cron: Brandon triggers it.
//
// `--retag` re-labels videos that already have rows instead of skipping them: the enum, the
// prompt or the schema changed and the stored labels are answers to the old question. Each video
// is deleted and reinserted inside one transaction, so a crash leaves whole videos, never halves.
//
//   npx tsx scripts/angles/tag-outliers.ts [--limit 2000] [--max-usd 3] [--days 90] [--retag] [--explain] [--count-prefix] [--dry-run]
import path from 'node:path';
import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

config({ path: path.resolve(process.cwd(), '.env.local') });

import { q, getPool, poolWithTimeout, DEFAULT_STATEMENT_TIMEOUT_MS } from '../../lib/admin/db';
import { longformSql } from '../../lib/scoring/longform';
import { loadPrefix, type Prefix } from './prefix';

const MODEL = 'claude-haiku-4-5';
const TAXONOMY_VERSION = 1;
/** Published Haiku 4.5 prices, $ per 1M tokens. */
const PRICE = { in: 1.0, out: 5.0, cacheWrite: 1.25, cacheRead: 0.1 };
const BATCH = 12;
const CONCURRENCY = 16;

const num = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  const v = i === -1 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const LIMIT = num('--limit', 2_000);
const MAX_USD = num('--max-usd', 3);
const DAYS = num('--days', 90);
const DRY_RUN = process.argv.includes('--dry-run');
const RETAG = process.argv.includes('--retag');
const EXPLAIN = process.argv.includes('--explain');
const COUNT_PREFIX = process.argv.includes('--count-prefix');

// ---------------------------------------------------------------------------- selection

/**
 * Untagged guarded outliers, newest first.
 *
 * Same guard as /app/outliers at its defaults (score >= 2, confirmed|likely, n_baseline >= 5,
 * baseline >= 500, long-form, non-institutional) plus "nothing in video_angles yet". The anti-join
 * is `not exists`, not `left join ... is null`, so Postgres can stop at the first matching row of
 * video_angles_video rather than materialising the pairs.
 */
const SELECT_SQL = `
  -- description is truncated in SQL, not in JS: cleanDescription() keeps 320 characters, and
  -- pulling whole descriptions for a 4,800-video retag returned ~25 MB of text to throw away.
  select v.id, v.title, left(v.description, 600) as description, v.thumbnail_url,
         coalesce(cm.title, v.channel_name, v.channel_id) as channel_name
    from videos v
    join video_scores s on s.video_id = v.id
    left join channel_meta cm on cm.channel_id = v.channel_id
   where v.published_at >= now() - ($1::int * interval '1 day')
     and s.score >= 2
     and s.confidence = any(array['confirmed','likely']::text[])
     and s.n_baseline >= 5
     and s.baseline >= 500
     and ${longformSql('v')}
     and coalesce(v.is_institutional, false) = false
     and TAGGED_CLAUSE
   order by v.published_at desc
   limit $2`;

/**
 * Untagged is the default; `--retag` inverts it.
 *
 * A retag pass must find videos the tagger has *seen*, which after this change is
 * video_packaging (one row per video, written even when the verdict is "unpackaged" and there
 * are no angles at all) OR video_angles for rows that predate that table. The anti-join stays
 * `not exists` so Postgres stops at the first matching row rather than materialising the pairs.
 */
const SEEN = `(exists (select 1 from video_angles va where va.video_id = v.id)
                or exists (select 1 from video_packaging vp where vp.video_id = v.id))`;
const selectSql = () => SELECT_SQL.replace('TAGGED_CLAUSE', RETAG ? SEEN : `not ${SEEN}`);

interface Video { id: string; title: string; description: string | null; thumbnail_url: string | null; channel_name: string }

/** Loaded from the database once in main(); nothing above it is allowed to read the enum. */
let prefix: Prefix;

// ---------------------------------------------------------------------------- helpers

/** Strip lone surrogates: half an emoji in a title makes the request body invalid JSON. */
const safe = (text: unknown) =>
  String(text ?? '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

/** safe() runs again after the slice: cutting at a fixed char count can split an emoji. */
const cleanDescription = (text: unknown) =>
  safe(safe(text).replace(/https?:\/\/\S+/g, '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 320));

async function thumbnail(video: Video): Promise<string | null> {
  const urls = [`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`, video.thumbnail_url].filter(Boolean) as string[];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) continue;
      return buf.toString('base64');
    } catch { /* try next */ }
  }
  return null;
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 });

const spend = { usd: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, requests: 0, noImage: 0, failed: 0, drift: 0, videos: 0, unpackaged: 0 };

function addUsage(usage: Anthropic.Usage) {
  spend.in += usage.input_tokens ?? 0;
  spend.out += usage.output_tokens ?? 0;
  spend.cacheRead += usage.cache_read_input_tokens ?? 0;
  spend.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  spend.usd = (spend.in * PRICE.in + spend.out * PRICE.out
    + spend.cacheWrite * PRICE.in * PRICE.cacheWrite
    + spend.cacheRead * PRICE.in * PRICE.cacheRead) / 1e6;
}

// ---------------------------------------------------------------------------- tagging

interface Labelled { video_id: string; unpackaged: boolean; angles: string[]; thumbnail_angles: string[]; variation: string; confidence: number }

async function tagBatch(batch: Video[]): Promise<Labelled[]> {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const [index, video] of batch.entries()) {
    const image = await thumbnail(video);
    if (!image) spend.noImage += 1;
    content.push({
      type: 'text',
      text: [
        `--- VIDEO ${index + 1} ---`,
        `video_id: ${video.id}`,
        `channel: ${safe(video.channel_name)}`,
        `title: ${safe(video.title)}`,
        `description: ${cleanDescription(video.description) || '(none)'}`,
        image ? 'thumbnail: below' : 'thumbnail: UNAVAILABLE — label thumbnail_angles as []',
      ].join('\n'),
    });
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
  }
  content.push({ type: 'text', text: `Label all ${batch.length} videos above. Return them in order with matching video_id values.` });

  let response: Anthropic.Message;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: prefix.SYSTEM,
        tools: [prefix.TOOL],
        tool_choice: { type: 'tool', name: 'tag_videos' },
        messages: [{ role: 'user', content }],
      });
      break;
    } catch (error: any) {
      // The SDK already retries; this catches the 429s that outlive maxRetries rather than
      // throwing away a batch whose thumbnails have just been downloaded.
      if (attempt >= 3 || (error?.status !== 429 && error?.status !== 529)) throw error;
      await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
    }
  }

  spend.requests += 1;
  addUsage(response.usage);

  const block = response.content.find((b) => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
  if (!block) throw new Error('no tool_use block');
  const byId = new Map(batch.map((v) => [v.id, v]));
  const out: Labelled[] = [];
  const labelled: any[] = (block.input as any).videos ?? [];
  for (let index = 0; index < labelled.length; index += 1) {
    const row = labelled[index];
    const video = byId.get(row.video_id) ?? batch[index];
    if (!video) continue;
    const angles = (row.angles ?? []).filter((a: string) => prefix.ANGLE_IDS.includes(a));
    spend.drift += (row.angles ?? []).length - angles.length;
    // `unpackaged` is authoritative: a model that sets it and then names an angle anyway has
    // contradicted itself, and the verdict is the half we asked for first. A video with no
    // angles and no verdict is also unpackaged in effect — it will never appear on the board
    // either way, and recording it stops the next run re-paying for the same answer.
    const unpackaged = row.unpackaged === true || angles.length === 0;
    if (unpackaged) spend.unpackaged += 1;
    out.push({
      video_id: video.id,
      unpackaged,
      angles: unpackaged ? [] : angles,
      thumbnail_angles: unpackaged ? [] : (row.thumbnail_angles ?? []).filter((t: string) => prefix.TN_IDS.includes(t)),
      variation: String(row.variation ?? '').split(/\s+/).slice(0, 14).join(' '),
      confidence: Number(row.confidence ?? 0),
    });
  }
  return out;
}

/**
 * One transaction per batch: every video in it is deleted and rewritten together, so a crash or
 * a statement timeout leaves whole videos and never a video whose old labels are gone and whose
 * new ones never landed. Under --retag the delete is the point; on a first pass it is a no-op
 * that costs one index probe per video.
 *
 * video_packaging gets a row for EVERY labelled video, including the unpackaged ones that have
 * no angles at all. That row is the record that the tagger has seen this video — without it a
 * later run would re-pay to be told again that a Boney M megamix has no angle.
 */
async function writeBatch(rows: Labelled[]) {
  if (!rows.length) return;
  const ids = rows.map((r) => r.video_id);
  const pairs: Array<[string, string, string, number, string]> = [];
  for (const row of rows) {
    const seen = new Set<string>();
    for (const [angleIds, kind] of [[row.angles, 'title'], [row.thumbnail_angles, 'thumbnail']] as const) {
      for (const id of angleIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push([row.video_id, id, kind, row.confidence, row.variation]);
      }
    }
  }

  await poolWithTimeout(getPool(), DEFAULT_STATEMENT_TIMEOUT_MS, async (client) => {
    await client.query(`delete from video_angles where video_id = any($1::text[])`, [ids]);
    if (pairs.length) {
      const values = pairs
        .map((_, n) => `($${n * 5 + 1}, $${n * 5 + 2}, $${n * 5 + 3}, $${n * 5 + 4}, $${n * 5 + 5}, $${pairs.length * 5 + 1}, $${pairs.length * 5 + 2})`)
        .join(', ');
      await client.query(
        `insert into video_angles (video_id, angle_id, kind, confidence, variation, model, taxonomy_version)
         values ${values} on conflict (video_id, angle_id, taxonomy_version) do nothing`,
        [...pairs.flat(), MODEL, TAXONOMY_VERSION]
      );
    }
    await client.query(
      `insert into video_packaging (video_id, unpackaged, model, taxonomy_version, tagged_at)
       select * from unnest($1::text[], $2::boolean[]) as t(video_id, unpackaged),
                    lateral (select $3::text, $4::int, now()) as c(model, taxonomy_version, tagged_at)
       on conflict (video_id) do update set unpackaged = excluded.unpackaged,
                                            model = excluded.model,
                                            taxonomy_version = excluded.taxonomy_version,
                                            tagged_at = excluded.tagged_at`,
      [ids, rows.map((r) => r.unpackaged), MODEL, TAXONOMY_VERSION]
    );
  }, 'angles.tag-outliers');
  spend.videos += rows.length;
}

// ---------------------------------------------------------------------------- main

async function main() {
  prefix = await loadPrefix();

  if (COUNT_PREFIX) {
    const stub: Anthropic.MessageCountTokensParams = { model: MODEL, messages: [{ role: 'user', content: 'x' }] };
    const whole = await client.messages.countTokens({ ...stub, system: prefix.SYSTEM, tools: [prefix.TOOL] });
    const sys = await client.messages.countTokens({ ...stub, system: prefix.SYSTEM });
    // The 4,096 minimum is tested against the block the breakpoint sits on — the system block —
    // not the whole prefix. See the note in prefix.ts.
    console.log(`system block ${sys.input_tokens} tok · tools+system ${whole.input_tokens} tok`);
    console.log(sys.input_tokens >= 4096 ? 'cacheable' : `NOT cacheable: system block is ${4096 - sys.input_tokens} tokens short of Haiku 4.5's 4096 minimum`);
    await getPool().end();
    return;
  }

  if (EXPLAIN) {
    const plan = await q<{ 'QUERY PLAN': string }>(`explain (analyze, buffers) ${selectSql()}`, [DAYS, LIMIT]);
    console.log(plan.map((r) => r['QUERY PLAN']).join('\n'));
    await getPool().end();
    return;
  }

  const videos = await q<Video>(selectSql(), [DAYS, LIMIT]);
  console.log(`model ${MODEL} · ${RETAG ? 'RETAG already-tagged' : 'untagged'} in ${DAYS}d ${videos.length} · batch ${BATCH} · concurrency ${CONCURRENCY} · cap $${MAX_USD}`);
  if (DRY_RUN || videos.length === 0) { await getPool().end(); return; }

  const batches: Video[][] = [];
  for (let i = 0; i < videos.length; i += BATCH) batches.push(videos.slice(i, i + BATCH));

  const runId = (await q<{ id: string }>(
    `insert into angle_tag_runs (model, notes) values ($1, $2) returning id`,
    [MODEL, `tag-outliers --limit ${LIMIT} --max-usd ${MAX_USD} --days ${DAYS}${RETAG ? ' --retag' : ''}`]
  ))[0].id;

  let cursor = 0;
  let stopped = false;
  const runOne = async (index: number) => {
    try {
      await writeBatch(await tagBatch(batches[index]));
    } catch (error: any) {
      spend.failed += batches[index].length;
      console.error(`batch ${index} failed: ${error?.message}`);
    }
  };

  // Batch 0 runs alone so that IF the prefix ever caches (see prefix.ts — today it cannot, the
  // system block is under Haiku 4.5's 4,096-token minimum) it is written once and read fifteen
  // times, rather than sixteen cold requests each paying the full prefix.
  cursor = 1;
  await runOne(0);
  console.log(`  warmup · cacheWrite ${spend.cacheWrite} · cacheRead ${spend.cacheRead}`);

  const worker = async () => {
    while (!stopped) {
      const index = cursor++;
      if (index >= batches.length) return;
      if (spend.usd > MAX_USD) { stopped = true; console.error(`STOP: $${spend.usd.toFixed(3)} over cap $${MAX_USD}`); return; }
      await runOne(index);
      if (spend.requests % 10 === 0) {
        console.log(`  ${spend.requests}/${batches.length} req · $${spend.usd.toFixed(3)} · in ${spend.in} cacheRead ${spend.cacheRead} cacheWrite ${spend.cacheWrite} out ${spend.out} · failed ${spend.failed} · noImage ${spend.noImage}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await q(
    `update angle_tag_runs set finished_at = now(), videos = $2, requests = $3, input_tokens = $4,
            output_tokens = $5, cache_read_tokens = $6, cache_write_tokens = $7, usd = $8
      where id = $1`,
    [runId, spend.videos, spend.requests, spend.in, spend.out, spend.cacheRead, spend.cacheWrite, Number(spend.usd.toFixed(6))]
  );

  console.log(JSON.stringify({ ...spend, usd: Number(spend.usd.toFixed(4)), run_id: runId }, null, 2));
  await getPool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
