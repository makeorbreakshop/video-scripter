-- Retire the video_text mirror trigger. MUST be applied before scripts/null-video-text.ts runs.
--
-- THIS IS THE STEP THAT MAKES THE NULL-OUT SURVIVABLE, and it was missing.
--
-- sql/2026-09-08-video-text.sql installed video_text_mirror_upd: AFTER UPDATE ON videos, WHEN
-- one of description / metadata / llm_summary changed, copy the NEW values into video_text.
-- That trigger is what kept the two copies honest while the readers were being switched.
--
-- scripts/null-video-text.ts issues `update videos set llm_summary = null` — which is exactly
-- the trigger's WHEN condition. The trigger fires and upserts NULL into video_text. So the
-- null-out would not have freed the text, it would have DESTROYED it, one batch at a time, and
-- every safety check in that script would have kept passing: after the trigger has run the two
-- copies really do agree. They agree on nothing.
--
-- Verified installed on the live instance 2026-09-14 (both _ins and _upd).
--
-- WHY IT IS SAFE TO DROP. The trigger's job was to catch writers that were not going through
-- the accessor. After the 2026-09-14 refactor:
--   * lib/unified-video-import.ts, lib/llm-summary-batch-processor.ts,
--     lib/unified-import-summary-integration.ts, lib/pinecone-summary-service.ts and both
--     workers write the text through lib/app/video-text.ts.
--   * The two live scheduled ingest paths that still name `description` in an INSERT —
--     scripts/nightly-ingest.ts and scripts/drain-touch-queue.ts — write it only on INSERT of a
--     brand-new video; their ON CONFLICT clauses touch is_short and shorts_checked_at and
--     nothing else. A brand-new video has no video_text row, so scripts/move-video-text.ts
--     picks it up on its next pass by anti-join. Coverage is preserved.
--   * description and metadata still have 10 and 18 direct readers respectively
--     (lib/app/video-text-access.test.ts). They are NOT being cleared. Dropping the trigger
--     does not change what those readers see: `videos` keeps its copy.
--
-- Rollback: sql/rollback/2026-09-14-retire-video-text-mirror.sql
begin;

drop trigger if exists video_text_mirror_ins on videos;
drop trigger if exists video_text_mirror_upd on videos;
drop function if exists video_text_mirror();

comment on table video_text is
  'The wide, rarely-read columns of `videos`. Accessor: lib/app/video-text.ts. Filled by '
  'scripts/move-video-text.ts, which walks `videos` in primary-key order and anti-joins what '
  'this table already holds. The mirror trigger was retired 2026-09-14: it would have fired on '
  'the null-out''s own UPDATE and overwritten this table with NULLs. llm_summary is '
  'authoritative HERE; description and metadata are still authoritative on `videos`.';

commit;
