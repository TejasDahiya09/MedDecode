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


def test_extracts_supported_strength_units_and_decimals():
    cases = [
        ("Tab MedicineX 2.5 mg", 2.5, "mg"),
        ("Cap MedicineX 500 mcg", 500.0, "mcg"),
        ("Tab MedicineX 0.5 g", 0.5, "g"),
        ("Syrup MedicineX 5 mL", 5.0, "ml"),
    ]

    for raw_text, expected_value, expected_unit in cases:
        result = parse_medicine_entry(create_entry(raw_text))

        assert result.strength.value == expected_value
        assert result.strength.unit == expected_unit


def test_does_not_report_only_the_numerator_of_a_liquid_concentration():
    result = parse_medicine_entry(
        create_entry("Syrup Amoxicillin 125 mg/5 mL")
    )

    assert result.dosage_form == "syrup"
    assert result.raw_medicine_name == "Amoxicillin"
    assert result.strength.value is None
    assert result.strength.unit is None
    assert result.ingredient_strengths == []
    assert any(warning.field_name == "strength" for warning in result.warnings)


def test_does_not_assign_component_strengths_from_a_liquid_concentration():
    result = parse_medicine_entry(
        create_entry(
            "Syrup Amoxicillin 125 mg + Clavulanic acid 31.25 mg per 5 mL"
        )
    )

    assert result.raw_medicine_name == "Amoxicillin + Clavulanic acid"
    assert result.ingredient_strengths == []
    assert result.strength.value is None


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


def test_strips_medicine_field_label_and_preserves_source_text():

    entry = create_entry(
        "Medicine: Examplemed 10 mg"
    )

    result = parse_medicine_entry(
        entry
    )

    assert result.raw_medicine_text == entry.raw_text
    assert result.raw_medicine_name == "Examplemed"
    assert result.strength.value == 10
    assert result.strength.unit == "mg"
    assert result.evidence[0].source_text == entry.raw_text


def test_template_labels_are_not_medicine_identity_and_form_is_preserved():
    for raw_text, expected_form in [
        ("Strength: Dosage form: Tablet", "tablet"),
        ("Strength: Dosage form: Oral liquid", "oral liquid"),
    ]:
        result = parse_medicine_entry(create_entry(raw_text))

        assert result.raw_medicine_name is None
        assert result.dosage_form == expected_form
        assert result.strength.value is None
        assert result.strength.unit is None
        assert any(warning.field_name == "medicine_name" for warning in result.warnings)


def test_template_name_strength_and_form_are_separated_without_losing_identity():
    result = parse_medicine_entry(
        create_entry("Paracetamol Strength: 500 mg Dosage form: Tablet")
    )

    assert result.raw_medicine_name == "Paracetamol"
    assert result.strength.value == 500
    assert result.strength.unit == "mg"
    assert result.dosage_form == "tablet"


def test_template_liquid_concentration_preserves_name_and_form_but_not_false_strength():
    result = parse_medicine_entry(
        create_entry("Amoxicillin Strength: 125 mg/5 mL Dosage form: Oral liquid")
    )

    assert result.raw_medicine_name == "Amoxicillin"
    assert result.dosage_form == "oral liquid"
    assert result.strength.value is None
    assert result.strength.unit is None
    assert any(warning.field_name == "strength" for warning in result.warnings)


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


def test_strips_instruction_suffixes_from_medicine_name():
    result = parse_medicine_entry(
        create_entry(
            "Tab Paracetamol 500 mg 1-0-1 after food"
        )
    )

    assert result.raw_medicine_name == "Paracetamol"
    assert result.strength.value == 500
    assert result.strength.unit == "mg"


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
