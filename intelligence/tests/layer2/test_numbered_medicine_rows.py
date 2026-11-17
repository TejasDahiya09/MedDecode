from app.layer2_information_extraction.numbered_medicine_rows import (
    detect_unverified_numbered_rows,
    infer_numbered_list_region,
)
from app.layer2_information_extraction.provenance_safety import (
    exclude_unverified_identity_candidates,
)
from app.integration.contract_v1_mapper import map_contract_v1
from app.integration.offline_pipeline import (
    InMemoryMedicineRepository,
    run_offline_pipeline,
    synthetic_ocr_pages,
)
from app.layer4_medicine_intelligence.runtime.pipeline import MedicineIntelligencePipeline
from app.layer4_medicine_intelligence.runtime.schemas import RuntimeMatchStatus
from app.schemas.ocr import OCRBlock, OCRPageResult, UnverifiedNumberedRow
from app.schemas.prescription import RawMedicineEntry, SourceEvidence


def _box(text: str, left: float, top: float, width: float = 20, height: float = 20) -> OCRBlock:
    return OCRBlock(
        text=text,
        confidence=0.4,
        bounding_box=[
            [left, top],
            [left + width, top],
            [left + width, top + height],
            [left, top + height],
        ],
    )


def _numbered_page() -> OCRPageResult:
    blocks = []
    for number, top in enumerate((100, 300, 500, 700), start=1):
        blocks.extend(
            [
                _box(f"{number}.", 40, top),
                _box("unclear once daily", 95, top),
            ]
        )
    blocks.extend(
        [
            _box("diagnosis note", 700, 160, 180),
            _box("another side note", 700, 360, 180),
        ]
    )
    return OCRPageResult(full_text="", blocks=blocks)


def test_numbered_rows_are_retained_without_verifying_medicine_fields() -> None:
    page = _numbered_page()

    rows = detect_unverified_numbered_rows(
        page,
        page_number=1,
        page_size=(1000, 1000),
    )

    assert len(rows) == 4
    assert [row.observed_number for row in rows] == [1, 2, 3, 4]
    assert [row.candidate_sequence_number for row in rows] == [1, 2, 3, 4]
    assert all(row.raw_text for row in rows)
    assert all(row.confidence == 0.4 for row in rows)
    assert all(not row.medicine_name_verified for row in rows)
    assert all(not row.strength_verified for row in rows)
    assert all(not row.frequency_verified for row in rows)
    assert all(not row.duration_verified for row in rows)
    assert all(row.official_catalogue_match_status == "not_attempted" for row in rows)
    assert all(row.bounding_box[0][0] == 40 for row in rows)


def test_infers_a_bounded_region_from_repeated_aligned_number_tokens() -> None:
    region = infer_numbered_list_region(
        _numbered_page().blocks,
        (1000, 1000),
    )

    assert region is not None
    left, top, right, bottom = region
    assert 0 <= left < 40
    assert top < 100
    assert right > 400
    assert bottom > 700
    assert right <= 1000
    assert bottom <= 1000


def test_does_not_infer_rows_from_too_few_numbers() -> None:
    page = OCRPageResult(
        full_text="",
        blocks=[
            _box("1.", 40, 100),
            _box("diagnosis", 95, 100, 100),
            _box("2.", 40, 300),
            _box("follow-up", 95, 300, 100),
        ],
    )

    assert detect_unverified_numbered_rows(page, page_number=1, page_size=(1000, 1000)) == []
    assert infer_numbered_list_region(page.blocks, (1000, 1000)) is None


def test_unverified_rows_stay_out_of_contract_medicines_and_are_warned() -> None:
    page = _numbered_page()
    page.unverified_numbered_rows = detect_unverified_numbered_rows(
        page,
        page_number=1,
        page_size=(1000, 1000),
    )
    result = run_offline_pipeline([page], InMemoryMedicineRepository())
    response = map_contract_v1(
        {
            "job_id": "11111111-1111-4111-8111-111111111111",
            "prescription_id": "22222222-2222-4222-8222-222222222222",
        },
        result,
        source_mode="local_pdf",
    )

    assert len(result.prescription.unverified_numbered_rows) == 4
    assert response["medicines"] == []
    assert any(warning["code"] == "UNVERIFIED_NUMBERED_ROWS" for warning in response["warnings"])
    assert response["status"] == "completed_with_warnings"


def test_verified_adjacent_medicine_is_preserved_beside_unverified_rows() -> None:
    page = _numbered_page()
    page.blocks.append(_box("Tab Paracetamol 500 mg", 40, 900, 260))
    page.unverified_numbered_rows = detect_unverified_numbered_rows(
        page,
        page_number=1,
        page_size=(1000, 1000),
    )

    result = run_offline_pipeline([page], InMemoryMedicineRepository())
    response = map_contract_v1(
        {
            "job_id": "11111111-1111-4111-8111-111111111111",
            "prescription_id": "22222222-2222-4222-8222-222222222222",
        },
        result,
        source_mode="local_pdf",
    )

    assert [medicine.raw_medicine_name for medicine in result.medicines] == ["Paracetamol"]
    assert [medicine["extraction"]["medicine_name"] for medicine in response["medicines"]] == [
        "Paracetamol"
    ]
    assert len(result.prescription.unverified_numbered_rows) == 4
    assert sum(
        warning.field_name == "medicine_identity"
        for warning in result.prescription.warnings
    ) == 4


def test_numbered_legitimate_medicine_names_remain_supported_without_review_only_provenance() -> None:
    page = OCRPageResult(
        full_text="",
        blocks=[
            _box("Rx", 40, 40),
            _box("1. Paracetamol", 40, 100, 180),
            _box("2. Diclofenac", 40, 160, 180),
            _box("3. Ibuprofen", 40, 220, 180),
        ],
    )

    result = run_offline_pipeline([page], InMemoryMedicineRepository())

    assert [medicine.raw_medicine_name for medicine in result.medicines] == [
        "Paracetamol",
        "Diclofenac",
        "Ibuprofen",
    ]


def test_copied_overlapping_evidence_cannot_bypass_exclusion() -> None:
    page = _numbered_page()
    detected = detect_unverified_numbered_rows(page, page_number=1, page_size=(1000, 1000))
    first = detected[0]
    copied_evidence = tuple(
        OCRBlock(
            text=block.text,
            confidence=block.confidence,
            bounding_box=[point.copy() for point in block.bounding_box],
        )
        for block in first.evidence
    )
    page.unverified_numbered_rows = [
        UnverifiedNumberedRow(
            candidate_sequence_number=first.candidate_sequence_number,
            observed_number=first.observed_number,
            raw_text=first.raw_text,
            page_number=first.page_number,
            confidence=first.confidence,
            bounding_box=[point.copy() for point in first.bounding_box],
            evidence=copied_evidence,
        )
    ]

    result = run_offline_pipeline([page], InMemoryMedicineRepository())

    assert len(result.prescription.medicines) == 3
    assert all(medicine.raw_text == "unclear" for medicine in result.prescription.medicines)
    assert not any(
        set(evidence.source_block_indexes).intersection({0, 1})
        for medicine in result.prescription.medicines
        for evidence in medicine.evidence
    )


def test_missing_provenance_fails_closed_on_page_with_unverified_rows() -> None:
    page = _numbered_page()
    page.unverified_numbered_rows = detect_unverified_numbered_rows(
        page,
        page_number=1,
        page_size=(1000, 1000),
    )
    ambiguous = RawMedicineEntry(
        raw_text="Ambiguous",
        page_number=1,
        confidence=0.5,
        evidence=[SourceEvidence(page_number=1, source_text="Ambiguous")],
    )

    accepted, excluded = exclude_unverified_identity_candidates([page], [ambiguous])

    assert accepted == []
    assert excluded == [ambiguous]
    assert not ambiguous.automatic_identity_eligible

    no_evidence = RawMedicineEntry(
        raw_text="Ambiguous",
        page_number=1,
        confidence=0.5,
        evidence=[],
    )
    accepted, excluded = exclude_unverified_identity_candidates([page], [no_evidence])
    assert accepted == []
    assert excluded == [no_evidence]


def test_unverified_page_does_not_exclude_valid_medicine_on_another_page() -> None:
    first_page = _numbered_page()
    first_page.unverified_numbered_rows = detect_unverified_numbered_rows(
        first_page,
        page_number=1,
        page_size=(1000, 1000),
    )
    second_page = OCRPageResult(
        full_text="Tab Paracetamol 500 mg",
        blocks=[_box("Tab Paracetamol 500 mg", 40, 100, 260)],
    )

    result = run_offline_pipeline(
        [first_page, second_page],
        InMemoryMedicineRepository(),
    )

    assert [medicine.raw_medicine_name for medicine in result.medicines] == ["Paracetamol"]
    assert result.prescription.medicines[0].page_number == 2


def test_layer4_and_contract_mapper_reject_ineligible_identity_defense_in_depth() -> None:
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())
    raw_medicine = result.prescription.medicines[0]
    medicine = result.medicines[0]
    raw_medicine.automatic_identity_eligible = False
    medicine.automatic_identity_eligible = False

    match = MedicineIntelligencePipeline(
        repository=InMemoryMedicineRepository()
    ).match_medicine(medicine)
    response = map_contract_v1(
        {
            "job_id": "11111111-1111-4111-8111-111111111111",
            "prescription_id": "22222222-2222-4222-8222-222222222222",
        },
        result,
    )

    assert match.match_status is RuntimeMatchStatus.NOT_ATTEMPTED
    assert [item["extraction"]["medicine_name"] for item in response["medicines"]] == [
        "Unknownium"
    ]
    assert any(
        warning["code"] == "UNVERIFIED_MEDICINE_IDENTITY_EXCLUDED"
        for warning in response["warnings"]
    )
