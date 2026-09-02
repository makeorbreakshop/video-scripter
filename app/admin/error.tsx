'use client';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const timeout = /statement timeout/i.test(error.message);
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-sm">
      <div className="font-medium text-red-400">{timeout ? 'Query timed out (45s)' : 'Page failed to load'}</div>
      <p className="mt-1 text-muted-foreground">
        {timeout
          ? 'Postgres is busy — usually a bulk job (nightly ingest, view tracking, or a baseline migration) holding the pooler. Retry in a minute.'
          : error.message}
      </p>
      <button onClick={reset} className="mt-3 rounded border border-border px-3 py-1 text-xs hover:bg-muted">
        Retry
      </button>
    </div>
  );
}
