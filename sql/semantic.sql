-- Semantic layer v1 bookkeeping. Safe to re-run.
create table if not exists embeddings_v1 (
  entity text not null,
  id text not null,
  model text not null,
  dims integer not null,
  doc_hash text not null,
  embedded_at timestamptz not null default now(),
  primary key (entity, id),
  constraint embeddings_v1_entity_check check (entity in ('video', 'channel')),
  constraint embeddings_v1_dims_check check (dims > 0)
);

create index if not exists idx_embeddings_v1_embedded_at
  on embeddings_v1 (embedded_at);

create table if not exists semantic_cost_ledger (
  date date not null default current_date,
  tokens bigint not null,
  usd numeric(12, 8) not null,
  constraint semantic_cost_ledger_tokens_check check (tokens >= 0),
  constraint semantic_cost_ledger_usd_check check (usd >= 0)
);

create index if not exists idx_semantic_cost_ledger_date
  on semantic_cost_ledger (date);
