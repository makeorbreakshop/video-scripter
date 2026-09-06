-- WebSub lease bookkeeping. Additive: no existing table is touched.
-- One row per channel we have asked pubsubhubbub.appspot.com to push for.
create table if not exists websub_leases (
  channel_id         text primary key,
  topic              text not null,
  callback           text not null,
  lease_expires_at   timestamptz,
  last_subscribed_at timestamptz,
  last_hub_status    int,
  last_hub_body      text,
  last_verified_at   timestamptz,
  last_push_at       timestamptz,
  failures           int not null default 0,
  updated_at         timestamptz not null default now()
);

-- The renewal job selects on expiry; the poll policy joins on channel_id (the pkey).
create index if not exists idx_websub_leases_expiry on websub_leases (lease_expires_at);

alter table websub_leases enable row level security;
grant select, insert, update on websub_leases to service_role;
