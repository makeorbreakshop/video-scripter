# Supabase security hardening — 2026-09-01

## Outcome

Close Video Scripter's public table exposure while preserving Better Auth
workspace editing, public YouTube research reads, workers, and the Chrome
extension touch queue.

## Contract

- Enable RLS and remove broad client grants on 40 advisor-flagged tables.
- Keep only four observed public YouTube read tables and a validated,
  insert-only `touch_queue` surface.
- Route projects, documents, and script data through a same-origin Better Auth
  workspace API that derives `user_id` from the server session.
- Make 11 views invoker-secure and 15 materialized views service-only.
- Pin project-owned function search paths and limit privileged execution.
- Move the relocatable vector extension out of `public`.
- Retire every checked-in SQL helper that disabled RLS or recreated public
  owner-table writes.

## TDD evidence

- The insecure database fixture produced 151 failures before the migration.
- A separate red regression test caught direct anonymous workspace CRUD.
- `scripts/test-supabase-security.sh after`: pass, including session ownership,
  same-origin writes, client-owner spoofing prevention, runtime server-role
  selection, and retired SQL footgun checks.
- Changed files introduce no TypeScript errors.
- Next.js compiles successfully with the real local environment. Its later
  prerender phase still fails on pre-existing Better Auth adapter and custom
  404 issues; these failures reproduce outside this change.

## Rollout and recovery

Deploy the authenticated workspace API and browser refactor before the database
migration. Smoke-test login, project/document CRUD, transcript document
creation, public video search, worker routes, and extension queue inserts. Then
apply `supabase/migrations/20260901120000_security_hardening.sql` transactionally
and repeat positive and negative probes. Never recover by disabling RLS.
