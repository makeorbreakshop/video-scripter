// Dump the anchor channel's niche bands (near / adjacent / far, closest-first) so the review sheet
// can spread its examples across the neighbourhood instead of showing one channel forty times.
//
//   npx tsx scripts/angles/dump-bands.ts --channel UC... --out bands.json
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
config({ path: path.resolve(process.cwd(), '.env.local') });
import { channelRelations } from '../../lib/semantic/channel-relations';

const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const channel = arg('--channel'); const out = arg('--out');
  if (!channel || !out) throw new Error('--channel and --out are required');
  const r = await channelRelations(channel, { limit: 3_000 });
  // rank is distance from the anchor: the sheet shows nearest first.
  const rows: Record<string, { band: string; rank: number; name: string }> = {
    [channel]: { band: 'anchor', rank: -1, name: 'anchor' },
  };
  let rank = 0;
  for (const [band, list] of [['near', r.near], ['adjacent', r.adjacent], ['far', r.far]] as const) {
    for (const c of list) rows[c.channel_id] = { band, rank: rank++, name: c.channel_name };
  }
  fs.writeFileSync(out, JSON.stringify(rows));
  console.log(`near ${r.near.length} · adjacent ${r.adjacent.length} · far ${r.far.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
