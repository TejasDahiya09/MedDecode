-- Additive local-only repair for NULL-safe immutable linkage replay.
-- It intentionally fails rather than removing any pre-existing duplicate links.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS link_candidates_replay_identity_idx
  ON official_catalogue.link_candidates (
    left_source_record_id,
    COALESCE(right_source_record_id, '00000000-0000-0000-0000-000000000000'::uuid),
    match_status,
    reason
  );
COMMIT;
