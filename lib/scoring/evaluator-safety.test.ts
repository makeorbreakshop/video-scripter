import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'scripts/evaluate-rss-coordination.ts'),
  'utf8',
);

describe('RSS coordination evaluator database safety', () => {
  test('uses one explicit read-only transaction with a local timeout', () => {
    expect(source).toMatch(/begin isolation level repeatable read read only/i);
    expect(source).toMatch(/set local statement_timeout/i);
    expect(source).toMatch(/(?:rollback|commit)/i);
  });

  test('never changes persistent read-only or timeout defaults', () => {
    expect(source).not.toMatch(/default_transaction_read_only/i);
    expect(source).not.toMatch(/set\s+(?!local\b)(?:session\s+)?statement_timeout/i);
  });
});
