from app.layer2_information_extraction.numbered_medicine_rows import (
    detect_unverified_numbered_rows,
    infer_numbered_list_region,
)
from app.integration.contract_v1_mapper import map_contract_v1
from app.integration.offline_pipeline import InMemoryMedicineRepository, run_offline_pipeline
from app.schemas.ocr import OCRBlock, OCRPageResult


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
