import { redirect } from 'next/navigation';
import { requireAppUser } from '@/lib/app/session';
import { isOwner } from '@/lib/app/flags';
import { recentEvals, latestScorecard, recentParams } from '@/lib/admin/scoring-queries';
import { n, etDateTime } from '@/lib/admin/format';
import { Section, Th, Td } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

const num = (x: unknown, d = 3) =>
  x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(d);

const DIMENSION_LABEL: Record<string, string> = {
  age: 'Age at score',
  channel_size: 'Channel size',
  confidence: 'Confidence word',
  typical_kind: 'C(t)',
  packaging: 'Packaging',
};

const SOURCE_LABEL: Record<string, string> = {
  history: 'Shown scores',
  benchmark: 'Replay',
};

function Verdict({ v }: { v: string }) {
  const tone =
    v === 'promoted' ? 'text-emerald-600 dark:text-emerald-400'
    : v === 'rejected' ? 'text-red-600 dark:text-red-400'
    : 'text-muted-foreground';
  return <span className={`font-medium ${tone}`}>{v}</span>;
}

export default async function ScoringScorecard() {
  const user = await requireAppUser().catch(() => null);
  if (!isOwner(user)) redirect('/admin');

  const [evals, cells, params] = await Promise.all([recentEvals(12), latestScorecard(), recentParams(8)]);

  const bySource = new Map<string, typeof cells>();
  for (const c of cells) {
    const a = bySource.get(c.source);
    if (a) a.push(c); else bySource.set(c.source, [c]);
  }

  return (
    <div>
      <h1 className="text-lg font-semibold tracking-tight">Scoring</h1>

      <Section title="Fits">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <Th className="w-16">id</Th>
                <Th className="w-24">Version</Th>
                <Th className="w-44">Fitted</Th>
                <Th className="w-24">Videos</Th>
                <Th className="w-24">Status</Th>
                <Th className="w-20">Bands</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <Td className="tabular-nums">{p.id}</Td>
                  <Td>{p.model_version}</Td>
                  <Td className="tabular-nums">{etDateTime(p.fitted_at)}</Td>
                  <Td className="tabular-nums">{n(p.n_videos)}</Td>
                  <Td><Verdict v={p.status} /></Td>
                  <Td>{p.has_bands ? 'yes' : '—'}</Td>
                  <Td className="text-xs text-muted-foreground">{p.status_note ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Gate runs">
        {evals.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr>
                  <Th className="w-44">Run</Th>
                  <Th className="w-24">Version</Th>
                  <Th className="w-24">Verdict</Th>
                  <Th className="w-20">Params</Th>
                  <Th className="w-56">Worst cell</Th>
                  <Th>Gates</Th>
                </tr>
              </thead>
              <tbody>
                {evals.map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    <Td className="tabular-nums">{etDateTime(e.run_at)}</Td>
                    <Td>{e.model_version}</Td>
                    <Td><Verdict v={e.verdict} /></Td>
                    <Td className="tabular-nums">{e.candidate_params_id ?? '—'}</Td>
                    <Td className="font-mono text-xs">{e.worst_cell ?? '—'}</Td>
                    <Td className="text-xs">
                      {e.gates
                        ? Object.entries(e.gates)
                            .filter(([k]) => k !== 'run')
                            .map(([k, g]) => (
                              <div key={k}>
                                <span className="text-muted-foreground">{k}</span>{' '}
                                <span className={g?.status === 'pass' ? '' : 'text-red-600 dark:text-red-400'}>
                                  {g?.status ?? '—'}
                                </span>{' '}
                                {g?.headline}
                              </div>
                            ))
                        : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {[...bySource.entries()].map(([source, rows]) => {
        const byDim = new Map<string, typeof rows>();
        for (const r of rows) {
          const a = byDim.get(r.dimension);
          if (a) a.push(r); else byDim.set(r.dimension, [r]);
        }
        return (
          <Section
            key={source}
            title={SOURCE_LABEL[source] ?? source}
            right={etDateTime(rows[0].computed_at)}
          >
            <div className="grid gap-6 md:grid-cols-2">
              {[...byDim.entries()].map(([dim, drows]) => (
                <div key={dim} className="overflow-x-auto">
                  <table className="w-full min-w-[420px]">
                    <thead>
                      <tr>
                        <Th className="w-32">{DIMENSION_LABEL[dim] ?? dim}</Th>
                        <Th className="w-16 text-right">n</Th>
                        <Th className="w-20 text-right">medALE</Th>
                        <Th className="w-20 text-right">bias</Th>
                        <Th className="w-14 text-right">P</Th>
                        <Th className="w-14 text-right">R</Th>
                        <Th className="w-14 text-right">F1</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {drows.map((r) => (
                        <tr key={r.bucket} className="border-t border-border">
                          <Td>{r.bucket}</Td>
                          <Td className="text-right tabular-nums">{n(r.metrics.n as number)}</Td>
                          <Td className="text-right tabular-nums">{num(r.metrics.medALE)}</Td>
                          <Td className="text-right tabular-nums">{num(r.metrics.bias)}</Td>
                          <Td className="text-right tabular-nums">{num(r.metrics.precision, 2)}</Td>
                          <Td className="text-right tabular-nums">{num(r.metrics.recall, 2)}</Td>
                          <Td className="text-right tabular-nums">{num(r.metrics.f1, 2)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
