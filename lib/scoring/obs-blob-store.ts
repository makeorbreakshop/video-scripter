// A local copy of video_obs_cache blobs, so a scorer run fetches only the blobs that changed.
//
// Measured 2026-09-29 with the client egress meter (lib/ops/egress-meter.ts): the 5-minute scorer
// received ~7.7 MB per run, 93 % of it `observation.cache-read` — the same prior videos' blobs
// re-read every run (a channel's 30 priors are shared by all its targets, and most targets are
// deferred and re-selected five minutes later). With this store the read sends the md5 of the blob
// it already holds and Postgres returns the bytea only when the content differs
// (OBS_CACHE_READ_VERSIONED_SQL). Staleness cannot creep in: the version IS the content hash, and
// the server-side current-watermark filter is unchanged, so a dirty row is still a miss.
//
// On disk: <dir>/<first two chars of id>/<id>, holding "<md5>\n<format>\n" then the blob. A file
// that does not hash to its header is ignored. ~1.7 KB per video; the whole cache table is
// ~375 K rows, so the worst case is well under 1 GB, and in practice it is the active priors.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface StoredBlob { version: string; format: number; obs: Buffer }

export interface ObsBlobStore {
  get(id: string): StoredBlob | null;
  put(id: string, format: number, obs: Buffer): void;
}

/** md5 hex of the blob — equal to Postgres md5(bytea). */
export const blobVersion = (obs: Buffer | Uint8Array) => crypto.createHash('md5').update(obs).digest('hex');

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class MemoryObsBlobStore implements ObsBlobStore {
  private m = new Map<string, StoredBlob>();
  get(id: string) { return this.m.get(id) ?? null; }
  put(id: string, format: number, obs: Buffer) { this.m.set(id, { version: blobVersion(obs), format, obs }); }
}

export class DiskObsBlobStore implements ObsBlobStore {
  readonly dir: string;
  constructor(dir: string) { this.dir = dir; }

  private file(id: string) { return path.join(this.dir, id.slice(0, 2), id); }

  get(id: string): StoredBlob | null {
    if (!SAFE_ID.test(id)) return null;
    let buf: Buffer;
    try { buf = fs.readFileSync(this.file(id)); } catch { return null; }
    const nl1 = buf.indexOf(0x0a);
    const nl2 = nl1 < 0 ? -1 : buf.indexOf(0x0a, nl1 + 1);
    if (nl2 < 0) return null;
    const version = buf.subarray(0, nl1).toString('ascii');
    const format = Number(buf.subarray(nl1 + 1, nl2).toString('ascii'));
    const obs = buf.subarray(nl2 + 1);
    return blobVersion(obs) === version && Number.isInteger(format) ? { version, format, obs } : null;
  }

  put(id: string, format: number, obs: Buffer): void {
    if (!SAFE_ID.test(id)) throw new Error(`obs blob store: unsafe id ${JSON.stringify(id)}`);
    const f = this.file(id);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, Buffer.concat([Buffer.from(`${blobVersion(obs)}\n${format}\n`, 'ascii'), obs]));
    fs.renameSync(tmp, f); // atomic: a concurrent reader sees the old file or the new one
  }
}
