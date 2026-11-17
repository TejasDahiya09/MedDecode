from pathlib import Path

MIGRATION = Path(__file__).resolve().parents[3] / 'backend/database/integration-migrations/202611130002_official_catalogue_link_replay_identity/001_up.sql'

def test_null_safe_link_replay_index_is_additive_and_non_destructive():
    sql=MIGRATION.read_text(encoding='utf-8').lower()
    assert 'create unique index if not exists' in sql
    assert 'coalesce(right_source_record_id' in sql
    assert 'drop ' not in sql and 'delete ' not in sql and 'truncate ' not in sql
