-- Shorts verification (2026-09-03). YouTube lets Shorts run to 3 minutes since late 2024, but
-- ingest only flagged <=62s clips, so 60K+ Shorts sat in the corpus as long-form and polluted
-- channel baselines (Matt Wolfe read 19K "normal" against 93K for his actual shows).
-- scripts/verify-shorts.ts asks youtube.com/shorts/<id> (200 = Short, 303 = not) and records
-- the answer here. Until a <=180s video is checked it is treated as a Short everywhere.
alter table videos add column if not exists shorts_checked_at timestamptz;
create index if not exists videos_shorts_unchecked_idx on videos (published_at desc)
  where shorts_checked_at is null and duration ~ '^PT';
