-- Private inspiration-sandbox feedback. Idempotent and additive.
-- Applied with: set -a; . ./.env.local; set +a; psql "$DATABASE_URL" -f sql/2026-09-03-inspiration-feedback.sql

create table if not exists inspiration_feedback (
  user_id          uuid not null references app_users(id) on delete cascade,
  target_channel_id text not null,
  video_id         text not null references videos(id) on delete cascade,
  distance         text not null,
  decision         text not null,
  recipe           text not null,
  result_rank      integer not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, target_channel_id, video_id),
  constraint inspiration_feedback_distance_check check (distance in ('near', 'balanced', 'far')),
  constraint inspiration_feedback_decision_check check (decision in ('saved', 'dismissed')),
  constraint inspiration_feedback_rank_check check (result_rank between 1 and 24)
);

create index if not exists idx_inspiration_feedback_user_target_decision
  on inspiration_feedback (user_id, target_channel_id, decision, updated_at desc);

-- Feedback is valid only while the target remains tracked by the user. This
-- block also upgrades databases where the table was created before the FK.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.inspiration_feedback'::regclass
       and conname = 'inspiration_feedback_tracked_channel_fk'
  ) then
    alter table public.inspiration_feedback
      add constraint inspiration_feedback_tracked_channel_fk
      foreign key (user_id, target_channel_id)
      references public.user_channels (user_id, channel_id)
      on delete cascade;
  end if;
end
$$;

-- The application uses direct Postgres. Keep this public-schema table closed
-- to PostgREST roles even if default Supabase grants change later.
alter table public.inspiration_feedback enable row level security;
revoke all on table public.inspiration_feedback from public, anon, authenticated;
