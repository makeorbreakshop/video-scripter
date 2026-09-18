import { mergeSeriesFiles, type VideoSeriesFile } from './series';

export interface ChartSnapshot {
  file: VideoSeriesFile | null;
  status: 'current' | 'saved' | 'partial' | 'unavailable';
  /** Materialization time, never request time or the newest observation's clock. */
  asOf: string | null;
}
export interface ChartReaderDependencies {
  baseline(id: string): Promise<VideoSeriesFile | null>;
  current(id: string): Promise<VideoSeriesFile | null>;
  now?: () => number;
}

/** The same switch is used by the web reader and the scheduled publisher. */
export function hybridChartsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SERIES_HYBRID === '1' && env.SERIES_DISABLE !== '1';
}

export const CHART_CACHE_MS = 60_000;
export const CHART_BASELINE_CACHE_MS = 6 * 60 * 60_000;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 256;
const MAX_IN_FLIGHT = 32;
export const CHART_READ_DEADLINE_MS = 1200;

async function withinDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('chart read deadline exceeded')), CHART_READ_DEADLINE_MS);
    })]);
  } finally { clearTimeout(timer!); }
}

/** Current metadata and corrections win; the saved file supplies archived observations. */
export function overlayChart(baseline: VideoSeriesFile, current: VideoSeriesFile): VideoSeriesFile {
  const removed = new Set((current.deleted ?? []).map(p => `${p.source}:${p.at}`));
  const prior = { ...baseline,
    snapshots: baseline.snapshots.filter(p => !removed.has(`snapshot:${p.at}`)),
    samples: baseline.samples.filter(p => !removed.has(`sample:${p.at}`)),
    rss: baseline.rss.filter(p => !removed.has(`rss:${p.at}`)),
  };
  // The compact state does not carry snapshot provenance/engagement metadata. Preserve known
  // saved fields on overlap instead of replacing them with synthesized null values.
  const oldSnapshots = new Map(prior.snapshots.map(p => [p.at, p]));
  const snapshots = current.snapshots.map(p => {
    const old = oldSnapshots.get(p.at);
    return old ? { ...p, created_at: p.created_at ?? old.created_at,
      days_since_published: p.days_since_published ?? old.days_since_published,
      like_count: p.like_count ?? old.like_count, comment_count: p.comment_count ?? old.comment_count } : p;
  });
  return { ...mergeSeriesFiles(prior, { ...current, snapshots }),
    published_at: current.published_at, titles: current.titles, thumbs: current.thumbs,
    built_at: current.built_at, deleted: current.deleted };
}

class BoundedCache<T> {
  private entries = new Map<string, { value: T; until: number; bytes: number }>();
  private bytes = 0;
  peek(key: string): T | undefined { return this.entries.get(key)?.value; }
  get(key: string, now: number): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.until <= now) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, until: number): void {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > MAX_CACHE_BYTES) return;
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key); }
    while (this.entries.size && (this.bytes + bytes > MAX_CACHE_BYTES || this.entries.size >= MAX_CACHE_ENTRIES)) {
      const first = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(first)!.bytes;
      this.entries.delete(first);
    }
    this.entries.set(key, { value, until, bytes });
    this.bytes += bytes;
  }
}

function validFile(file: VideoSeriesFile | null, id: string): file is VideoSeriesFile {
  return Boolean(file && file.video_id === id && Number.isFinite(Date.parse(file.built_at))
    && ['snapshots', 'samples', 'rss', 'thumbs', 'titles'].every(k => Array.isArray((file as any)[k])));
}

/**
 * Read-only assembly. Adapters may request bounded background recovery on a compact-state miss,
 * but never read raw history or publish R2 objects. Single-flight is per process; instances may duplicate reads,
 * but never duplicate publications. All data is public video history, not user-specific state.
 */
export function createHybridChartReader(deps: ChartReaderDependencies) {
  const now = deps.now ?? Date.now;
  const baselines = new BoundedCache<VideoSeriesFile | null>();
  const snapshots = new BoundedCache<ChartSnapshot>();
  const pending = new Map<string, Promise<ChartSnapshot>>();
  async function baseline(id: string): Promise<VideoSeriesFile | null> {
    const cached = baselines.get(id, now());
    if (cached !== undefined) return cached;
    const file = await deps.baseline(id);
    if (file && !validFile(file, id)) throw new Error('invalid saved chart');
    // A missing file may be provisioned by a supervised repair; retry it after a minute.
    baselines.set(id, file, now() + (file ? CHART_BASELINE_CACHE_MS : CHART_CACHE_MS));
    return file;
  }
  return async (id: string): Promise<ChartSnapshot> => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('invalid chart video id');
    const cached = snapshots.get(id, now());
    if (cached) return cached;
    const lastGood = snapshots.peek(id);
    const running = pending.get(id);
    if (running) return running;
    if (pending.size >= MAX_IN_FLIGHT) return { file: null, status: 'unavailable', asOf: null };
    const work = (async (): Promise<ChartSnapshot> => {
      const [oldResult, newResult] = await Promise.allSettled([
        withinDeadline(baseline(id)), withinDeadline(deps.current(id)),
      ]);
      const oldFile = oldResult.status === 'fulfilled' && validFile(oldResult.value, id) ? oldResult.value : null;
      const current = newResult.status === 'fulfilled' && validFile(newResult.value, id) ? newResult.value : null;
      const file = current ? (oldFile ? overlayChart(oldFile, current) : current) : lastGood?.file ?? oldFile;
      const result: ChartSnapshot = {
        // Absence alone cannot distinguish a first-ever chart from an unarchived legacy chart.
        file, status: current ? (oldFile ? 'current' : 'partial') : file ? 'saved' : 'unavailable',
        asOf: current?.built_at ?? lastGood?.asOf ?? file?.built_at ?? null,
      };
      if (current && oldResult.status === 'fulfilled') snapshots.set(id, result, now() + CHART_CACHE_MS);
      return result;
    })();
    pending.set(id, work);
    try { return await work; }
    finally { pending.delete(id); }
  };
}
