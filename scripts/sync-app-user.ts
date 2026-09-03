// Copy one app_users row's tracked channels onto another's.
//
// Dev and prod share one database, but Clerk's test and live instances mint different
// clerk_ids, so the same person owns one app_users row per instance and each row carries
// its own user_channels. This mirrors the follows from one row to the other, leaving the
// two identities separate — local writes stay local.
//
// Reach for lib/app/session.ts's CS_DEV_AS_CLERK_ID instead when you want dev to read and
// write the production row itself.
//
//   npx tsx scripts/sync-app-user.ts                 # CS_PROD_CLERK_ID -> CS_DEV_CLERK_ID
//   npx tsx scripts/sync-app-user.ts --dry           # show the plan, change nothing
//   npx tsx scripts/sync-app-user.ts --prune         # also drop follows the source lacks
//   npx tsx scripts/sync-app-user.ts --from user_a --to user_b
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' }); dotenv.config({ path: '.env' });

const { q, getPool } = await import('../lib/admin/db');

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const dry = process.argv.includes('--dry');
const prune = process.argv.includes('--prune');
const fromClerk = arg('from') || process.env.CS_PROD_CLERK_ID;
const toClerk = arg('to') || process.env.CS_DEV_CLERK_ID;

if (!fromClerk || !toClerk) {
  console.error('need a source and target clerk_id: pass --from/--to, or set CS_PROD_CLERK_ID and CS_DEV_CLERK_ID');
  process.exit(1);
}
if (fromClerk === toClerk) {
  console.error('--from and --to are the same row; nothing to sync');
  process.exit(1);
}

interface Row { user_id: string; channel_id: string; role: string; watched_closely: boolean }

/** The app_users row for a clerk_id, or exit with a readable error. */
async function resolve(clerkId: string, label: string) {
  const rows = await q<{ id: string; email: string | null; plan: string }>(
    `select id, email, plan from app_users where clerk_id = $1`, [clerkId]
  );
  if (!rows[0]) { console.error(`${label}: no app_users row for ${clerkId}`); process.exit(1); }
  return rows[0];
}

const src = await resolve(fromClerk, '--from');
const dst = await resolve(toClerk, '--to');

const follows = await q<Row>(
  `select user_id, channel_id, role, watched_closely from user_channels where user_id = $1
    order by channel_id`, [src.id]
);
const existing = await q<Row>(
  `select user_id, channel_id, role, watched_closely from user_channels where user_id = $1`, [dst.id]
);

const have = new Map(existing.map((r) => [r.channel_id, r]));
const srcIds = new Set(follows.map((r) => r.channel_id));
const added = follows.filter((r) => !have.has(r.channel_id));
const changed = follows.filter((r) => {
  const cur = have.get(r.channel_id);
  return cur && (cur.role !== r.role || cur.watched_closely !== r.watched_closely);
});
const extra = existing.filter((r) => !srcIds.has(r.channel_id));

// Names are cosmetic: a followed channel need not have a channels row yet.
const names = new Map(
  (await q<{ channel_id: string; channel_name: string | null }>(
    `select channel_id, channel_name from channels where channel_id = any($1::text[])`,
    [[...new Set([...follows, ...existing].map((r) => r.channel_id))]]
  )).map((r) => [r.channel_id, r.channel_name])
);
const name = (id: string) => names.get(id) || id;

console.log(`from ${fromClerk}  ${src.email ?? '(no email)'} plan=${src.plan}  ${follows.length} follows`);
console.log(`to   ${toClerk}  ${dst.email ?? '(no email)'} plan=${dst.plan}  ${existing.length} follows\n`);

for (const r of added) console.log(`  + ${name(r.channel_id)}${r.watched_closely ? ' (watched)' : ''}`);
for (const r of changed) console.log(`  ~ ${name(r.channel_id)} -> role=${r.role}${r.watched_closely ? ' watched' : ''}`);
for (const r of extra) console.log(`  ${prune ? '-' : '!'} ${name(r.channel_id)}${prune ? '' : ' (only on the target; --prune to remove)'}`);
if (!added.length && !changed.length && !(prune && extra.length)) { console.log('  already in sync'); }

if (dry) { console.log('\n--dry: nothing written'); await getPool().end(); process.exit(0); }

// One statement per row keeps it readable and the volumes are tiny (plan caps are double digits).
let writes = 0;
for (const r of [...added, ...changed]) {
  await q(
    `insert into user_channels (user_id, channel_id, role, watched_closely)
     values ($1, $2, $3, $4)
     on conflict (user_id, channel_id) do update
       set role = excluded.role, watched_closely = excluded.watched_closely`,
    [dst.id, r.channel_id, r.role, r.watched_closely]
  );
  writes++;
}
if (prune) {
  for (const r of extra) {
    await q(`delete from user_channels where user_id = $1 and channel_id = $2`, [dst.id, r.channel_id]);
    writes++;
  }
}

const total = await q<{ n: string }>(`select count(*) as n from user_channels where user_id = $1`, [dst.id]);
console.log(`\n${writes} row(s) written; target now tracks ${total[0].n} channel(s)`);
await getPool().end();
