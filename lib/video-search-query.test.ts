import fs from 'fs';
import path from 'path';

describe('video search query performance contract', () => {
  const route = fs.readFileSync(
    path.join(__dirname, '..', 'app/api/videos/search/route.ts'),
    'utf8'
  );

  it('uses the primary-key index instead of sorting the full classified corpus', () => {
    expect(route).toMatch(/\.order\(['"]id['"],\s*\{\s*ascending:\s*true\s*\}\)/);
    expect(route).not.toMatch(/\.order\(['"]published_at['"]/);
  });

  it('keeps free-text matching inside a bounded candidate window', () => {
    expect(route).toMatch(/candidateLimit/);
    expect(route).toMatch(/\.slice\(0,\s*limit\)/);
    expect(route).not.toMatch(/dbQuery\s*=\s*dbQuery\.or/);
  });

  it('caps the caller-controlled result limit', () => {
    expect(route).toMatch(/Math\.min\([^\n]*100/);
  });
});
