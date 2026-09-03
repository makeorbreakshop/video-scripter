import fs from 'fs/promises';
import path from 'path';
import { db, runMain, sinceDate } from './common';

interface ExpectedChannel { channel_id: string; name: string; grade: 1 | 2 }
interface GoldQuery { id: string; stratum: 'known_item' | 'discovery' | 'analogue'; query: string; expected_channels: ExpectedChannel[] }

const DISCOVERY_PATTERNS = [
  'laser engraver', 'laser cutting', 'woodworking', 'epoxy', '3d printing', 'air fryer', 'home cooking',
  'recipes', 'AI tools', 'artificial intelligence', 'home improvement', 'gardening', 'fitness', 'weight loss',
  'personal development', 'trading', 'crypto', 'smartphone', 'electric vehicle', 'travel', 'theme park',
  'Disney', 'chess', 'gaming', 'movie review', 'camera', 'photography', 'sewing', 'crafts', 'CNC', 'welding',
  'electronics', 'drones', 'home theater', 'coffee', 'baking', 'barbecue', 'cars', 'motorcycles', 'camping',
  'permaculture', 'SEO', 'business', 'marketing', 'politics', 'music', 'real estate', 'parenting',
];

const ANALOGUE_PATTERNS = [
  'how to', 'i tried', 'mistakes', 'before and after', 'versus', 'review', 'challenge', 'beginner', 'reaction', 'why',
];

function grade(rows: Array<{ channel_id: string; name: string }>): ExpectedChannel[] {
  return rows.slice(0, 5).map((row, index) => ({ ...row, grade: index < 2 ? 2 : 1 }));
}

async function expectedForTitlePattern(pattern: string, since: Date): Promise<ExpectedChannel[]> {
  const result = await db().query<{ channel_id: string; name: string }>(
    `select v.channel_id, max(coalesce(cm.title, v.channel_name, v.channel_id)) as name
       from videos v left join channel_meta cm on cm.channel_id = v.channel_id
      where v.published_at > $1 and coalesce(v.is_short, false) = false and v.duration <> 'P0D'
        and lower(v.title) like '%' || lower($2) || '%' and v.channel_id is not null
      group by v.channel_id
      order by count(*) desc, sum(coalesce(v.view_count, 0)) desc
      limit 5`,
    [since, pattern],
  );
  return grade(result.rows);
}

export async function buildGold(): Promise<GoldQuery[]> {
  const since = sinceDate('30d');
  const queries: GoldQuery[] = [];
  const known = await db().query<{ channel_id: string; name: string; handle: string }>(
    `select channel_id, name, handle from channel_directory
      where name is not null and handle is not null
      order by video_count desc, channel_id
      limit 10`,
  );
  for (const [index, target] of known.rows.entries()) {
    const neighbours = await db().query<{ channel_id: string; name: string }>(
      `select channel_id, name from channel_directory
        where channel_id <> $1
        order by similarity(name, $2) desc, video_count desc
        limit 4`,
      [target.channel_id, target.name],
    );
    const query = index % 3 === 0 ? target.name : index % 3 === 1 ? `@${target.handle}` : target.name.replace(/[aeiou]/i, '');
    queries.push({
      id: `known-${String(index + 1).padStart(2, '0')}`,
      stratum: 'known_item',
      query,
      expected_channels: [{ channel_id: target.channel_id, name: target.name, grade: 2 }, ...grade(neighbours.rows)],
    });
  }

  for (const term of DISCOVERY_PATTERNS) {
    const expected = await expectedForTitlePattern(term, since);
    if (expected.length < 5) continue;
    queries.push({ id: `discovery-${String(queries.length - 9).padStart(2, '0')}`, stratum: 'discovery', query: term, expected_channels: expected });
    if (queries.filter((query) => query.stratum === 'discovery').length === 20) break;
  }

  for (const pattern of ANALOGUE_PATTERNS) {
    const expected = await expectedForTitlePattern(pattern, since);
    if (expected.length < 5) continue;
    queries.push({
      id: `analogue-${String(queries.filter((query) => query.stratum === 'analogue').length + 1).padStart(2, '0')}`,
      stratum: 'analogue',
      query: pattern,
      expected_channels: expected,
    });
  }

  if (queries.length !== 40) throw new Error(`Expected 40 SQL-grounded queries, built ${queries.length}`);
  return queries;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain(async () => {
    const queries = await buildGold();
    const output = {
      version: 1,
      generated_at: new Date().toISOString(),
      source: 'Direct PostgreSQL over the indexed 30-day long-form window and channel_directory; no channel ids were invented.',
      labeling_status: 'sql_seeded_requires_blind_pool_adjudication',
      queries,
    };
    const outputPath = path.resolve('docs/prd/semantic-gold-channels.json');
    await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`wrote ${queries.length} queries to ${outputPath}`);
  });
}
