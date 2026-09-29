// Local copies of rss_response_state rows, versioned by the server's md5(state::text).
// See lib/rss/response-store.ts (saveRssObservations) and response-state-cache.test.ts.
// One small JSON file per channel under <dir>; ~2.2 KB each, ~8 K channels ≈ 18 MB.
import fs from 'node:fs';
import path from 'node:path';

export interface StateCache {
  get(id: string): { version: string; value: any } | null;
  put(id: string, version: string, value: unknown): void;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class MemoryStateCache implements StateCache {
  private m = new Map<string, { version: string; value: any }>();
  get(id: string) { return this.m.get(id) ?? null; }
  put(id: string, version: string, value: unknown) { this.m.set(id, { version, value: JSON.parse(JSON.stringify(value)) }); }
}

export class DiskStateCache implements StateCache {
  readonly dir: string;
  constructor(dir: string) { this.dir = dir; }
  get(id: string) {
    if (!SAFE_ID.test(id)) return null;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8'));
      return typeof v?.version === 'string' && 'value' in v ? { version: v.version as string, value: v.value } : null;
    } catch { return null; }
  }
  put(id: string, version: string, value: unknown) {
    if (!SAFE_ID.test(id)) throw new Error(`state cache: unsafe id ${JSON.stringify(id)}`);
    fs.mkdirSync(this.dir, { recursive: true });
    const f = path.join(this.dir, `${id}.json`);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version, value }));
    fs.renameSync(tmp, f);
  }
}
