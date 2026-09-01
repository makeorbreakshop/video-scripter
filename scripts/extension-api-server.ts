// Standalone extension API — the Chrome extension's read path, decoupled from
// the Next.js dev server. Runs always-on under launchd
// (com.mfm.video-scripter-extension-api) on port 3210, direct Postgres via the
// transaction pooler (never Supabase REST — 2026-08-31 egress rules).
//
// Endpoints (same contracts as the app/api/extension/* routes):
//   POST /api/extension/status  {ids:[...]} -> {tracked,queued,captured}
//   GET  /api/extension/view?name=ext_stats|ext_growth|ext_candidates|ext_recent
//   POST /api/extension/diag    (append to logs/extension-diag.jsonl)
//   GET  /api/extension/diag    (last 50 entries)
//   GET  /health
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import pg from 'pg';

const PORT = parseInt(process.env.EXTENSION_API_PORT || '3210', 10);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL,
  max: 2,
});

const VIEWS = new Set(['ext_stats', 'ext_growth', 'ext_candidates', 'ext_recent']);
const DIAG_FILE = path.join(process.cwd(), 'logs', 'extension-diag.jsonl');

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 200_000) throw new Error('body too large');
  }
  return data ? JSON.parse(data) : {};
}

// Which of these channel refs (UC ids or @handles, normalized lowercase/no-@)
// exist in ANY registry? Mirrors lib/nightly/enrollment-core's definition of
// "tracked" so the ★ new-channel badge agrees with what the drain will do.
async function knownChannelRefs(refs: string[]): Promise<string[]> {
  const norm = [...new Set(refs.map((r) => r.replace(/^@/, '').toLowerCase()))].slice(0, 100);
  const ucids = norm.filter((r) => /^uc[a-z0-9_-]{22}$/.test(r));
  const handles = norm.filter((r) => !ucids.includes(r));
  const known = new Set<string>();
  if (ucids.length) {
    const q = await pool.query(
      `select lower(id) ref from (
         select youtube_channel_id id from competitor_youtube_channels where lower(youtube_channel_id) = any($1)
         union select channel_id from discovered_channels where lower(channel_id) = any($1)
         union select channel_id from channels where lower(channel_id) = any($1)
         union select distinct channel_id from videos where lower(channel_id) = any($1)
       ) t`,
      [ucids]
    );
    for (const r of q.rows) known.add(r.ref);
  }
  if (handles.length) {
    const q = await pool.query(
      `select lower(ltrim(channel_handle,'@')) ref from channels where lower(ltrim(channel_handle,'@')) = any($1)
       union select lower(ltrim(channel_handle,'@')) from discovered_channels where lower(ltrim(channel_handle,'@')) = any($1)`,
      [handles]
    );
    for (const r of q.rows) known.add(r.ref);
  }
  return [...known];
}

async function handleStatus(req: http.IncomingMessage, res: http.ServerResponse) {
  const { ids, channels } = await readBody(req);
  if (!Array.isArray(ids)) return send(res, 400, { error: 'ids must be an array' });
  const knownChannels = Array.isArray(channels) && channels.length
    ? await knownChannelRefs(channels.filter((c: unknown) => typeof c === 'string'))
    : [];
  const clean = [...new Set(ids)]
    .filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(id))
    .slice(0, 500);
  if (!clean.length) return send(res, 200, { tracked: [], queued: [], captured: [], knownChannels });
  const [vids, queue] = await Promise.all([
    pool.query(`select id from videos where id = any($1)`, [clean]),
    pool.query(
      `select ref, processed_at from touch_queue where kind = 'video' and ref = any($1)`,
      [clean]
    ),
  ]);
  const tracked = new Set<string>(vids.rows.map((r) => r.id));
  const queued: string[] = [];
  const captured: string[] = [];
  for (const r of queue.rows) {
    if (tracked.has(r.ref)) continue;
    (r.processed_at ? captured : queued).push(r.ref);
  }
  send(res, 200, { tracked: [...tracked], queued, captured, knownChannels });
}

async function handleView(url: URL, res: http.ServerResponse) {
  const name = url.searchParams.get('name') ?? '';
  if (!VIEWS.has(name)) return send(res, 400, { error: 'unknown view' });
  const { rows } = await pool.query(`select * from ${name} limit 200`);
  send(res, 200, rows);
}

async function handleDiag(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === 'POST') {
    const body = await readBody(req);
    const entry = JSON.stringify({
      at: new Date().toISOString(),
      version: String(body.version ?? ''),
      page: String(body.page ?? '').slice(0, 120),
      idsKnown: Number(body.idsKnown ?? 0),
      fingerprint: String(body.fingerprint ?? '').slice(0, 500),
    });
    await fs.appendFile(DIAG_FILE, entry + '\n');
    return send(res, 200, { ok: true });
  }
  const text = await fs.readFile(DIAG_FILE, 'utf8').catch(() => '');
  send(res, 200, text.trim().split('\n').filter(Boolean).slice(-50).map((l) => JSON.parse(l)));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (url.pathname === '/health') return send(res, 200, { ok: true, at: new Date().toISOString() });
    if (url.pathname === '/api/extension/status' && req.method === 'POST') return await handleStatus(req, res);
    if (url.pathname === '/api/extension/view' && req.method === 'GET') return await handleView(url, res);
    if (url.pathname === '/api/extension/diag') return await handleDiag(req, res);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : 'unknown error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`extension-api listening on 127.0.0.1:${PORT}`);
});
