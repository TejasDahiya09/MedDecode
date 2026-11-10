"""
Read-only MedDecode Layers 1-5 runner for an actual prescription image.

Usage from the MedDecode project root:
    python test_real_prescription_e2e.py "tests/fixtures/actual_prescription.jpg"

This script performs database SELECTs through the existing Layer 4 repository.
It does not insert, update, or delete records.
"""

from __future__ import annotations

import argparse
import traceback
from pathlib import Path

from app.layer1_document_processing.pipeline import process_document_with_ocr
from app.layer2_information_extraction.pipeline import extract_prescription_information
from app.layer3_medicine_understanding.pipeline import understand_medicine_entries
from app.layer4_medicine_intelligence.runtime.pipeline import MedicineIntelligencePipeline
from app.layer4_medicine_intelligence.runtime.repository import MedicineRepository
from app.layer4_medicine_intelligence.runtime.recommendation_data_provider import (
    Layer4RecommendationDataProvider,
)
from app.layer5_recommendations.pipeline import RecommendationPipeline


def print_section(title: str) -> None:
    print("\\n" + "=" * 76)
    print(title)
    print("=" * 76)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run MedDecode Layers 1-5 on an actual prescription image (read-only DB)."
    )
    parser.add_argument("image", help="Path to the prescription image (JPG/PNG/PDF supported by Layer 1)")
    args = parser.parse_args()

    image_path = Path(args.image).expanduser().resolve()
    if not image_path.is_file():
        print(f"[FAIL] Image file not found: {image_path}")
        return 1

    print_section("MEDDECODE REAL PRESCRIPTION END-TO-END TEST (READ ONLY)")
    print(f"Input image: {image_path}")
    print("No patient or medicine UUID is supplied to the Layer 4 matcher.")

    # Layer 1: OCR
    print_section("LAYER 1 - DOCUMENT PROCESSING AND OCR")
    pages = process_document_with_ocr(str(image_path))
    if not pages:
        print("[FAIL] Layer 1 returned no OCR pages.")
        return 1

    for index, page in enumerate(pages, start=1):
        print(f"\\nOCR PAGE {index} TEXT:\\n{page.full_text}")
    print(f"[PASS] Layer 1 produced {len(pages)} OCR page(s).")

    # Layer 2: extraction
    print_section("LAYER 2 - PRESCRIPTION INFORMATION EXTRACTION")
    prescription = extract_prescription_information(pages)
    raw_entries = prescription.medicines or []
    print(f"Raw medicine entries found: {len(raw_entries)}")
    for index, entry in enumerate(raw_entries, start=1):
        print(f"{index}. {entry.raw_text}")
        print(f"   Instructions: {entry.instructions}")
    if not raw_entries:
        print("[STOP] Layer 2 found no medicine entries. Review OCR/extraction.")
        return 2
    print("[PASS] Layer 2 extracted medicine entries.")

    # Layer 3: understanding
    print_section("LAYER 3 - MEDICINE UNDERSTANDING")
    medicines = understand_medicine_entries(raw_entries)
    if not medicines:
        print("[STOP] Layer 3 returned no structured medicine records.")
        return 3

    for index, medicine in enumerate(medicines, start=1):
        strength = medicine.strength
        print(f"\\nMedicine {index}")
        print(f"  Raw text: {medicine.raw_medicine_text}")
        print(f"  Parsed name: {medicine.raw_medicine_name}")
        print(f"  Normalized name: {medicine.normalized_medicine_name}")
        print(f"  Strength: {getattr(strength, 'value', None)} {getattr(strength, 'unit', None)}")
        print(f"  Dosage form: {medicine.dosage_form}")
        print(f"  Timing: {medicine.timing}")
        duration = getattr(medicine, "duration", None)
        print(f"  Duration: {getattr(duration, 'value', None)} {getattr(duration, 'unit', None)}")
        print(f"  Warnings: {medicine.warnings}")
    print("[PASS] Layer 3 produced structured medicine record(s).")

    # Layers 4-5: each extracted medicine is independently matched.
    print_section("LAYER 4 - REAL SUPABASE MEDICINE SEARCH")
    repository = MedicineRepository()
    matcher = MedicineIntelligencePipeline(repository=repository)
    provider = Layer4RecommendationDataProvider(repository=repository)
    ranker = RecommendationPipeline()

    matched_count = 0
    ranked_count = 0
    no_candidate_count = 0

    for index, medicine in enumerate(medicines, start=1):
        print_section(f"MEDICINE {index} - LAYER 4 MATCH")
        print(f"Input name: {medicine.raw_medicine_name}")
        print(f"Input strength: {getattr(medicine.strength, 'value', None)} {getattr(medicine.strength, 'unit', None)}")
        print(f"Input form: {medicine.dosage_form}")

        match = matcher.match_medicine(medicine)
        print(f"Match status: {match.match_status.value}")
        print(f"Explanation: {match.explanation}")
        print(f"Warnings: {match.warnings}")

        if match.selected_candidate is None or match.match_status.value != "MATCHED":
            print("[SKIP] No confirmed identity. Layer 5 will not run for this entry.")
            continue

        matched_count += 1
        candidate = match.selected_candidate
        print(f"Selected candidate: {candidate.canonical_name}")
        print(f"Selected UUID (output only): {candidate.medicine_id}")

        print_section(f"MEDICINE {index} - LAYER 4 ENRICHMENT")
        layer4_input = provider.build_input(match)
        source_data = layer4_input.selected_medicine
        if source_data is None:
            print("[SKIP] No enriched source medicine was supplied.")
            print(f"Warnings: {layer4_input.warnings}")
            continue

        print(f"Ingredients loaded: {len(source_data.medicine.ingredients)}")
        for ingredient in source_data.medicine.ingredients:
            print(
                f"  - {ingredient.ingredient_name}: "
                f"{ingredient.strength_value} {ingredient.strength_unit}"
            )
        print(f"Price observations: {len(source_data.prices)}")
        print(f"Alternative candidates: {len(layer4_input.alternative_candidates)}")
        print(f"Enrichment warnings: {layer4_input.warnings}")

        print_section(f"MEDICINE {index} - LAYER 5 RANKING")
        recommendation = ranker.rank(layer4_input)
        print(f"Recommendation status: {recommendation.status.value}")
        print(f"Explanation: {recommendation.explanation}")
        print(f"Warnings: {recommendation.warnings}")

        if recommendation.ranked_medicines:
            ranked_count += 1
            for item in recommendation.ranked_medicines:
                print(
                    f"\\nRank {item.rank}: {item.medicine_name} "
                    f"(score: {item.overall_score:.2f})"
                )
                print(f"  Strength: {item.strength_value} {item.strength_unit}")
                print(f"  Form: {item.dosage_form}")
                print(f"  Review required: {item.review_required}")
                for criterion, score in item.criteria_scores.items():
                    value = score.score if score.score is not None else "N/A"
                    print(f"  {criterion}: {value}")
                for warning in item.warnings:
                    print(f"  Warning: {warning}")
        else:
            no_candidate_count += 1
            print("No eligible alternatives were ranked for this medicine.")

    print_section("FINAL SUMMARY")
    print(f"Medicines extracted: {len(raw_entries)}")
    print(f"Structured medicine records: {len(medicines)}")
    print(f"Confirmed Layer 4 matches: {matched_count}")
    print(f"Medicines with ranked alternatives: {ranked_count}")
    print(f"Medicines with no ranked alternatives: {no_candidate_count}")
    print("[PASS] No database write operations were issued by this script.")
    print("NOTE: OCR output is not a verified prescription. Manually review every extracted name, strength and instruction.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        print_section("TEST FAILED WITH EXCEPTION")
        traceback.print_exc()
        raise SystemExit(10)
