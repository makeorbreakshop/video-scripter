import Link from 'next/link';
import { channels } from '@/lib/admin/queries';
import { n, compact, ago } from '@/lib/admin/format';
import { Th, Td } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function Channels({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const rows = await channels(q?.trim() || undefined);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Channels</h1>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="search name or channel id"
            className="w-64 rounded border border-border bg-transparent px-2 py-1 text-sm"
          />
          <button className="rounded border border-border px-3 py-1 text-sm hover:bg-muted">Search</button>
        </form>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {q ? `${rows.length} channels matching “${q}”` : `Top ${rows.length} channels by uploads in the last 30 days (cached 10 min)`}
      </p>

      <table className="mt-6 w-full">
        <thead>
          <tr>
            <Th>Channel</Th>
            <Th className="text-right">Uploads 30d</Th>
            {q && <Th className="text-right">Total</Th>}
            <Th className="text-right">Views 30d</Th>
            <Th className="text-right">Thumb changes</Th>
            <Th className="text-right">Latest upload</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channel_id} className="border-t border-border/60">
              <Td>
                <Link href={`/admin/channels/${r.channel_id}`} className="hover:underline">{r.channel_name || r.channel_id}</Link>
              </Td>
              <Td className="text-right tabular-nums">{n(r.videos_30d)}</Td>
              {q && <Td className="text-right tabular-nums">{n(r.videos_total)}</Td>}
              <Td className="text-right tabular-nums">{compact(r.views_30d)}</Td>
              <Td className="text-right tabular-nums">{r.thumb_changes || <span className="text-muted-foreground">0</span>}</Td>
              <Td className="text-right text-muted-foreground">{ago(r.latest)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
