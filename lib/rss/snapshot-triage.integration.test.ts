// Parity on a real tick: for every entry of a recent raw feed archive segment, the triaged
// snapshot must reach exactly the decisions the old full snapshot reached — known or not, title
// change, description seed/change, thumbnail due, reading stored. Read-only; ~3,000 entries.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';
import { parseRssEntries, shouldStoreSample, unknownEntryPlan, isUpdatedSince, LAST_SAMPLES_SQL,
         SAMPLE_HEARTBEAT_MS, type RssEntry } from './poll-policy';
import { SNAPSHOT_TRIAGE_SQL, Triage, triageParams, type TriageEntry } from './snapshot-triage';

const d = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(120_000);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const canon = (o: object) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
const MAX = Number(process.env.TRIAGE_PARITY_ENTRIES ?? 3000);

function recentEntries(): TriageEntry[] {
  const dir = path.join(process.cwd(), 'logs', 'rss-responses');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl.gz')).sort().reverse();
  const out: TriageEntry[] = [];
  for (const f of files) {
    for (const line of gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.status !== 200 || !r.body) continue;
      for (const entry of parseRssEntries(r.body)) out.push({ entry, observedAt: new Date(r.fetchedAt) });
      if (out.length >= MAX) return out;
    }
  }
  return out;
}

type Full = { title?: string | null; descVersion?: number; descSha?: string; thumbVersion?: number;
              thumbLastChecked?: Date; last?: { views: number | null; at: Date } };

async function fullRead(c: pg.Client, ids: string[]): Promise<{ known: Set<string>; rows: Map<string, Full> }> {
  const rows = new Map<string, Full>();
  const known = new Set<string>();
  if (!ids.length) return { known, rows };
  const get = (id: string) => rows.get(id) ?? (rows.set(id, {}), rows.get(id)!);
  for (const r of (await c.query('select id, title from videos where id = any($1)', [ids])).rows) { known.add(r.id); get(r.id).title = r.title; }
  for (const r of (await c.query(`select distinct on (video_id) video_id, version, sha256 from description_versions
      where video_id = any($1) order by video_id, version desc`, [ids])).rows) Object.assign(get(r.video_id), { descVersion: r.version, descSha: r.sha256 });
  for (const r of (await c.query(`select distinct on (video_id) video_id, version, last_checked from thumbnail_versions
      where video_id = any($1) order by video_id, version desc`, [ids])).rows) Object.assign(get(r.video_id), { thumbVersion: r.version, thumbLastChecked: r.last_checked });
  for (const r of (await c.query(LAST_SAMPLES_SQL, [ids])).rows) get(r.video_id).last = { views: r.views == null ? null : Number(r.views), at: r.at };
  return { known, rows };
}

/** The old diff's decisions for one entry, given its full snapshot row. */
function decide(e: RssEntry, at: Date, known: boolean, cur: Full | undefined, sampleGate = true) {
  if (!known) return { known, sample: sampleGate && unknownEntryPlan(e, at, cur?.last).sample };
  const feedSha = e.description != null ? sha(e.description) : null;
  return {
    known,
    sample: sampleGate && shouldStoreSample(cur?.last, e.views, at),
    title: Boolean(e.title && cur?.title && e.title !== cur.title),
    desc: feedSha == null ? 'none' : cur?.descVersion == null ? 'seed' : cur.descSha !== feedSha ? 'change' : 'none',
    thumb: Boolean(cur?.thumbVersion != null && cur.thumbLastChecked && cur.thumbLastChecked > new Date(0)
                   && isUpdatedSince(e.updated, cur.thumbLastChecked)),
  };
}

d('snapshot triage parity', () => {
  it('reaches the same decision as the full snapshot for every entry of a real tick', async () => {
    const items = recentEntries();
    expect(items.length).toBeGreaterThan(500);
    // A processed tick has few live changes; perturb some entries so every flag is exercised.
    items.slice(0, 40).forEach((it, i) => {
      const e = { ...it.entry };
      if (i % 4 === 0) e.title = `${e.title} (edited)`;
      if (i % 4 === 1) e.description = `${e.description ?? ''} edited`;
      if (i % 4 === 2) e.updated = new Date(Date.now() + 3_600_000).toISOString();
      if (i % 4 === 3) e.views = (e.views ?? 0) + 1;
      it.entry = e;
    });
    const ids = [...new Set(items.map((i) => i.entry.video_id))];
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      const old = await fullRead(c, ids);
      const t = new Triage();
      t.add((await c.query(SNAPSHOT_TRIAGE_SQL, triageParams(items, sha, SAMPLE_HEARTBEAT_MS))).rows);
      const fullIds = t.fullReadIds();
      const fresh = await fullRead(c, fullIds);
      const quiet = new Set(t.quietKnownIds(ids));

      const mismatches: string[] = [];
      let quietCount = 0;
      for (const { entry: e, observedAt } of items) {
        const want = decide(e, observedAt, old.known.has(e.video_id), old.rows.get(e.video_id));
        let got;
        if (!t.known(e.video_id)) {
          got = decide(e, observedAt, false, { last: t.lastSamples.get(e.video_id) }, t.sampleMayStore(e.video_id));
        } else if (quiet.has(e.video_id)) {
          quietCount++;
          got = { known: true, title: false, desc: 'none', thumb: false,
                  sample: t.sampleMayStore(e.video_id) && shouldStoreSample(t.lastSamples.get(e.video_id), e.views, observedAt) };
        } else {
          got = decide(e, observedAt, true, fresh.rows.get(e.video_id), t.sampleMayStore(e.video_id));
        }
        if (canon(got) !== canon(want)) mismatches.push(`${e.video_id}: ${canon(got)} != ${canon(want)}`);
      }
      console.log(`${items.length} entries, ${ids.length} ids: ${t.masks.size} returned by triage, ${fullIds.length} full reads, ${quietCount} quiet entries`);
      expect(mismatches.slice(0, 10)).toEqual([]);
      expect(fullIds.length).toBeGreaterThan(0);
    } finally {
      await c.end();
    }
  });
});
