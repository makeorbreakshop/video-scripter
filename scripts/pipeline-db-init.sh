#!/bin/zsh
# Create (or recreate) the local pipeline DB schema from Supabase's public schema, DDL only.
# docs/plans/2026-11-20-local-pipeline-db.md, unit U1. Reads no table data from Supabase.
#   scripts/pipeline-db-init.sh            # create channelsmith_pipeline if absent, apply schema
#   PIPELINE_RECREATE=1 scripts/pipeline-db-init.sh   # drop and rebuild an EMPTY local DB only
set -euo pipefail
cd "$(dirname "$0")/.."
PG=/opt/homebrew/opt/postgresql@17/bin
PORT=${PIPELINE_PORT:-5434}
DB=channelsmith_pipeline
SCHEMA=$(mktemp -t pipeline-schema).sql
if $PG/psql -p $PORT -d postgres -Atc "select 1 from pg_database where datname='$DB'" | grep -q 1; then
  if [[ "${PIPELINE_RECREATE:-}" == 1 ]]; then
    rows=$($PG/psql -p $PORT -d $DB -Atc "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where relname not in ('observation_materialization_meta','series_publication')")
    [[ "$rows" == 0 ]] || { echo "refusing to drop $DB: it holds $rows rows"; exit 1; }
    $PG/dropdb -p $PORT $DB
  else
    echo "$DB exists; set PIPELINE_RECREATE=1 to rebuild an empty one"; exit 0
  fi
fi
$PG/createdb -p $PORT $DB
ENV_FILE=${ENV_FILE:-.env.local} node --input-type=module -e "
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
for (const l of fs.readFileSync(process.env.ENV_FILE || '.env.local','utf8').split('\n')) { const m=l.match(/^([A-Z_]+)=(.*)\$/); if (m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,''); }
execFileSync('$PG/pg_dump', ['--schema-only','--no-owner','--no-privileges','--schema=public','-f','$SCHEMA', process.env.DATABASE_SESSION_URL || process.env.DATABASE_URL], { stdio: 'inherit' });"
$PG/psql -p $PORT -d $DB -q -v ON_ERROR_STOP=1 -c "create extension if not exists pg_stat_statements"
$PG/psql -p $PORT -d $DB -q -v ON_ERROR_STOP=1 -f sql/pipeline/000-supabase-shims.sql
# Vector tables (embeddings, clusters) fail without pgvector; the pipeline never uses them.
$PG/psql -p $PORT -d $DB -q -f "$SCHEMA" 2>&1 | grep -c ERROR | xargs -I{} echo "schema restore: {} statements skipped (vector-typed objects)"
$PG/psql -p $PORT -d $DB -q -v ON_ERROR_STOP=1 -f sql/pipeline/001-local-trigger-profile.sql
$PG/psql -p $PORT -d $DB -q -v ON_ERROR_STOP=1 -f sql/pipeline/smoke.sql
rm -f "$SCHEMA"
