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

/** The db host's node_network_transmit_bytes_total (non-loopback), or null. */
export function parseTransmitBytes(text: string): number | null {
  let total = 0, seen = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('node_network_transmit_bytes_total{') && !line.includes('device="lo"')) {
      const v = Number(line.trim().split(/\s+/).at(-1));
      if (Number.isFinite(v)) { total += v; seen = true; }
    }
  }
  return seen ? total : null;
}

/** Disk and transmit counters in one metrics fetch (~230 KB). Null fields when unavailable. */
export async function fetchHostMetrics(env = process.env): Promise<{ disk: { sizeBytes: number; availBytes: number } | null; transmitBytes: number | null }> {
  const ref = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([^.]+)\./)?.[1];
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ref || !key) return { disk: null, transmitBytes: null };
  try {
    const res = await fetch(`https://${ref}.supabase.co/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${key}`).toString('base64')}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) { console.error(`metrics endpoint: HTTP ${res.status}`); return { disk: null, transmitBytes: null }; }
    const text = await res.text();
    return { disk: parseDiskMetrics(text), transmitBytes: parseTransmitBytes(text) };
  } catch (err) {
    console.error(`metrics endpoint: ${(err as Error).message}`);
    return { disk: null, transmitBytes: null };
  }
}
