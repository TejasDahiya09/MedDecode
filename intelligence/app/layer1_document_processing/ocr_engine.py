from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from app.schemas.ocr import OCRBlock, OCRPageResult


@dataclass(frozen=True)
class PaddleOCRLocalModelConfig:
    """Explicit local Paddle model locations for offline inference."""

    text_detection_model_dir: Path
    text_recognition_model_dir: Path
    device: str = "cpu"
    enable_mkldnn: bool = False

    def validate(self) -> None:
        if self.device != "cpu":
            raise ValueError("The local MedDecode OCR baseline supports CPU inference only.")
        for directory in (self.text_detection_model_dir, self.text_recognition_model_dir):
            if not directory.is_dir():
                raise ValueError("Required local PaddleOCR model assets are unavailable.")


class OCREngine:
    """
    PaddleOCR adapter for the MedDecode document-processing pipeline.

    This class converts standardized Pillow images into MedDecode's
    stable OCR output format.
    """

    def __init__(self, local_model_config: PaddleOCRLocalModelConfig | None = None) -> None:
        from paddleocr import PaddleOCR

        options: dict[str, Any] = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        }
        if local_model_config is not None:
            local_model_config.validate()
            options.update(
                {
                    "text_detection_model_dir": str(local_model_config.text_detection_model_dir),
                    "text_recognition_model_dir": str(local_model_config.text_recognition_model_dir),
                    "device": local_model_config.device,
                    "enable_mkldnn": local_model_config.enable_mkldnn,
                }
            )
        self._ocr = PaddleOCR(**options)

    def process_page(
        self,
        image: Image.Image,
    ) -> OCRPageResult:
        """
        Run OCR on a single standardized document page.

        Args:
            image:
                A Pillow image produced by the document-processing
                pipeline.

        Returns:
            OCRPageResult containing full text and OCR blocks.
        """

        image_array = np.array(
            image.convert("RGB")
        )

        results = self._ocr.predict(
            image_array
        )

        blocks = []

        for result in results:
            result_data = self._extract_result_data(
                result
            )

            texts = result_data.get(
                "rec_texts",
                []
            )

            scores = result_data.get(
                "rec_scores",
                []
            )

            boxes = result_data.get(
                "dt_polys",
                []
            )

            for text, score, box in zip(
                texts,
                scores,
                boxes,
            ):
                blocks.append(
                    OCRBlock(
                        text=str(text),
                        confidence=float(score),
                        bounding_box=self._convert_box(
                            box
                        ),
                    )
                )

        full_text = "\n".join(
            block.text
            for block in blocks
        )

        return OCRPageResult(
            full_text=full_text,
            blocks=blocks,
        )

    @staticmethod
    def _extract_result_data(
        result: Any,
    ) -> dict[str, Any]:
        """
        Extract the dictionary payload from a PaddleOCR result.
        """

        if isinstance(result, dict):
            return result.get(
                "res",
                result,
            )

        if hasattr(result, "json"):
            result_json = result.json

            if callable(result_json):
                result_json = result_json()

            if isinstance(result_json, dict):
                return result_json.get(
                    "res",
                    result_json,
                )

        if hasattr(result, "res"):
            return result.res

        raise ValueError(
            "Unsupported PaddleOCR result format."
        )

    @staticmethod
    def _convert_box(
        box: Any,
    ) -> list[list[float]]:
        """
        Convert an OCR bounding polygon into JSON-friendly coordinates.
        """

        return [
            [
                float(point[0]),
                float(point[1]),
            ]
            for point in box
        ]
