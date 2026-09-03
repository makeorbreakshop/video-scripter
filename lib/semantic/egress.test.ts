import fs from 'fs';
import path from 'path';

describe('semantic bulk-work egress guard', () => {
  test('uses direct Postgres and never the Supabase client or REST endpoint', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'scripts/semantic'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => `scripts/semantic/${file}`);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/@supabase\/supabase-js|createClient\s*\(|\/rest\/v1/i);
    }
  });
});
