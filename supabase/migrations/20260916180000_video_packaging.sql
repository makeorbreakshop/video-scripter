-- Is this video packaged at all?
--
-- /app/angles forced at least one angle onto every video it labelled, so a Euro-disco megamix,
-- an NFL preseason recap and a Quran recitation each got a framing they do not have. A music
-- compilation is not badly packaged; it is not packaged. The tagger now says so directly and
-- the board drops those rows rather than teaching from them.
--
-- One row per video, not per label, which is why it is its own table and not a column on
-- video_angles: `unpackaged` is a property of the video, and when it is true there are no
-- video_angles rows to hang it on.
--
-- Idempotent. No REST grants; all access is direct Postgres (lib/admin/db.ts).
create table if not exists video_packaging (
  video_id text primary key references videos(id) on delete cascade,
  unpackaged boolean not null default false,
  model text,
  taxonomy_version integer,
  tagged_at timestamptz not null default now()
);

-- The board joins this table for every row of the pool and keeps only unpackaged = false. A
-- partial index on the false side is the whole working set and is the side that is read.
create index if not exists video_packaging_packaged on video_packaging (video_id) where unpackaged = false;

-- Family labels became section headings on the board, and the seeded values were definition
-- sentences ("the subject is placed in an ordered set") rendered in caps. The sentence is still
-- worth having — the tagger's prompt is built from it — so it moves here and `label` becomes the
-- short noun it should always have been.
alter table angle_families add column if not exists definition text;
