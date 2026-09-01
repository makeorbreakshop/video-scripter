// WebSub (PubSubHubbub) receiver — the "doorbell" for real-time YouTube pushes.
// Zero dependencies, zero API keys: it only parses notifications and drops
// video IDs into touch_queue via the Supabase anon REST endpoint. The drainer
// (elsewhere) does all YouTube API work.
import http from 'http';
import crypto from 'crypto';

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const HUB_SECRET = process.env.WEBSUB_SECRET || '';

async function enqueue(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/touch_queue?on_conflict=kind,ref`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify(rows),
  });
  return res.ok;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200).end('ok');
    return;
  }
  if (url.pathname !== '/websub') {
    res.writeHead(404).end();
    return;
  }

  // Subscription verification handshake
  if (req.method === 'GET') {
    const challenge = url.searchParams.get('hub.challenge');
    if (challenge) {
      console.log(`verify ${url.searchParams.get('hub.mode')} ${url.searchParams.get('hub.topic')}`);
      res.writeHead(200).end(challenge);
    } else {
      res.writeHead(400).end();
    }
    return;
  }

  // Push notification
  if (req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 512 * 1024) { res.writeHead(413).end(); return; }
    }
    if (HUB_SECRET) {
      const sig = (req.headers['x-hub-signature'] || '').toString().replace('sha1=', '');
      const expect = crypto.createHmac('sha1', HUB_SECRET).update(body).digest('hex');
      if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
        res.writeHead(202).end(); // acknowledge but ignore per WebSub spec
        return;
      }
    }
    const rows = [];
    const re = /<yt:videoId>([A-Za-z0-9_-]{6,20})<\/yt:videoId>[\s\S]*?<yt:channelId>(UC[A-Za-z0-9_-]{22})<\/yt:channelId>/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      rows.push({ kind: 'video', ref: m[1], source_url: `websub:${m[2]}`, mode: 'websub', hint: null });
    }
    if (rows.length) {
      const ok = await enqueue(rows).catch(() => false);
      console.log(`push: ${rows.map((r) => r.ref).join(',')} -> ${ok ? 'queued' : 'ENQUEUE FAILED'}`);
    }
    res.writeHead(204).end();
    return;
  }
  res.writeHead(405).end();
});

server.listen(PORT, () => console.log(`websub receiver on :${PORT}`));
