from __future__ import annotations

import csv
from pathlib import Path
from uuid import UUID

import pytest

from app.layer4_medicine_intelligence.dataset_ingestion.dry_run import run_official_dry_run
from app.layer4_medicine_intelligence.dataset_ingestion.mapper import MedicineMapper
from app.layer4_medicine_intelligence.dataset_ingestion.merger import MedicineMerger
from app.layer4_medicine_intelligence.dataset_ingestion.models import (
    CandidateSearchResult,
    MatchStatus,
    MedicineCandidate,
    MergeAction,
    RawRecord,
    SourceMetadata,
)
from app.layer4_medicine_intelligence.dataset_ingestion.normalizer import MedicineNormalizer
from app.layer4_medicine_intelligence.dataset_ingestion.official_sources import (
    OfficialSourceSchemaError,
    OfficialSourceUnavailableError,
    RXNCONSO_RRF_COLUMNS,
    RxNormRrfAdapter,
    get_official_source_adapter,
)
from app.layer4_medicine_intelligence.dataset_ingestion.transformer import MedicineTransformer
from app.layer4_medicine_intelligence.dataset_ingestion.validator import MedicineValidator


HEADERS = ["RXCUI", "RXAUI", "STR", "TTY", "SAB", "CODE", "SUPPRESS"]


def _write_rxnorm(path: Path, rows: list[dict[str, str]], headers: list[str] = HEADERS) -> Path:
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)
    return path


def _row(**updates: str) -> dict[str, str]:
    value = {
        "RXCUI": "12345",
        "RXAUI": "67890",
        "STR": "Examplemed 10 MG Oral Tablet",
        "TTY": "SCD",
        "SAB": "RXNORM",
        "CODE": "12345",
        "SUPPRESS": "N",
    }
    value.update(updates)
    return value


def _rrf_row(**updates: str) -> str:
    values = {
        "RXCUI": "12345", "LAT": "ENG", "TS": "P", "LUI": "L1",
        "STT": "PF", "SUI": "S1", "ISPREF": "Y", "RXAUI": "67890",
        "SAUI": "", "SCUI": "", "SDUI": "", "SAB": "RXNORM",
        "TTY": "SCD", "CODE": "12345", "STR": "Examplemed 10 MG Oral Tablet",
        "SRL": "", "SUPPRESS": "N", "CVF": "4096",
    }
    values.update(updates)
    return "|".join(values[column] for column in RXNCONSO_RRF_COLUMNS) + "|\n"


def test_rxnorm_dry_run_preserves_stable_identity_release_and_original_fields(tmp_path: Path) -> None:
    output = tmp_path / "normalized.json"
    report = run_official_dry_run(
        _write_rxnorm(tmp_path / "rxnorm.csv", [_row()]),
        source="rxnorm",
        release="2026-11-02",
        source_url="https://www.nlm.nih.gov/research/umls/rxnorm/",
        export_path=output,
    )

    assert report.total == 1
    assert len(report.accepted) == 1
    accepted = report.accepted[0]
    assert accepted.source_record_id == "67890"
    assert accepted.source_fields["source_rxnorm_cui"] == "12345"
    assert accepted.source_fields["source_term_type"] == "SCD"
    assert accepted.normalized_record["canonical_name"] == "Examplemed 10 MG Oral Tablet"
    assert accepted.normalized_record["country"] is None
    assert accepted.normalized_record["sources"][0]["source_release"] == "2026-11-02"
    assert output.read_text(encoding="utf-8").find('"mode": "offline_dry_run"') >= 0


def test_dry_run_classifies_exact_duplicates_and_conflicting_source_ids(tmp_path: Path) -> None:
    duplicate = run_official_dry_run(
        _write_rxnorm(tmp_path / "duplicate.csv", [_row(), _row()]),
        source="rxnorm",
        release="2026-11-02",
    )
    assert len(duplicate.accepted) == 1
    assert len(duplicate.duplicates) == 1

    conflict = run_official_dry_run(
        _write_rxnorm(tmp_path / "conflict.csv", [_row(), _row(STR="Examplemed 20 MG Oral Tablet")]),
        source="rxnorm",
        release="2026-11-02",
    )
    assert len(conflict.accepted) == 0
    assert len(conflict.ambiguous) == 2


def test_rxnorm_schema_and_record_validation_fail_closed(tmp_path: Path) -> None:
    with pytest.raises(OfficialSourceSchemaError):
        run_official_dry_run(
            _write_rxnorm(tmp_path / "missing.csv", [{"RXCUI": "1"}], headers=["RXCUI"]),
            source="rxnorm",
            release="2026-11-02",
        )

    report = run_official_dry_run(
        _write_rxnorm(tmp_path / "invalid.csv", [_row(SAB="OTHER", SUPPRESS="Y")]),
        source="rxnorm",
        release="2026-11-02",
    )
    assert len(report.rejected) == 1
    assert len(report.accepted) == 0

    deferred = run_official_dry_run(
        _write_rxnorm(tmp_path / "ingredient.csv", [_row(TTY="IN")]),
        source="rxnorm",
        release="2026-11-02",
    )
    assert len(deferred.rejected) == 1
    assert "future alias, ingredient, RXNREL, or RXNSAT integration" in deferred.rejected[0].issues[-1]


def test_unverified_official_schemas_are_not_invented() -> None:
    for source in ("who-eml", "india-nlem-2022", "cdsco", "dailymed", "nppa", "icmr"):
        with pytest.raises(OfficialSourceUnavailableError):
            get_official_source_adapter(source, release="test-release")


def test_multi_ingredient_strengths_are_paired_and_single_strength_is_not_copied() -> None:
    mapper = MedicineMapper()
    source = SourceMetadata("official-test", "record-1")
    paired = mapper.map(RawRecord({
        "canonical_name": "Combination",
        "ingredients": "Ingredient A|Ingredient B",
        "ingredient_strength": "10|20",
        "ingredient_strength_unit": "mg|mg",
    }, source))
    assert [item.ingredient_strength_value for item in paired.ingredients] == [10, 20]

    ambiguous = mapper.map(RawRecord({
        "canonical_name": "Combination",
        "ingredients": "Ingredient A|Ingredient B",
        "ingredient_strength": "10",
        "ingredient_strength_unit": "mg",
    }, source))
    assert [item.ingredient_strength_value for item in ambiguous.ingredients] == [None, None]


def test_duplicate_ingredients_reach_validation_instead_of_being_silently_removed() -> None:
    medicine = MedicineMapper().map(RawRecord({
        "canonical_name": "Combination",
        "ingredients": "Ingredient A|Ingredient A",
    }, SourceMetadata("official-test", "record-1")))
    medicine = MedicineNormalizer().normalize(MedicineTransformer().transform(medicine))
    validation = MedicineValidator().validate(medicine)
    assert not validation.is_valid
    assert any("Duplicate ingredient" in issue.message for issue in validation.errors)


def test_fuzzy_candidates_can_never_silently_update_official_records() -> None:
    record = MedicineMapper().map(RawRecord(
        {"canonical_name": "Examplemed", "description": "Official description"},
        SourceMetadata("nlm_rxnorm_rxnconso", "67890"),
    ))
    candidate = MedicineCandidate(
        medicine_id=UUID("11111111-1111-4111-8111-111111111111"),
        canonical_name="Example med",
        normalized_name="example med",
        similarity_score=0.99,
    )
    decision = MedicineMerger().decide(
        record=record,
        candidate_result=CandidateSearchResult(MatchStatus.POSSIBLE_MATCH, [candidate]),
    )
    assert decision.action == MergeAction.REVIEW


def test_official_dry_run_has_no_candidate_or_database_writer_dependency(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.layer4_medicine_intelligence.dataset_ingestion import candidate_finder, database_writer

    monkeypatch.setattr(candidate_finder.CandidateFinder, "find_candidates", lambda *_args, **_kwargs: pytest.fail("candidate lookup invoked"))
    monkeypatch.setattr(database_writer.DatabaseWriter, "write", lambda *_args, **_kwargs: pytest.fail("database write invoked"))
    report = run_official_dry_run(
        _write_rxnorm(tmp_path / "safe.csv", [_row()]),
        source="rxnorm",
        release="2026-11-02",
    )
    assert len(report.accepted) == 1


def test_rxnorm_rrf_streams_exact_official_columns_and_rejects_malformed_rows(tmp_path: Path) -> None:
    path = tmp_path / "RXNCONSO.RRF"
    path.write_text(
        _rrf_row()
        + "malformed|ENG|P|\n"
        + _rrf_row(RXCUI="54321", RXAUI="09876", CODE="54321", STR="Othermed 5 MG Oral Tablet"),
        encoding="utf-8",
    )
    adapter = RxNormRrfAdapter(release="2026-11-02", source_url="https://download.nlm.nih.gov/")
    streamed = adapter.iter_load(path)
    first = next(streamed)
    assert first.raw_record.source.source_record_id == "67890"
    assert first.raw_record.data["source_rxnorm_cui"] == "12345"
    assert first.raw_record.data["source_raw_fields"]["CVF"] == "4096"
    assert first.raw_record.data["source_original_name"] == "Examplemed 10 MG Oral Tablet"

    report = run_official_dry_run(
        path,
        source="rxnorm",
        release="2026-11-02",
        max_records=3,
    )
    assert report.total == 3
    assert len(report.accepted) == 2
    assert len(report.rejected) == 1
    assert "expected 18 fields" in report.rejected[0].issues[0]


def test_rxnorm_rrf_bounded_sample_stops_after_requested_records(tmp_path: Path) -> None:
    path = tmp_path / "RXNCONSO.RRF"
    path.write_text(
        _rrf_row()
        + _rrf_row(RXCUI="54321", RXAUI="09876", CODE="54321", STR="Othermed"),
        encoding="utf-8",
    )
    report = run_official_dry_run(
        path,
        source="rxnorm",
        release="2026-11-02",
        max_records=1,
    )
    assert report.total == 1
    assert len(report.accepted) == 1
