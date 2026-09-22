-- Framing v2: the same one-line packaging framing as video_framing, but written from a
-- SUBJECT-MASKED title. Stage 1 lines leaked the subject (67/180 clusters were channel- or
-- topic-dominated), so pass 1 pulls the proper nouns out of title+description and replaces
-- them with typed placeholders, and pass 2 never sees the real thing.
create table if not exists video_framing_v2 (
  video_id       text primary key references videos(id) on delete cascade,
  masked_title   text not null,
  subject_terms  jsonb not null default '[]'::jsonb,
  framing        text not null default '',
  model          text not null,
  prompt_version int  not null,
  usd            numeric not null default 0,
  created_at     timestamptz not null default now()
);
