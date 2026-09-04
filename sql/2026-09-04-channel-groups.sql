-- Channel groups, per-channel notify, and the Google-subscriptions import ledger.
--
-- Dev and prod share one database, so this is additive only: two new tables, one nullable-
-- with-default column on user_channels, one ledger table. Nothing is dropped or rewritten.
--
-- Colours are stored as a KEY from a fixed palette (lib/app/channel-groups.ts), never a hex,
-- so the theme owns the actual value in both light and dark.

begin;

create table if not exists channel_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app_users(id) on delete cascade,
  name       text not null,
  color      text not null default 'green',
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

-- One name per user. Case-sensitive on purpose: the user typed it.
create unique index if not exists channel_groups_user_name_key
  on channel_groups (user_id, name);
create index if not exists channel_groups_user_position_idx
  on channel_groups (user_id, position, created_at);

create table if not exists channel_group_members (
  group_id   uuid not null references channel_groups(id) on delete cascade,
  user_id    uuid not null references app_users(id) on delete cascade,
  channel_id text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, channel_id)
);

-- The list page's read: every membership for one user, keyed the way it asks for them.
create index if not exists channel_group_members_user_channel_idx
  on channel_group_members (user_id, channel_id);

-- Notify: does this user want to hear about this channel? Off until asked.
alter table user_channels
  add column if not exists notify boolean not null default false;

-- The import is idempotent and re-runnable: a subscription imported once is not
-- re-offered as a fresh suggestion even if the user later untracks it.
create table if not exists google_subscription_imports (
  user_id     uuid not null references app_users(id) on delete cascade,
  channel_id  text not null,
  imported_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

commit;

-- Sanity: the four objects exist and the column landed.
select
  to_regclass('public.channel_groups')             as channel_groups,
  to_regclass('public.channel_group_members')      as channel_group_members,
  to_regclass('public.google_subscription_imports') as google_subscription_imports,
  (select count(*) from information_schema.columns
    where table_name = 'user_channels' and column_name = 'notify') as notify_column;
