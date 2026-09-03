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

-- Semantic layer v2. Safe to re-run; v2 stays local/eval-only until gates pass.
create table if not exists video_topic_assignments_v2 (
  video_id text not null references videos(id) on delete cascade,
  cluster_id integer not null references bertopic_clusters(cluster_id) on delete restrict,
  cosine double precision not null,
  method text not null,
  assigned_at timestamptz not null default now(),
  primary key (video_id, method),
  constraint video_topic_assignments_v2_cosine_check check (cosine >= -1 and cosine <= 1)
);

create index if not exists idx_video_topic_assignments_v2_cluster
  on video_topic_assignments_v2 (cluster_id, cosine desc);

create index if not exists idx_video_topic_assignments_v2_assigned
  on video_topic_assignments_v2 (assigned_at desc);

create table if not exists video_facets (
  video_id text not null references videos(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  source_hash text not null,
  facets jsonb not null,
  confidence text,
  retry_count integer not null default 0,
  extracted_at timestamptz not null default now(),
  primary key (video_id, model, prompt_version),
  constraint video_facets_retry_count_check check (retry_count >= 0),
  constraint video_facets_confidence_check check (confidence is null or confidence in ('low', 'medium', 'high'))
);

create index if not exists idx_video_facets_source_hash
  on video_facets (source_hash);

create index if not exists idx_video_facets_extracted
  on video_facets (extracted_at desc);

create index if not exists idx_video_facets_gin
  on video_facets using gin (facets);

create table if not exists channel_prototypes (
  channel_id text not null,
  kind text not null,
  video_id text not null references videos(id) on delete cascade,
  importance double precision not null,
  cluster_size integer not null,
  built_at timestamptz not null default now(),
  primary key (channel_id, kind, video_id),
  constraint channel_prototypes_kind_check check (kind in ('topic', 'purpose')),
  constraint channel_prototypes_importance_check check (importance >= 0),
  constraint channel_prototypes_cluster_size_check check (cluster_size > 0)
);

create index if not exists idx_channel_prototypes_lookup
  on channel_prototypes (channel_id, kind, importance desc);

create index if not exists idx_channel_prototypes_video
  on channel_prototypes (video_id);

create table if not exists semantic_queries_v2 (
  id text primary key,
  video_id text not null references videos(id) on delete cascade,
  query text not null,
  model text not null,
  prompt_version text not null,
  source_hash text not null,
  generated_at timestamptz not null default now()
);

create index if not exists idx_semantic_queries_v2_video
  on semantic_queries_v2 (video_id);

create index if not exists idx_semantic_queries_v2_generated
  on semantic_queries_v2 (generated_at desc);

create table if not exists semantic_eval_v2_pool (
  run_id text not null,
  job text not null,
  query_id text not null,
  system text not null,
  entity_type text not null,
  entity_id text not null,
  rank integer not null,
  raw_score double precision,
  debug jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (run_id, query_id, system, entity_type, entity_id),
  constraint semantic_eval_v2_pool_job_check check (job in ('J1', 'J2', 'J3', 'J4', 'J5')),
  constraint semantic_eval_v2_pool_entity_check check (entity_type in ('video', 'channel')),
  constraint semantic_eval_v2_pool_rank_check check (rank > 0)
);

create index if not exists idx_semantic_eval_v2_pool_query
  on semantic_eval_v2_pool (query_id, entity_type, entity_id);

create index if not exists idx_video_scores_semantic_v2_outliers
  on video_scores (model_version, score desc, confidence, video_id)
  where score is not null;
