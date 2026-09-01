#!/usr/bin/env bash
set -euo pipefail

phase="${1:-after}"
if [[ "$phase" != "before" && "$phase" != "after" ]]; then
  echo "usage: $0 [before|after]" >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

for client_file in lib/supabase.ts lib/supabase-client.ts; do
  if ! rg -q "typeof window === 'undefined'.*getSupabaseServiceKey|getSupabaseServiceKey.*typeof window === 'undefined'" "$client_file"; then
    echo "$client_file does not select service_role for server execution" >&2
    exit 1
  fi
done

if rg -n "\.from\(['\"](projects|documents|script_data)['\"]\)" \
  components/project-manager.tsx components/editor-layout.tsx components/tools/video-research-tool.tsx; then
  echo "Better Auth client still bypasses the ownership-enforcing workspace API" >&2
  exit 1
fi

if ! rg -q 'auth\.api\.getSession' app/api/workspace/route.ts ||
   ! rg -q '\.eq\("user_id", userId\)' app/api/workspace/route.ts; then
  echo "Workspace API does not enforce Better Auth session ownership" >&2
  exit 1
fi

if rg -n 'body\.(user_id|userId)' app/api/workspace/route.ts; then
  echo "Workspace API trusts a client-supplied owner identifier" >&2
  exit 1
fi

if ! rg -q 'origin !== request\.nextUrl\.origin' app/api/workspace/route.ts; then
  echo "Workspace API does not reject cross-origin writes" >&2
  exit 1
fi

if rg -n 'DISABLE ROW LEVEL SECURITY|FOR ALL TO PUBLIC USING \(true\)' \
  sql/supabase-schema.sql sql/supabase-disable-rls.sql \
  sql/supabase-disable-vector-rls.sql sql/supabase-update-rls.sql; then
  echo "A retired SQL helper can still disable RLS or restore unconditional public writes" >&2
  exit 1
fi

docker run --rm \
  --mount "type=bind,src=${repo_root},dst=/workspace,readonly" \
  --workdir /workspace \
  --user postgres \
  --env "TEST_PHASE=${phase}" \
  postgres:17 \
  bash -euo pipefail -c '
    export PGDATA=/tmp/video-security-pgdata
    initdb --auth=trust --username=postgres >/dev/null
    pg_ctl -w start >/dev/null
    trap "pg_ctl -m immediate stop >/dev/null" EXIT
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/security_hardening_fixture.sql >/dev/null
    if [[ "$TEST_PHASE" == "after" ]]; then
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20260901120000_security_hardening.sql >/dev/null
    fi
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/security_hardening.test.sql
  '
