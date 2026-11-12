
import unittest

from app.schemas.medicine import MedicineUsageRecord, Strength

from app.layer4_medicine_intelligence.runtime.pipeline import (
    MedicineIntelligencePipeline,
)
from app.layer4_medicine_intelligence.runtime.repository import (
    MedicineRepository,
)
from app.layer4_medicine_intelligence.runtime.schemas import (
    RuntimeMatchStatus,
)


class TestLayer4RuntimeEndToEnd(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Real Supabase repository; all operations are read-only.
        cls.pipeline = MedicineIntelligencePipeline(
            repository=MedicineRepository()
        )

    @staticmethod
    def make_medicine(
        name,
        normalized_name,
        strength_value=None,
        strength_unit=None,
        dosage_form=None,
    ):
        return MedicineUsageRecord(
            raw_medicine_text=name,
            raw_medicine_name=name,
            normalized_medicine_name=normalized_name,
            dosage_form=dosage_form,
            strength=Strength(
                value=strength_value,
                unit=strength_unit,
            ),
        )

    def print_result(self, scenario, result):
        print(f"\n--- {scenario} ---")
        print("Status:", result.match_status.value)
        print("Confidence/ranking score:", result.confidence_score)
        print("Explanation:", result.explanation)

        if result.selected_candidate:
            print(
                "Selected medicine:",
                result.selected_candidate.canonical_name,
            )

        print("Ranked candidates:", len(result.ranked_candidates))
        print("Warnings:", result.warnings)

    def test_exact_medicine_and_strength(self):
        medicine = self.make_medicine(
            name="Paracetamol 500 MG",
            normalized_name="paracetamol 500 mg",
            strength_value=500,
            strength_unit="mg",
            dosage_form="tablet",
        )

        result = self.pipeline.match_medicine(medicine)
        self.print_result("EXACT MEDICINE AND STRENGTH", result)

        self.assertEqual(
            result.match_status,
            RuntimeMatchStatus.MATCHED,
        )
        self.assertIsNotNone(result.selected_candidate)

    def test_strength_mismatch_is_not_matched(self):
        medicine = self.make_medicine(
            name="Paracetamol 500 MG",
            normalized_name="paracetamol 500 mg",
            strength_value=650,
            strength_unit="mg",
            dosage_form="tablet",
        )

        result = self.pipeline.match_medicine(medicine)
        self.print_result("STRENGTH MISMATCH", result)

        self.assertNotEqual(
            result.match_status,
            RuntimeMatchStatus.MATCHED,
        )

        self.assertIsNone(result.selected_candidate)

    def test_unknown_medicine(self):
        medicine = self.make_medicine(
            name="MedDecodeUnknownMedicineXYZ987",
            normalized_name="meddecodeunknownmedicinexyz987",
        )

        result = self.pipeline.match_medicine(medicine)
        self.print_result("UNKNOWN MEDICINE", result)

        self.assertEqual(
            result.match_status,
            RuntimeMatchStatus.UNMATCHED,
        )

        self.assertIsNone(result.selected_candidate)

    def test_missing_strength_and_form(self):
        medicine = self.make_medicine(
            name="Paracetamol 500 MG",
            normalized_name="paracetamol 500 mg",
        )

        result = self.pipeline.match_medicine(medicine)
        self.print_result("MISSING STRENGTH AND FORM", result)

        self.assertEqual(
            result.match_status,
            RuntimeMatchStatus.PROBABLE_MATCH,
        )

        self.assertIsNotNone(result.selected_candidate)


if __name__ == "__main__":
    unittest.main(verbosity=2)
