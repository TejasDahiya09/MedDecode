"""
Read-only real-data end-to-end test for MedDecode Layers 1–5.

- Creates a synthetic prescription image locally (no real patient data).
- Runs the real OCR, extraction, understanding and matching pipelines.
- Uses the real Supabase medicine catalogue through MedicineRepository.
- Uses a known Paracetamol UUID only for final verification, never as a search input.
- Performs SELECT queries only; this script contains no INSERT/UPDATE/DELETE calls.
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.layer1_document_processing.pipeline import process_document_with_ocr
from app.layer2_information_extraction.pipeline import extract_prescription_information
from app.layer3_medicine_understanding.pipeline import understand_medicine_entries
from app.layer4_medicine_intelligence.runtime.pipeline import MedicineIntelligencePipeline
from app.layer4_medicine_intelligence.runtime.repository import MedicineRepository
from app.layer4_medicine_intelligence.runtime.recommendation_data_provider import (
    Layer4RecommendationDataProvider,
)
from app.layer5_recommendations.pipeline import RecommendationPipeline


EXPECTED_MEDICINE_ID = "01dcf50a-f501-4cd2-8983-3f219eb80ba6"
EXPECTED_MEDICINE_NAME = "Paracetamol 500 MG"

ROOT = Path(__file__).resolve().parent
FIXTURE_DIR = ROOT / "tests" / "fixtures"
IMAGE_PATH = FIXTURE_DIR / "meddecode_e2e_paracetamol_test.png"


def make_test_prescription(path: Path) -> None:
    """Create a clean synthetic prescription image for OCR testing."""
    path.parent.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGB", (1800, 1200), "white")
    draw = ImageDraw.Draw(image)

    font_candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    font_path = next((p for p in font_candidates if Path(p).exists()), None)

    if font_path:
        title_font = ImageFont.truetype(font_path, 58)
        body_font = ImageFont.truetype(font_path, 48)
        small_font = ImageFont.truetype(font_path, 34)
    else:
        title_font = ImageFont.load_default(size=58)
        body_font = ImageFont.load_default(size=48)
        small_font = ImageFont.load_default(size=34)

    draw.text((120, 90), "MEDICAL PRESCRIPTION", fill="black", font=title_font)
    draw.line((120, 180, 1680, 180), fill="black", width=4)
    draw.text((140, 270), "Rx", fill="black", font=body_font)
    draw.text((220, 390), "Paracetamol 500 mg Tablet", fill="black", font=body_font)
    draw.text(
        (220, 490),
        "1 tablet twice daily after food for 3 days",
        fill="black",
        font=body_font,
    )

    image.save(path)
    print(f"[SETUP] Synthetic prescription image: {path}")


def print_section(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def main() -> int:
    print_section("MEDDECODE REAL SUPABASE END-TO-END TEST (READ ONLY)")

    # 0. Generate controlled input image.
    make_test_prescription(IMAGE_PATH)

    # 1. Verify the expected record exists. Its ID is NOT passed to Layer 4.
    print_section("DATABASE PRECHECK - EXPECTED RECORD ONLY")
    repository = MedicineRepository()

    expected_rows = repository.database.table("medicines").select(
        "id, canonical_name, normalized_name, dosage_form, strength_value, strength_unit"
    ).eq("id", EXPECTED_MEDICINE_ID).execute().data or []

    if not expected_rows:
        print("[FAIL] Expected Paracetamol record was not found by ID.")
        return 1

    expected = expected_rows[0]
    print(f"[PASS] Expected record exists: {expected.get('canonical_name')}")
    print(f"       UUID reserved for final verification: {EXPECTED_MEDICINE_ID}")
    print("       This UUID is not supplied to the Layer 4 matcher.")

    # 2. Layer 1 - real OCR.
    print_section("LAYER 1 - DOCUMENT PROCESSING AND OCR")
    pages = process_document_with_ocr(str(IMAGE_PATH))
    if not pages:
        print("[FAIL] Layer 1 returned no OCR pages.")
        return 1

    for index, page in enumerate(pages, start=1):
        print(f"\nOCR PAGE {index} TEXT:\n{page.full_text}")

    print(f"[PASS] Layer 1 produced {len(pages)} OCR page(s).")

    # 3. Layer 2 - prescription extraction.
    print_section("LAYER 2 - PRESCRIPTION INFORMATION EXTRACTION")
    prescription = extract_prescription_information(pages)
    raw_entries = prescription.medicines or []

    print(f"Raw medicine entries found: {len(raw_entries)}")
    for index, entry in enumerate(raw_entries, start=1):
        print(f"{index}. {entry.raw_text}")
        print(f"   Instructions: {entry.instructions}")

    if not raw_entries:
        print("[FAIL] Layer 2 did not extract a medicine entry.")
        return 1

    print("[PASS] Layer 2 extracted medicine entries.")

    # 4. Layer 3 - structured medicine understanding.
    print_section("LAYER 3 - MEDICINE UNDERSTANDING")
    medicines = understand_medicine_entries(raw_entries)

    if not medicines:
        print("[FAIL] Layer 3 returned no MedicineUsageRecord.")
        return 1

    for index, medicine in enumerate(medicines, start=1):
        strength = medicine.strength
        print(f"\nMedicine {index}")
        print(f"  Raw text: {medicine.raw_medicine_text}")
        print(f"  Parsed name: {medicine.raw_medicine_name}")
        print(f"  Normalized name: {medicine.normalized_medicine_name}")
        print(f"  Strength: {getattr(strength, 'value', None)} {getattr(strength, 'unit', None)}")
        print(f"  Dosage form: {medicine.dosage_form}")
        print(f"  Timing: {medicine.timing}")
        print(f"  Duration: {getattr(medicine.duration, 'value', None)} {getattr(medicine.duration, 'unit', None)}")
        print(f"  Warnings: {medicine.warnings}")

    print("[PASS] Layer 3 produced structured medicine record(s).")

    # This test image intentionally contains one medicine.
    target_medicine = medicines[0]

    # 5. Layer 4 - independent search through the real repository.
    print_section("LAYER 4 - REAL SUPABASE MEDICINE SEARCH")
    layer4 = MedicineIntelligencePipeline(repository=repository)
    match = layer4.match_medicine(target_medicine)

    print(f"Match status: {match.match_status.value}")
    print(f"Query medicine name: {match.query.medicine_name}")
    print(f"Normalized query name: {match.query.normalized_medicine_name}")
    print(f"Query strength: {match.query.strength_value} {match.query.strength_unit}")
    print(f"Query dosage form: {match.query.dosage_form}")
    print(f"Explanation: {match.explanation}")
    print(f"Warnings: {match.warnings}")

    if match.selected_candidate:
        selected_id = str(match.selected_candidate.medicine_id)
        print(f"Selected candidate: {match.selected_candidate.canonical_name}")
        print(f"Selected UUID: {selected_id}")
        print(f"Selected strength: {match.selected_candidate.strength_value} {match.selected_candidate.strength_unit}")
        print(f"Selected form: {match.selected_candidate.dosage_form}")

        if selected_id == EXPECTED_MEDICINE_ID:
            print("[PASS] Layer 4 independently found the expected Supabase record.")
        else:
            print("[FAIL] Layer 4 selected a different record than the expected UUID.")
            print("[STOP] Not passing an unexpected medicine to Layer 5.")
            return 2
    else:
        print("[FAIL] Layer 4 did not select a medicine candidate.")
        print("[STOP] Layer 5 will not be given an unconfirmed identity.")
        return 2

    if match.match_status.value != "MATCHED":
        print("[FAIL] Layer 4 did not produce MATCHED status.")
        print("[STOP] Layer 5 will not rank an uncertain identity.")
        return 2

    # 6. Layer 4 recommendation-data enrichment, then Layer 5.
    print_section("LAYER 4 ENRICHMENT - REAL SUPABASE RELATED DATA")
    provider = Layer4RecommendationDataProvider(repository=repository)
    layer4_input = provider.build_input(match)

    source_data = layer4_input.selected_medicine
    if source_data is None:
        print("[FAIL] Layer 4 did not provide an enriched source medicine.")
        print(f"Warnings: {layer4_input.warnings}")
        return 3

    print(f"Source ingredients loaded: {len(source_data.medicine.ingredients)}")
    for ingredient in source_data.medicine.ingredients:
        print(
            f"  - {ingredient.ingredient_name}: "
            f"{ingredient.strength_value} {ingredient.strength_unit}"
        )
    print(f"Source price observations: {len(source_data.prices)}")
    print(f"Alternative candidates retrieved: {len(layer4_input.alternative_candidates)}")
    print(f"Layer 4 enrichment warnings: {layer4_input.warnings}")

    # 7. Layer 5 - pure in-memory ranking.
    print_section("LAYER 5 - RECOMMENDATION RANKING")
    recommendation = RecommendationPipeline().rank(layer4_input)

    print(f"Recommendation status: {recommendation.status.value}")
    print(f"Source medicine: {recommendation.source_medicine_name}")
    print(f"Explanation: {recommendation.explanation}")
    print(f"Warnings: {recommendation.warnings}")

    if recommendation.ranked_medicines:
        for item in recommendation.ranked_medicines:
            print(
                f"\nRank {item.rank}: {item.medicine_name} "
                f"(score: {item.overall_score:.2f})"
            )
            print(f"  Strength: {item.strength_value} {item.strength_unit}")
            print(f"  Form: {item.dosage_form}")
            print(f"  Review required: {item.review_required}")
            for criterion, score in item.criteria_scores.items():
                print(
                    f"  {criterion}: "
                    f"{score.score if score.score is not None else 'N/A'}"
                )
            for warning in item.warnings:
                print(f"  Warning: {warning}")
    else:
        print("No eligible alternatives were ranked.")
        print("This is a valid outcome if the catalogue has no candidates meeting all gates.")

    print_section("FINAL TEST SUMMARY")
    print("[PASS] Layer 1 OCR completed.")
    print("[PASS] Layer 2 extraction completed.")
    print("[PASS] Layer 3 understanding completed.")
    print("[PASS] Layer 4 independently matched the expected Supabase record.")
    print(f"[{'PASS' if recommendation.status.value in ('RANKED', 'NO_CANDIDATES') else 'CHECK'}] Layer 5 executed: {recommendation.status.value}")
    print("[PASS] No database write operations were issued by this test.")
    print("\nNOTE: A NO_CANDIDATES result means the pipeline ran, but no alternatives passed the ranking gates.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        print_section("TEST FAILED WITH EXCEPTION")
        traceback.print_exc()
        raise SystemExit(10)
