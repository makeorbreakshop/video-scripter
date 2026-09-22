-- Emergent packaging angles, stage 1: one free-text framing line per video.
--
-- The closed angle enum (video_angles / angles) forced every video into a label that already
-- existed. This table stores what a model WROTE instead: at most 14 words describing what the
-- packaging does to a viewer, deliberately stripped of the subject, plus the unpackaged verdict
-- for packaging that is a contents manifest (mix, compilation, fixture, livestream, bulletin).
-- The angles themselves come later, from clustering the embeddings of these lines.
--
-- One row per video and no enum to join: a re-run under a new prompt_version overwrites in place,
-- and the row's existence is what makes the run resume-safe.

create table if not exists video_framing (
  video_id       text primary key,
  framing        text not null default '',
  unpackaged     boolean not null default false,
  model          text,
  prompt_version integer not null default 1,
  tokens_in      integer not null default 0,
  tokens_out     integer not null default 0,
  usd            numeric not null default 0,
  created_at     timestamptz not null default now()
);

-- The clustering step reads only the packaged half, and the dashboard counts the other half.
create index if not exists video_framing_unpackaged_idx on video_framing (unpackaged);

alter table video_framing enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'video_framing' and policyname = 'video_framing_service_all') then
    create policy video_framing_service_all on video_framing for all to service_role using (true) with check (true);
  end if;
end $$;
