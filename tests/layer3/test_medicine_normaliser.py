from app.layer3_medicine_understanding.medicine_normaliser import (
    normalize_medicine_name,
    normalize_medicine_record,
)
from app.schemas.medicine import (
    MedicineUsageRecord,
    Strength,
)


def test_normalizes_medicine_name_to_lowercase():

    result = normalize_medicine_name(
        "PARACETAMOL"
    )

    assert result == "paracetamol"


def test_normalizes_medicine_name_whitespace():

    result = normalize_medicine_name(
        "  Paracetamol    Extended   Release  "
    )

    assert (
        result
        == "paracetamol extended release"
    )


def test_missing_medicine_name_remains_none():

    result = normalize_medicine_name(
        None
    )

    assert result is None


def test_empty_medicine_name_becomes_none():

    result = normalize_medicine_name(
        "     "
    )

    assert result is None


def test_normalizes_complete_medicine_record():

    record = MedicineUsageRecord(
        raw_medicine_text=(
            "Tab PARACETAMOL 500 mg"
        ),
        raw_medicine_name=(
            "  PARACETAMOL  "
        ),
        dosage_form="TABLET",
        strength=Strength(
            value=500,
            unit="MG",
        ),
    )

    result = normalize_medicine_record(
        record
    )

    assert (
        result.raw_medicine_name
        == "  PARACETAMOL  "
    )

    assert (
        result.normalized_medicine_name
        == "paracetamol"
    )

    assert (
        result.dosage_form
        == "tablet"
    )

    assert (
        result.strength.value
        == 500.0
    )

    assert (
        result.strength.unit
        == "mg"
    )