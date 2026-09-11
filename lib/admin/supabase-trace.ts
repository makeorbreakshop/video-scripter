import { randomUUID } from 'node:crypto';

interface QueryResultLike {
  rows?: unknown[];
  rowCount?: number | null;
  command?: string;
}

export interface SupabaseTraceQueryable {
  query(sql: string, values?: any[]): Promise<any>;
}

type TraceWriter = (line: string) => void;

const PG_APPLICATION_NAME_BYTES = 63;
const safePart = (value: string): string => value.toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'unknown';

/** Visible in Supabase Postgres/Supavisor logs without containing a per-run high-cardinality id. */
export function supabaseApplicationName(component: string): string {
  return `video-scripter:${safePart(component)}`.slice(0, PG_APPLICATION_NAME_BYTES);
}

/**
 * Explicit markers keep operation names stable through SQL refactors. The fallback intentionally
 * exposes only a command and relation name; query text and values never enter trace output.
 */
export function supabaseTraceOperation(sql: string): string {
  const marked = /\/\*\s*trace:([a-z0-9._-]+)\s*\*\//i.exec(sql.slice(0, 256))?.[1];
  if (marked) return marked.toLowerCase();
  const command = /^\s*([a-z]+)/i.exec(sql)?.[1]?.toLowerCase() ?? 'query';
  const relation = /\b(?:from|into|update|join)\s+(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(sql)?.[1]?.toLowerCase();
  return relation ? `${command}:${relation}` : command;
}

function valueBytes(value: unknown): number {
  if (value == null) return 0;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  if (value instanceof Date) return Buffer.byteLength(value.toISOString());
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return Buffer.byteLength(String(value));
  }
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + valueBytes(item), 0);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .reduce<number>((sum, item) => sum + valueBytes(item), 0);
  }
  return 0;
}

/** Lower-bound payload estimate: returned values only, excluding protocol/column metadata. */
export function estimatePostgresResultBytes(rows: readonly unknown[]): number {
  return rows.reduce<number>((sum, row) => sum + valueBytes(row), 0);
}

export class SupabaseQueryTracer {
  readonly traceId = randomUUID();
  private readonly startedAt = Date.now();
  private queries = 0;
  private rows = 0;
  private affectedRows = 0;
  private estimatedResponseBytes = 0;
  private queryFailures = 0;
  private runFailed = false;
  private finished = false;

  constructor(
    readonly component: string,
    private readonly write: TraceWriter = (line) => console.log(line),
  ) {}

  async query<T = any>(db: SupabaseTraceQueryable, sql: string, values?: any[]): Promise<T> {
    const operation = supabaseTraceOperation(sql);
    const started = performance.now();
    try {
      const result = await db.query(sql, values) as T;
      const observed = result as QueryResultLike;
      const rows = observed.rows ?? [];
      const bytes = estimatePostgresResultBytes(rows);
      const affectedRows = observed.rowCount ?? rows.length;
      this.queries++;
      this.rows += rows.length;
      this.affectedRows += Math.max(0, affectedRows);
      this.estimatedResponseBytes += bytes;
      this.emit({
        type: 'supabase.query', operation, status: 'ok', duration_ms: elapsed(started),
        rows: rows.length, affected_rows: affectedRows, estimated_response_bytes: bytes,
      });
      return result;
    } catch (error) {
      this.queries++;
      this.queryFailures++;
      const code = typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code : 'unknown';
      this.emit({
        type: 'supabase.query', operation, status: 'error', duration_ms: elapsed(started),
        rows: 0, affected_rows: 0, estimated_response_bytes: 0, error_code: code,
      });
      throw error;
    }
  }

  finish(extra: Record<string, string | number | boolean | null> = {}): void {
    if (this.finished) return;
    this.finished = true;
    this.emit({
      ...extra,
      type: 'supabase.run', status: this.queryFailures || this.runFailed ? 'error' : 'ok',
      duration_ms: Date.now() - this.startedAt, queries: this.queries, rows: this.rows,
      affected_rows: this.affectedRows, estimated_response_bytes: this.estimatedResponseBytes,
      failures: this.queryFailures, run_failed: this.runFailed,
    });
  }

  markFailed(): void {
    this.runFailed = true;
  }

  private emit(fields: Record<string, unknown>): void {
    this.write(JSON.stringify({
      timestamp: new Date().toISOString(), component: safePart(this.component), trace_id: this.traceId,
      ...fields,
    }));
  }
}

function elapsed(started: number): number {
  return Math.max(0, Math.round((performance.now() - started) * 10) / 10);
}
