import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
// Local worker archive. All receipts (including repeated bodies) survive independently of
// observation dedupe. Two days, with an additional 8 GiB budget (newest segment retained even if oversized); expirations are reported.
export const ARCHIVE_RETENTION_MS = 48 * 3600000;
export const ARCHIVE_MAX_BYTES = 8 * 1024 ** 3;
export async function archiveResponses(root: string, fetchedAt: number, receipts: unknown[], limits = { ageMs: ARCHIVE_RETENTION_MS, bytes: ARCHIVE_MAX_BYTES }) {
  await fs.mkdir(root, { recursive: true });
  const name = `${fetchedAt}.jsonl.gz`;
  const bytes = gzipSync(receipts.map(r => JSON.stringify(r)).join('\n') + '\n');
  const destination = path.join(root, name);
  try { await fs.access(destination); throw new Error('Archive already exists'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const temporary = `${destination}.pending`;
  const file = await fs.open(temporary, 'wx');
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await fs.rename(temporary, destination);
  const files = await Promise.all((await fs.readdir(root)).filter(n => /^\d+\.jsonl\.gz$/.test(n)).map(async n => ({ name: n, time: Number(n.split('.')[0]), bytes: (await fs.stat(path.join(root, n))).size })));
  files.sort((a,b) => a.time - b.time);
  let totalBytes = files.reduce((sum,f) => sum+f.bytes,0);
  const expired: string[] = [];
  for (const f of files) {
    if (f.name === name) continue;
    if (f.time >= fetchedAt-limits.ageMs && totalBytes <= limits.bytes) continue;
    await fs.unlink(path.join(root, f.name)); totalBytes -= f.bytes; expired.push(f.name);
  }
  return { name, bytes: bytes.length, totalBytes, expired, overBudget: totalBytes > limits.bytes };
}
