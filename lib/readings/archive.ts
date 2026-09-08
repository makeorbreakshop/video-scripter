// The R2 archive: every raw reading, forever, in a private bucket.
//
// Bucket `channelsmith-readings` (env R2_READINGS_BUCKET), separate from the public
// `channelsmith-thumbnails` bucket and its Worker — nothing here touches those.
//
//   readings/source=<rss|api>/day=YYYY-MM-DD/part-0.parquet   the day's readings, sorted by video_id
//   readings/source=<rss|api>/day=YYYY-MM-DD/index.json       video_id -> [rowOffset, rowCount]
//   history/day=YYYY-MM-DD/part-0.parquet                     video_score_history for that day
//
// Sorted by video_id so a per-video slice is one contiguous run; the index turns "give me this
// video's readings for this day" into a bounded scan instead of a full-file walk.
//
// `at` is stored as INT64 epoch millis, not TIMESTAMP_MILLIS: parquetjs-lite's timestamp
// encoder throws "Cannot convert a BigInt value to a number" on Node 22+. Epoch millis is
// lossless, and DuckDB reads it with to_timestamp(at/1000).
//
// Without R2_* credentials every entry point here returns null / throws a named error rather
// than half-working, so the callers can run in --dry-run and say so out loud.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  checksum, checksumStream, ms, readingsKey, readingsIndexKey, historyKey, buildRowIndex, sortForArchive,
  utcDay, dayRange, type Reading, type ReadingSource, type RowRangeIndex,
} from './retention';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Null when any credential is missing — the signal the callers turn into "archive not verified". */
export function r2Config(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_READINGS_BUCKET || 'channelsmith-readings';
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export const MISSING_CREDENTIALS =
  'archive not verified: no credentials (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local)';

type S3Client = import('@aws-sdk/client-s3').S3Client;
let client: S3Client | null = null;
let clientFor: string | null = null;

async function s3(cfg: R2Config): Promise<S3Client> {
  const { S3Client } = await import('@aws-sdk/client-s3');
  if (!client || clientFor !== cfg.accountId) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    clientFor = cfg.accountId;
  }
  return client;
}

export async function putObject(cfg: R2Config, key: string, body: Buffer, contentType: string): Promise<void> {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const c = await s3(cfg);
  await c.send(new PutObjectCommand({
    Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType,
  }));
}

/** null for a key that is not there — a missing day is a fact, not an error. */
export async function getObject(cfg: R2Config, key: string): Promise<Buffer | null> {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const c = await s3(cfg);
  try {
    const res = await c.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch (e) {
    const name = (e as { name?: string; $metadata?: { httpStatusCode?: number } });
    if (name.name === 'NoSuchKey' || name.name === 'NotFound' || name.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

/**
 * Every key under a prefix, with its size. Paged, so a bucket with thousands of day-partitions
 * is one loop rather than one call that silently truncates at 1,000.
 */
export async function listObjects(
  cfg: R2Config, prefix: string
): Promise<{ key: string; size: number; modified: number }[]> {
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const c = await s3(cfg);
  const out: { key: string; size: number; modified: number }[] = [];
  let token: string | undefined;
  do {
    const res = await c.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of res.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, size: Number(o.Size ?? 0), modified: o.LastModified?.getTime() ?? 0 });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function objectExists(cfg: R2Config, key: string): Promise<boolean> {
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const c = await s3(cfg);
  try {
    await c.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return true;
  } catch { return false; }
}

// ---- parquet ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
async function parquet(): Promise<any> {
  return (await import('parquetjs-lite')) as any;
}

async function readingsSchema() {
  const pq = await parquet();
  const P = pq.ParquetSchema ?? pq.default?.ParquetSchema;
  return new P({
    video_id: { type: 'UTF8' },
    at: { type: 'INT64' },                       // epoch millis, UTC
    views: { type: 'INT64', optional: true },
    likes: { type: 'INT64', optional: true },
    source: { type: 'UTF8' },
    time_basis: { type: 'UTF8', optional: true },
    // Added 2026-09-08 for the parquet harness. lib/scoring/observations.ts filters rss on
    // `model_eligible and not conflicted`; without these the archive cannot answer the question
    // the scorer actually asks. Optional, and read back with coalesce(…, true/false), so days
    // archived before this change still parse — they are simply unfiltered, as they were.
    model_eligible: { type: 'BOOLEAN', optional: true },
    conflicted: { type: 'BOOLEAN', optional: true },
    received_at: { type: 'INT64', optional: true },
  });
}

async function historySchema() {
  const pq = await parquet();
  const P = pq.ParquetSchema ?? pq.default?.ParquetSchema;
  return new P({
    id: { type: 'UTF8' },
    video_id: { type: 'UTF8' },
    channel_id: { type: 'UTF8', optional: true },
    model_version: { type: 'UTF8', optional: true },
    scored_at: { type: 'INT64' },
    age_days: { type: 'DOUBLE', optional: true },
    views: { type: 'INT64', optional: true },
    score: { type: 'DOUBLE', optional: true },
    same_age_ratio: { type: 'DOUBLE', optional: true },
    typical_at_age: { type: 'DOUBLE', optional: true },
    n_typical: { type: 'INT64', optional: true },
    typical_measured_share: { type: 'DOUBLE', optional: true },
    projection: { type: 'DOUBLE', optional: true },
    projection_horizon: { type: 'DOUBLE', optional: true },
    est30: { type: 'DOUBLE', optional: true },
    baseline: { type: 'DOUBLE', optional: true },
    n_baseline: { type: 'INT64', optional: true },
    confidence: { type: 'UTF8', optional: true },
    extra: { type: 'UTF8', optional: true },     // the jsonb column, verbatim JSON text
  });
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null || !Number.isFinite(n) ? null : Math.round(n);
};

async function writeParquet(schema: any, rows: readonly Record<string, unknown>[]): Promise<Buffer> {
  const pq = await parquet();
  const W = pq.ParquetWriter ?? pq.default?.ParquetWriter;
  const file = path.join(os.tmpdir(), `readings-${randomUUID()}.parquet`);
  const writer = await W.openFile(schema, file, { compression: 'SNAPPY' });
  try {
    for (const r of rows) await writer.appendRow(r);
  } finally {
    await writer.close();
  }
  const buf = await fs.readFile(file);
  await fs.rm(file, { force: true });
  return buf;
}

async function readParquet(buf: Buffer): Promise<Record<string, unknown>[]> {
  const pq = await parquet();
  const R = pq.ParquetReader ?? pq.default?.ParquetReader;
  const file = path.join(os.tmpdir(), `readings-${randomUUID()}.parquet`);
  await fs.writeFile(file, buf);
  try {
    const reader = await R.openFile(file);
    const cursor = reader.getCursor();
    const out: Record<string, unknown>[] = [];
    let row: Record<string, unknown> | null;
    // eslint-disable-next-line no-cond-assign
    while ((row = await cursor.next())) out.push(row);
    await reader.close();
    return out;
  } finally {
    await fs.rm(file, { force: true });
  }
}

/** Parquet gives INT64 back as BigInt; the rest of the app wants numbers. */
function decodeReading(r: Record<string, unknown>): Reading & { at: string } {
  return {
    video_id: String(r.video_id),
    at: new Date(Number(r.at)).toISOString(),
    views: r.views === null || r.views === undefined ? null : Number(r.views),
    likes: r.likes === null || r.likes === undefined ? null : Number(r.likes),
    source: (r.source as ReadingSource) ?? undefined,
    time_basis: (r.time_basis as string | undefined) ?? null,
  };
}

export function encodeReading(r: Reading, source: ReadingSource): Record<string, unknown> {
  return {
    video_id: r.video_id,
    at: ms(r.at),
    views: int(r.views),
    likes: int(r.likes),
    source: r.source ?? source,
    time_basis: r.time_basis ?? null,
    model_eligible: (r as { model_eligible?: boolean }).model_eligible ?? null,
    conflicted: (r as { conflicted?: boolean }).conflicted ?? null,
    received_at: (r as unknown as { received_at?: string | Date | null }).received_at == null
      ? null : ms((r as unknown as { received_at: string | Date }).received_at),
  };
}

export function encodeHistory(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(r.id),
    video_id: String(r.video_id),
    channel_id: (r.channel_id as string) ?? null,
    model_version: (r.model_version as string) ?? null,
    scored_at: ms(r.scored_at as string | Date),
    age_days: num(r.age_days),
    views: int(r.views),
    score: num(r.score),
    same_age_ratio: num(r.same_age_ratio),
    typical_at_age: num(r.typical_at_age),
    n_typical: int(r.n_typical),
    typical_measured_share: num(r.typical_measured_share),
    projection: num(r.projection),
    projection_horizon: num(r.projection_horizon),
    est30: num(r.est30),
    baseline: num(r.baseline),
    n_baseline: int(r.n_baseline),
    confidence: (r.confidence as string) ?? null,
    extra: r.extra == null ? null : typeof r.extra === 'string' ? r.extra : JSON.stringify(r.extra),
  };
}

// ---- write / verify one day -------------------------------------------------------------

export interface WrittenDay {
  day: string;
  source: ReadingSource | 'history';
  key: string;
  rows: number;
  bytes: number;
  checksum: string;
}

/**
 * Write one day of readings. Idempotent: the same day always lands on the same key, so a
 * re-run overwrites rather than duplicates. Returns what to record in the ledger.
 */
export async function writeReadingsDay(
  cfg: R2Config, source: ReadingSource, day: string, rows: readonly Reading[]
): Promise<WrittenDay> {
  const sorted = sortForArchive(rows);
  const key = readingsKey(source, day);
  const buf = await writeParquet(await readingsSchema(), sorted.map((r) => encodeReading(r, source)));
  await putObject(cfg, key, buf, 'application/vnd.apache.parquet');
  const index: RowRangeIndex = buildRowIndex(sorted);
  await putObject(cfg, readingsIndexKey(source, day),
    Buffer.from(JSON.stringify({ day, source, rows: sorted.length, index }), 'utf8'), 'application/json');
  return { day, source, key, rows: sorted.length, bytes: buf.length, checksum: checksum(sorted) };
}

/**
 * The streaming form of writeReadingsDay, for days too big to hold twice in memory (a day of
 * rss_samples is ~1.7 M rows). Chunks MUST arrive in archive order — video_id, then time —
 * which is exactly what selectDaySql's `order by video_id, at` produces. The checksum is
 * accumulated as the rows go past, so the file and the digest come from one scan.
 */
export async function openReadingsDayWriter(cfg: R2Config, source: ReadingSource, day: string) {
  const pq = await parquet();
  const W = pq.ParquetWriter ?? pq.default?.ParquetWriter;
  const file = path.join(os.tmpdir(), `readings-${randomUUID()}.parquet`);
  const writer = await W.openFile(await readingsSchema(), file, { compression: 'SNAPPY' });
  const digest = checksumStream();
  const index: RowRangeIndex = {};
  let offset = 0;

  return {
    async push(rows: readonly Reading[]) {
      for (const r of rows) {
        await writer.appendRow(encodeReading(r, source));
        const cur = index[r.video_id];
        if (!cur) index[r.video_id] = [offset, 1]; else cur[1]++;
        offset++;
      }
      digest.push(rows);
    },
    get rows() { return offset; },
    async finish(): Promise<WrittenDay> {
      await writer.close();
      const buf = await fs.readFile(file);
      await fs.rm(file, { force: true });
      const key = readingsKey(source, day);
      await putObject(cfg, key, buf, 'application/vnd.apache.parquet');
      await putObject(cfg, readingsIndexKey(source, day),
        Buffer.from(JSON.stringify({ day, source, rows: offset, index }), 'utf8'), 'application/json');
      return { day, source, key, rows: offset, bytes: buf.length, checksum: digest.digest() };
    },
    async abort() {
      await writer.close().catch(() => {});
      await fs.rm(file, { force: true });
    },
  };
}

export async function writeHistoryDay(
  cfg: R2Config, day: string, rows: readonly Record<string, unknown>[]
): Promise<WrittenDay> {
  const key = historyKey(day);
  const buf = await writeParquet(await historySchema(), rows.map(encodeHistory));
  await putObject(cfg, key, buf, 'application/vnd.apache.parquet');
  // History's checksum uses the same (id-as-video_id, at, views) shape so one comparator serves both.
  const shaped = rows.map((r) => ({ video_id: String(r.id), at: r.scored_at as string, views: int(r.views) }));
  return { day, source: 'history', key, rows: rows.length, bytes: buf.length, checksum: checksum(shaped) };
}

/** Read one archived day back out of R2. null when the key is not there. */
export async function readReadingsDay(
  cfg: R2Config, source: ReadingSource, day: string
): Promise<(Reading & { at: string })[] | null> {
  const buf = await getObject(cfg, readingsKey(source, day));
  if (!buf) return null;
  return (await readParquet(buf)).map(decodeReading);
}

export async function readReadingsIndex(
  cfg: R2Config, source: ReadingSource, day: string
): Promise<RowRangeIndex | null> {
  const buf = await getObject(cfg, readingsIndexKey(source, day));
  if (!buf) return null;
  return (JSON.parse(buf.toString('utf8')) as { index: RowRangeIndex }).index;
}

export interface VerifyResult {
  ok: boolean;
  day: string;
  source: ReadingSource | 'history';
  pgRows: number;
  r2Rows: number;
  pgChecksum: string;
  r2Checksum: string;
  reason?: string;
}

/**
 * The gate. Reads the day back out of R2 and compares row count AND checksum against what
 * Postgres holds. Only an `ok: true` from here may be followed by a delete.
 */
export async function verifyReadingsDay(
  cfg: R2Config, source: ReadingSource, day: string, pgRows: readonly Reading[]
): Promise<VerifyResult> {
  const pgChecksum = checksum(pgRows);
  const back = await readReadingsDay(cfg, source, day);
  if (!back) {
    return { ok: false, day, source, pgRows: pgRows.length, r2Rows: 0, pgChecksum, r2Checksum: '', reason: 'object missing in R2' };
  }
  const r2Checksum = checksum(back);
  const ok = back.length === pgRows.length && r2Checksum === pgChecksum;
  return {
    ok, day, source, pgRows: pgRows.length, r2Rows: back.length, pgChecksum, r2Checksum,
    reason: ok ? undefined : back.length !== pgRows.length ? 'row count mismatch' : 'checksum mismatch',
  };
}

// ---- on-demand raw read -----------------------------------------------------------------

/**
 * Every archived reading for one video in [from, to]. This is what the video chart's `?raw=1`
 * toggle draws on top of the thinned Postgres series; the default chart path never calls it.
 *
 * Days are read one object at a time and the per-day index is consulted first, so a video that
 * was not tracked on a day costs one small JSON GET rather than a parquet parse. Returns [] —
 * never throws — when there are no credentials, so a page render can degrade instead of 500.
 */
export async function rawReadings(
  videoId: string,
  from: Date | string,
  to: Date | string,
  sources: readonly ReadingSource[] = ['rss', 'api'],
  cfg: R2Config | null = r2Config()
): Promise<(Reading & { at: string })[]> {
  if (!cfg) return [];
  const days = dayRange(from, to);
  const out: (Reading & { at: string })[] = [];
  const lo = ms(from), hi = ms(to);
  for (const day of days) {
    for (const source of sources) {
      try {
        const index = await readReadingsIndex(cfg, source, day);
        if (index && !index[videoId]) continue;          // this video has no rows that day
        const rows = await readReadingsDay(cfg, source, day);
        if (!rows) continue;
        for (const r of rows) {
          if (r.video_id !== videoId) continue;
          const t = ms(r.at);
          if (t >= lo && t <= hi) out.push(r);
        }
      } catch {
        // A single unreadable day must not lose the rest of the range.
      }
    }
  }
  return out.sort((a, b) => ms(a.at) - ms(b.at));
}

export { utcDay };
