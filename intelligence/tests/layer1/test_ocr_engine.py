from unittest.mock import Mock

from PIL import Image

from app.layer1_document_processing.ocr_engine import (
    OCREngine,
)
from app.schemas.ocr import (
    OCRBlock,
    OCRPageResult,
)


def create_mock_engine():
    """
    Create an OCREngine instance without initializing
    the real PaddleOCR model.
    """

    engine = OCREngine.__new__(
        OCREngine
    )

    engine._ocr = Mock()

    return engine


def test_process_page_returns_ocr_page_result():
    engine = create_mock_engine()

    engine._ocr.predict.return_value = [
        {
            "rec_texts": [
                "Amoxicillin 500 mg",
                "Take twice daily",
            ],
            "rec_scores": [
                0.99,
                0.98,
            ],
            "dt_polys": [
                [
                    [10, 20],
                    [100, 20],
                    [100, 40],
                    [10, 40],
                ],
                [
                    [10, 60],
                    [120, 60],
                    [120, 80],
                    [10, 80],
                ],
            ],
        }
    ]

    image = Image.new(
        "RGB",
        (500, 300),
        "white",
    )

    result = engine.process_page(
        image
    )

    assert isinstance(
        result,
        OCRPageResult,
    )

    assert result.full_text == (
        "Amoxicillin 500 mg\n"
        "Take twice daily"
    )

    assert len(
        result.blocks
    ) == 2


def test_process_page_creates_correct_blocks():
    engine = create_mock_engine()

    engine._ocr.predict.return_value = [
        {
            "rec_texts": [
                "Paracetamol 500 mg",
            ],
            "rec_scores": [
                0.95,
            ],
            "dt_polys": [
                [
                    [10, 20],
                    [150, 20],
                    [150, 40],
                    [10, 40],
                ]
            ],
        }
    ]

    image = Image.new(
        "RGB",
        (500, 300),
        "white",
    )

    result = engine.process_page(
        image
    )

    block = result.blocks[0]

    assert isinstance(
        block,
        OCRBlock,
    )

    assert block.text == (
        "Paracetamol 500 mg"
    )

    assert block.confidence == 0.95

    assert block.bounding_box == [
        [10.0, 20.0],
        [150.0, 20.0],
        [150.0, 40.0],
        [10.0, 40.0],
    ]


def test_process_page_handles_empty_result():
    engine = create_mock_engine()

    engine._ocr.predict.return_value = []

    image = Image.new(
        "RGB",
        (500, 300),
        "white",
    )

    result = engine.process_page(
        image
    )

    assert result.full_text == ""
    assert result.blocks == []


def test_convert_box_returns_float_coordinates():
    box = [
        [10, 20],
        [30, 20],
        [30, 40],
        [10, 40],
    ]

    result = OCREngine._convert_box(
        box
    )

    assert result == [
        [10.0, 20.0],
        [30.0, 20.0],
        [30.0, 40.0],
        [10.0, 40.0],
    ]