// The project's Prometheus metrics endpoint (service_role basic auth). ~230 KB per call; used
// once a day by the storage guard and once per reclaim. Returns null rather than throwing.
import { parseDiskMetrics } from './storage-guard';

export async function fetchDiskMetrics(env = process.env): Promise<{ sizeBytes: number; availBytes: number } | null> {
  const ref = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([^.]+)\./)?.[1];
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ref || !key) return null;
  try {
    const res = await fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${key}`).toString('base64')}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) { console.error(`metrics endpoint: HTTP ${res.status}`); return null; }
    return parseDiskMetrics(await res.text());
  } catch (err) {
    console.error(`metrics endpoint: ${(err as Error).message}`);
    return null;
  }
}
