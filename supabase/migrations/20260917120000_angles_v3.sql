-- Angle taxonomy v3: the working library, built as the UNION of the enum title angles the
-- free-text framing data actually reproduced and the sharp emergent v2 framings. Content-type
-- entries (guides, tips, overviews, announcements, showcases) are gone: they describe what a
-- video IS, not how its packaging frames a subject, and in v1 they were doing the work of a shrug.
--
-- Three structural changes, because v1 and v3 have to coexist:
--
--  1. `angles` was keyed on id alone, so `inside_access` could only exist at one version. v3
--     reuses 25 v1 ids on purpose (the whole point is that those angles survived contact with
--     the data), so the key becomes (id, taxonomy_version) and v1 rows stay for provenance with
--     active = false.
--  2. `video_angles` was keyed on (video_id, angle_id) for the same reason and inherits the same
--     fix. The FK follows to the composite parent key.
--  3. Membership stops being a boolean. Jev answers each "is this video this angle?" with a
--     probability, so the row carries the probability that put it there and the resolved model
--     version that produced it — a threshold change is then a re-read, not a re-run.
--
-- Idempotent: safe to re-run.

-- 1. angles: composite key so a taxonomy version is a version, not a rename.
do $$ begin
  if exists (
    select 1 from pg_constraint
     where conname = 'angles_pkey' and conrelid = 'angles'::regclass
       and array_length(conkey, 1) = 1
  ) then
    alter table video_angles drop constraint if exists video_angles_angle_id_fkey;
    alter table angles drop constraint angles_pkey;
    alter table angles add constraint angles_pkey primary key (id, taxonomy_version);
  end if;
end $$;

-- 2. video_angles: one row per (video, angle, taxonomy version).
alter table video_angles add column if not exists probability numeric;
alter table video_angles add column if not exists model_version text;
alter table video_angles add column if not exists taxonomy_version integer not null default 1;

do $$ begin
  if exists (
    select 1 from pg_constraint
     where conname = 'video_angles_pkey' and conrelid = 'video_angles'::regclass
       and array_length(conkey, 1) = 2
  ) then
    alter table video_angles drop constraint video_angles_pkey;
    alter table video_angles add constraint video_angles_pkey
      primary key (video_id, angle_id, taxonomy_version);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'video_angles_angle_fkey' and conrelid = 'video_angles'::regclass
  ) then
    alter table video_angles add constraint video_angles_angle_fkey
      foreign key (angle_id, taxonomy_version) references angles (id, taxonomy_version);
  end if;
end $$;

-- The v3 board reads one angle at a time; v1 rows are ten times as many and must not be walked.
create index if not exists video_angles_v3_angle
  on video_angles (angle_id) where taxonomy_version = 3;

-- 3. The two continuous packaging readings, which are per-video rather than per-angle, plus the
--    model's own unpackaged verdict kept beside them as a cross-check on the stage-1 flag.
create table if not exists video_packaging_scores (
  video_id      text primary key,
  curiosity_gap numeric,
  specificity   numeric,
  unpackaged_p  numeric,
  model_version text,
  created_at    timestamptz not null default now()
);

-- v1 stays readable but stops being the live vocabulary. Seeding v3 is
-- scripts/angles/seed-taxonomy-v3.ts, from the checked-in scripts/angles/taxonomy-v3.json.
update angles set active = false where taxonomy_version = 1 and active;
