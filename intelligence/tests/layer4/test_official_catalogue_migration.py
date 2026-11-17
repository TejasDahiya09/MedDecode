from pathlib import Path

MIGRATION = Path(__file__).resolve().parents[3] / 'backend/database/integration-migrations/202611130001_official_catalogue_source_aware/001_up.sql'


def test_additive_catalogue_migration_keeps_public_schema_untouched():
    sql = MIGRATION.read_text(encoding='utf-8').lower()
    assert 'create schema if not exists official_catalogue' in sql
    assert 'official_catalogue.source_records' in sql
    assert 'official_catalogue.catalogue_entities' in sql
    assert 'drop table' not in sql and 'alter table public.' not in sql


def test_migration_keeps_price_types_and_regulatory_events_distinct():
    sql = MIGRATION.read_text(encoding='utf-8').lower()
    for expected in ('ceiling_price_excluding_taxes', 'special_feature_ceiling_price', 'revised_mrp', 'pmbi_listed_mrp', 'official_catalogue.regulatory_events'):
        assert expected in sql
