-- Metadata-only nullable column; no table rewrite or backfill.
alter table public.score_dirty add column if not exists claimed_at timestamptz;
