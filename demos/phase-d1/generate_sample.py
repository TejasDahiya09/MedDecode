from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import TypedDict

import pymupdf


ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DEMO = ROOT / "frontend" / "public" / "demo" / "phase-d1"
FIXTURES = PUBLIC_DEMO / "fixtures.json"
EXPECTED_OUTPUT = PUBLIC_DEMO / "expected-output.json"
OUTPUT = PUBLIC_DEMO / "sample-prescription.pdf"
UNICODE_FONT = Path(os.environ.get("WINDIR", "C:\\Windows")) / "Fonts" / "arial.ttf"
PAGE_WIDTH = 595
PAGE_HEIGHT = 842
MARGIN = 48
DOSAGE_NOTICE = "DOSAGE NOT SPECIFIED IN SOURCE DATA"


class ExpectedMedicine(TypedDict):
    sequence_number: int
    catalogue_record_id: str
    canonical_name: str
    medicine_name: str
    strength: str
    dosage_form: str
    dosage_statement: str


def required_text(record: dict[str, object], field: str) -> str:
    value = record.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Expected non-empty text field: {field}")
    return value


def normalize_strength(value: str) -> str:
    return re.sub(r"\s+", "", value).casefold()


def validate_expected_records(
    fixtures: dict[str, object],
    expected: dict[str, object],
) -> list[ExpectedMedicine]:
    source_records = fixtures.get("catalogue_records")
    expected_medicines = expected.get("expected_medicines")
    if not isinstance(source_records, list) or not isinstance(expected_medicines, list):
        raise ValueError("The catalogue source or OCR expectation list is invalid.")

    records_by_id: dict[str, dict[str, object]] = {}
    for source in source_records:
        if not isinstance(source, dict):
            raise ValueError("A catalogue source record is invalid.")
        source_id = required_text(source, "source_record_id")
        if source_id in records_by_id:
            raise ValueError("Catalogue source records must have unique source identifiers.")
        records_by_id[source_id] = source

    validated: list[ExpectedMedicine] = []
    for medicine in expected_medicines:
        if not isinstance(medicine, dict):
            raise ValueError("An expected medicine record is invalid.")
        record_id = required_text(medicine, "catalogue_record_id")
        source = records_by_id.get(record_id)
        if source is None:
            raise ValueError("An expected medicine has no matching official source record.")
        canonical_name = required_text(medicine, "canonical_name")
        medicine_name = required_text(medicine, "medicine_name")
        strength = required_text(medicine, "strength")
        dosage_form = required_text(medicine, "dosage_form")
        dosage_statement = required_text(medicine, "dosage_statement")
        sequence_number = medicine.get("sequence_number")
        if not isinstance(sequence_number, int) or isinstance(sequence_number, bool):
            raise ValueError(f"Expected a sequence number for NLEM source record {record_id}.")
        if (
            canonical_name != required_text(source, "canonical_name")
            or medicine_name != required_text(source, "ingredient_name")
            or normalize_strength(strength)
            != normalize_strength(f"{source.get('strength_value', '')}{source.get('strength_unit', '')}")
            or dosage_form != required_text(source, "dosage_form")
            or dosage_statement != DOSAGE_NOTICE
        ):
            raise ValueError(f"Expected output does not match NLEM source record {record_id}.")
        validated.append({
            "sequence_number": sequence_number,
            "catalogue_record_id": record_id,
            "canonical_name": canonical_name,
            "medicine_name": medicine_name,
            "strength": strength,
            "dosage_form": dosage_form,
            "dosage_statement": dosage_statement,
        })

    if len(validated) != 5:
        raise ValueError("The academic PDF must contain exactly five source-backed entries.")
    return validated


def build_pdf() -> None:
    if not UNICODE_FONT.is_file():
        raise FileNotFoundError(f"Required Unicode font is unavailable: {UNICODE_FONT}")
    fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
    expected = json.loads(EXPECTED_OUTPUT.read_text(encoding="utf-8"))
    medicines = validate_expected_records(fixtures, expected)
    document_fields = expected["document"]
    provenance = expected["provenance"]
    if not isinstance(document_fields, dict) or not isinstance(provenance, dict):
        raise ValueError("Document notice or provenance metadata is invalid.")
    watermark = required_text(document_fields, "watermark")
    patient = required_text(document_fields, "patient")
    notice = required_text(document_fields, "notice")
    source_release = required_text(provenance, "source_release")
    source_authority = required_text(provenance, "source_authority")
    source_url = required_text(provenance, "source_url")

    document = pymupdf.open()
    page = document.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    page.insert_text(
        (MARGIN, 48),
        watermark,
        fontsize=15,
        fontname="arial",
        fontfile=str(UNICODE_FONT),
        color=(0.72, 0.12, 0.12),
    )
    page.insert_text(
        (MARGIN, 72),
        "Official NLEM reference formulations · no prescribing directions",
        fontsize=10,
        fontname="helv",
        color=(0.25, 0.29, 0.35),
    )
    page.draw_line((MARGIN, 88), (PAGE_WIDTH - MARGIN, 88), color=(0.45, 0.48, 0.52), width=0.8)
    page.insert_text(
        (MARGIN, 110),
        f"Patient: {patient}",
        fontsize=10,
        fontname="helv",
    )
    page.insert_text(
        (MARGIN, 128),
        "Academic sample only · no clinician, facility, diagnosis, or patient date",
        fontsize=9,
        fontname="helv",
        color=(0.3, 0.33, 0.38),
    )
    page.insert_textbox(
        pymupdf.Rect(MARGIN, 143, PAGE_WIDTH - MARGIN, 190),
        notice,
        fontsize=9,
        fontname="helv",
        color=(0.56, 0.12, 0.12),
        lineheight=1.2,
    )

    y = 211
    for medicine in medicines:
        page.draw_rect(
            pymupdf.Rect(MARGIN, y - 14, PAGE_WIDTH - MARGIN, y + 73),
            color=(0.77, 0.79, 0.82),
            width=0.6,
        )
        page.insert_text(
            (MARGIN + 12, y + 5),
            f"{medicine['sequence_number']}. {medicine['medicine_name']}",
            fontsize=12,
            fontname="hebo",
            color=(0.08, 0.1, 0.13),
        )
        page.insert_text(
            (MARGIN + 12, y + 24),
            f"Strength: {medicine['strength']}    Dosage form: {medicine['dosage_form']}",
            fontsize=10,
            fontname="helv",
        )
        page.insert_text(
            (MARGIN + 12, y + 44),
            medicine["dosage_statement"],
            fontsize=8,
            fontname="hebo",
            color=(0.56, 0.12, 0.12),
        )
        page.insert_text(
            (MARGIN + 12, y + 63),
            f"NLEM {source_release} source record: {medicine['catalogue_record_id']}",
            fontsize=8,
            fontname="helv",
            color=(0.3, 0.33, 0.38),
        )
        y += 96

    page.draw_line((MARGIN, 700), (PAGE_WIDTH - MARGIN, 700), color=(0.45, 0.48, 0.52), width=0.8)
    page.insert_text(
        (MARGIN, 721),
        f"Source: {source_authority} · NLEM {source_release}",
        fontsize=8,
        fontname="helv",
        color=(0.3, 0.33, 0.38),
    )
    page.insert_text(
        (MARGIN, 739),
        source_url,
        fontsize=8,
        fontname="helv",
        color=(0.3, 0.33, 0.38),
    )
    page.insert_text(
        (MARGIN, 779),
        "FICTIONAL ACADEMIC DEMONSTRATION — NOT VALID FOR TREATMENT",
        fontsize=11,
        fontname="arial",
        fontfile=str(UNICODE_FONT),
        color=(0.72, 0.12, 0.12),
    )
    page.insert_text(
        (MARGIN, 800),
        "NLEM identifiers are source record IDs, not MedDecode catalogue UUIDs.",
        fontsize=8,
        fontname="helv",
        color=(0.3, 0.33, 0.38),
    )

    document.set_metadata({
        "title": "MedDecode fictional academic catalogue demonstration",
        "subject": "Not a prescription; dosage not specified in source data",
        "author": "MedDecode local demo fixture",
    })
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document.save(OUTPUT, garbage=4, deflate=True)
    document.close()

    with pymupdf.open(OUTPUT) as generated:
        page_count = len(generated)
        extracted_value = generated[0].get_text("text")
        if not isinstance(extracted_value, str):
            raise TypeError("PDF text extraction did not return plain text.")
        extracted = extracted_value
    required: list[str] = [
        watermark,
        patient,
        *(medicine["medicine_name"] for medicine in medicines),
        *(medicine["strength"] for medicine in medicines),
        *(medicine["dosage_form"] for medicine in medicines),
        *(medicine["catalogue_record_id"] for medicine in medicines),
    ]
    normalized_extracted = extracted.replace("\u00a0", " ")
    missing = [
        value
        for value in required
        if value.replace("\u00a0", " ") not in normalized_extracted
    ]
    if missing or extracted.count(DOSAGE_NOTICE) != len(medicines):
        raise RuntimeError(f"Generated PDF text verification failed; missing values: {missing}")
    print(f"Generated {OUTPUT}")
    print(f"Pages: {page_count}; source and text assertions: {len(required) + len(medicines)} passed")


if __name__ == "__main__":
    build_pdf()
