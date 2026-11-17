from __future__ import annotations

import json
from pathlib import Path

from app.layer4_medicine_intelligence.dataset_ingestion.rxnorm_enrichment import (
    RXNCONSO_RRF_COLUMNS,
    RXNREL_RRF_COLUMNS,
    RXNSAT_RRF_COLUMNS,
    enrich_rxnorm_dry_run_export,
)


def _rrf(columns: tuple[str, ...], **values: str) -> str:
    return "|".join(values.get(column, "") for column in columns) + "|\n"


def _accepted(cui: str = "100", name: str = "Example A / Example B Oral Tablet") -> dict:
    return {
        "mode": "offline_dry_run",
        "source": "rxnorm",
        "release": "2026-11-02",
        "accepted": [{
            "status": "accepted",
            "source_record_id": "atom-100",
            "source_fields": {"source_rxnorm_cui": cui},
            "normalized_record": {
                "canonical_name": name,
                "dosage_form": None,
                "ingredients": [],
                "sources": [],
            },
        }],
        "rejected": [], "ambiguous": [], "duplicates": [],
    }


def _conso(cui: str, rxaui: str, tty: str, name: str) -> str:
    return _rrf(
        RXNCONSO_RRF_COLUMNS, RXCUI=cui, LAT="ENG", RXAUI=rxaui,
        SAB="RXNORM", TTY=tty, CODE=cui, STR=name, SUPPRESS="N",
    )


def _rel(c1: str, c2: str, rela: str, rui: str) -> str:
    return _rrf(
        RXNREL_RRF_COLUMNS, RXCUI1=c1, STYPE1="CUI", REL="RO",
        RXCUI2=c2, STYPE2="CUI", RELA=rela, RUI=rui, SAB="RXNORM",
    )


def _sat(cui: str, name: str, value: str, atui: str) -> str:
    return _rrf(
        RXNSAT_RRF_COLUMNS, RXCUI=cui, STYPE="CUI", ATUI=atui,
        ATN=name, SAB="RXNORM", ATV=value, SUPPRESS="N",
    )


def _fixture(tmp_path: Path, *, conflicting_form: bool = False, incomplete_strength: bool = False):
    source = tmp_path / "dry-run.json"
    source.write_text(json.dumps(_accepted()), encoding="utf-8")
    conso = tmp_path / "RXNCONSO.RRF"
    conso.write_text(
        _conso("100", "a100", "SCD", "Example A 10 MG / Example B 2 MG Oral Tablet")
        + _conso("200", "a200", "SCDC", "Example A 10 MG")
        + _conso("201", "a201", "SCDC", "Example B 2 MG")
        + _conso("300", "a300", "IN", "Example A")
        + _conso("301", "a301", "IN", "Example B")
        + _conso("400", "a400", "DF", "Oral Tablet")
        + (_conso("401", "a401", "DF", "Oral Capsule") if conflicting_form else ""),
        encoding="utf-8",
    )
    rel = tmp_path / "RXNREL.RRF"
    rel.write_text(
        _rel("100", "200", "constitutes", "r1")
        + _rel("201", "100", "consists_of", "r2")
        + _rel("200", "300", "ingredient_of", "r3")
        + _rel("301", "201", "has_ingredient", "r4")
        + _rel("100", "400", "dose_form_of", "r5")
        + (_rel("401", "100", "has_dose_form", "r6") if conflicting_form else ""),
        encoding="utf-8",
    )
    sat = tmp_path / "RXNSAT.RRF"
    rows = []
    for component, value in (("200", "10"), ("201", "2")):
        rows.extend([
            _sat(component, "RXN_BOSS_STRENGTH_NUM_VALUE", value, component + "1"),
            _sat(component, "RXN_BOSS_STRENGTH_NUM_UNIT", "MG", component + "2"),
            _sat(component, "RXN_BOSS_STRENGTH_DENOM_VALUE", "1", component + "3"),
        ])
        if not (incomplete_strength and component == "201"):
            rows.append(_sat(component, "RXN_BOSS_STRENGTH_DENOM_UNIT", "EACH", component + "4"))
    sat.write_text("".join(rows), encoding="utf-8")
    return source, conso, rel, sat


def test_enrichment_preserves_multi_ingredient_strength_pairing_and_provenance(tmp_path: Path) -> None:
    source, conso, rel, sat = _fixture(tmp_path)
    payload, stats = enrich_rxnorm_dry_run_export(
        source, rxnconso_path=conso, rxnrel_path=rel, rxnsat_path=sat,
        release="2026-11-02",
    )

    record = payload["accepted"][0]
    ingredients = record["normalized_record"]["ingredients"]
    assert [(item["ingredient"]["ingredient_name"], item["ingredient_strength_value"])
            for item in ingredients] == [("Example A", "10"), ("Example B", "2")]
    assert {item["rxnorm_component_cui"] for item in ingredients} == {"200", "201"}
    assert all(item["ingredient_strength_unit"] == "MG/EACH" for item in ingredients)
    assert record["normalized_record"]["dosage_form"] == "Oral Tablet"
    assert record["enrichment"]["field_provenance"]["ingredient_strengths"][0]["source_file"] == "RXNSAT.RRF"
    assert stats.ingredient_records == stats.strength_records == stats.dosage_form_records == 1


def test_enrichment_keeps_conflicting_or_missing_official_values_null(tmp_path: Path) -> None:
    source, conso, rel, sat = _fixture(tmp_path, conflicting_form=True, incomplete_strength=True)
    payload, stats = enrich_rxnorm_dry_run_export(
        source, rxnconso_path=conso, rxnrel_path=rel, rxnsat_path=sat,
        release="2026-11-02",
    )
    record = payload["accepted"][0]
    assert record["normalized_record"]["dosage_form"] is None
    strengths = {item["rxnorm_component_cui"]: item["ingredient_strength_value"]
                 for item in record["normalized_record"]["ingredients"]}
    assert strengths == {"200": "10", "201": None}
    assert record["enrichment"]["conflicts"]
    assert any("incomplete" in reason for reason in record["enrichment"]["unknown_reasons"])
    assert stats.conflicts == 1
    assert stats.strength_records == 0


def test_enrichment_export_is_machine_readable_and_offline(tmp_path: Path, monkeypatch) -> None:
    source, conso, rel, sat = _fixture(tmp_path)
    output = tmp_path / "enriched.json"
    monkeypatch.setattr("socket.create_connection", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("network")))
    enrich_rxnorm_dry_run_export(
        source, rxnconso_path=conso, rxnrel_path=rel, rxnsat_path=sat,
        release="2026-11-02", export_path=output,
    )
    parsed = json.loads(output.read_text(encoding="utf-8"))
    assert parsed["mode"] == "offline_dry_run_rxnorm_enriched"
    assert parsed["enrichment_summary"]["source_files"] == [
        "RXNCONSO.RRF", "RXNREL.RRF", "RXNSAT.RRF"
    ]


def test_precise_ingredient_is_preferred_while_base_identity_is_retained(tmp_path: Path) -> None:
    source, conso, rel, sat = _fixture(tmp_path)
    conso.write_text(
        conso.read_text(encoding="utf-8")
        + _conso("302", "a302", "PIN", "Example A hydrochloride"),
        encoding="utf-8",
    )
    rel.write_text(
        rel.read_text(encoding="utf-8")
        + _rel("200", "302", "precise_ingredient_of", "r7"),
        encoding="utf-8",
    )
    payload, _ = enrich_rxnorm_dry_run_export(
        source, rxnconso_path=conso, rxnrel_path=rel, rxnsat_path=sat,
        release="2026-11-02",
    )
    first = payload["accepted"][0]["normalized_record"]["ingredients"][0]
    assert first["ingredient"]["ingredient_name"] == "Example A hydrochloride"
    assert first["rxnorm_ingredient_cui"] == "302"
    assert first["rxnorm_base_ingredient_cuis"] == ["300"]
