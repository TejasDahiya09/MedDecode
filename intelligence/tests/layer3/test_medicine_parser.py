from app.layer3_medicine_understanding.medicine_parser import (
    parse_medicine_entry,
)
from app.schemas.prescription import (
    RawMedicineEntry,
    SourceEvidence,
)


def create_entry(
    raw_text: str,
) -> RawMedicineEntry:

    evidence = SourceEvidence(
        page_number=1,
        source_text=raw_text,
        source_block_indexes=[0],
    )

    return RawMedicineEntry(
        raw_text=raw_text,
        page_number=1,
        confidence=0.99,
        evidence=[evidence],
    )


def test_extracts_tablet_name_and_strength():

    result = parse_medicine_entry(
        create_entry(
            "Tab Paracetamol 500 mg"
        )
    )

    assert (
        result.raw_medicine_text
        == "Tab Paracetamol 500 mg"
    )

    assert (
        result.raw_medicine_name
        == "Paracetamol"
    )

    assert (
        result.dosage_form
        == "tablet"
    )

    assert (
        result.strength.value
        == 500
    )

    assert (
        result.strength.unit
        == "mg"
    )


def test_extracts_capsule_alias():

    result = parse_medicine_entry(
        create_entry(
            "Cap Amoxicillin 500 mg"
        )
    )

    assert (
        result.raw_medicine_name
        == "Amoxicillin"
    )

    assert (
        result.dosage_form
        == "capsule"
    )

    assert (
        result.strength.value
        == 500
    )

    assert (
        result.strength.unit
        == "mg"
    )


def test_extracts_full_dosage_form():

    result = parse_medicine_entry(
        create_entry(
            "Tablet Metformin 500 mg"
        )
    )

    assert (
        result.dosage_form
        == "tablet"
    )

    assert (
        result.raw_medicine_name
        == "Metformin"
    )


def test_extracts_decimal_strength():

    result = parse_medicine_entry(
        create_entry(
            "Tab MedicineX 2.5 mg"
        )
    )

    assert (
        result.strength.value
        == 2.5
    )

    assert (
        result.strength.unit
        == "mg"
    )


def test_missing_dosage_form_remains_none():

    result = parse_medicine_entry(
        create_entry(
            "Paracetamol 500 mg"
        )
    )

    assert result.dosage_form is None

    assert (
        result.raw_medicine_name
        == "Paracetamol"
    )


def test_missing_strength_remains_none():

    result = parse_medicine_entry(
        create_entry(
            "Tab Paracetamol"
        )
    )

    assert (
        result.dosage_form
        == "tablet"
    )

    assert (
        result.raw_medicine_name
        == "Paracetamol"
    )

    assert result.strength.value is None
    assert result.strength.unit is None


def test_preserves_source_instructions():

    entry = create_entry(
        "Tab Paracetamol 500 mg"
    )

    entry.instructions = [
        "1-0-1 after food",
    ]

    result = parse_medicine_entry(
        entry
    )

    assert (
        result.source_instructions
        == [
            "1-0-1 after food",
        ]
    )


def test_preserves_source_evidence():

    entry = create_entry(
        "Tab Paracetamol 500 mg"
    )

    result = parse_medicine_entry(
        entry
    )

    assert len(
        result.evidence
    ) == 1

    assert (
        result.evidence[0].source_text
        == "Tab Paracetamol 500 mg"
    )