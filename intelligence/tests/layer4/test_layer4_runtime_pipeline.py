
import unittest
from unittest.mock import patch
from uuid import uuid4

from app.schemas.medicine import MedicineUsageRecord, Strength

from app.layer4_medicine_intelligence.runtime.candidate_retriever import (
    CandidateRetrievalResult,
)
from app.layer4_medicine_intelligence.runtime.pipeline import (
    MedicineIntelligencePipeline,
)
from app.layer4_medicine_intelligence.runtime.schemas import (
    MedicineCandidate,
    RuntimeMatchStatus,
)


class FakeCandidateRetriever:
    def __init__(self, repository):
        self.repository = repository

    def retrieve(self, query):
        candidate = MedicineCandidate(
            medicine_id=uuid4(),
            canonical_name="Paracetamol",
            normalized_name="paracetamol",
            brand_name=None,
            generic_name="Paracetamol",
            dosage_form="tablet",
            strength_value=500,
            strength_unit="mg",
            medicine_type=None,
            prescription_required=None,
            ingredients=[],
        )

        return CandidateRetrievalResult(
            candidates=[candidate],
            retrieval_reasons={
                candidate.medicine_id: ["exact canonical name"]
            },
            attempted=True,
            warnings=[],
        )


class TestLayer4RuntimePipeline(unittest.TestCase):

    @patch(
        "app.layer4_medicine_intelligence.runtime.pipeline.CandidateRetriever",
        FakeCandidateRetriever,
    )
    def test_layer3_record_flows_through_layer4(self):

        medicine = MedicineUsageRecord(
            raw_medicine_text="Paracetamol 500 mg tablet",
            raw_medicine_name="Paracetamol",
            normalized_medicine_name="paracetamol",
            dosage_form="tablet",
            strength=Strength(value=500, unit="mg"),
        )

        pipeline = MedicineIntelligencePipeline(
            repository=object()
        )

        result = pipeline.match_medicine(medicine)

        self.assertEqual(
            result.match_status,
            RuntimeMatchStatus.MATCHED,
        )

        self.assertEqual(
            result.query.medicine_name,
            "Paracetamol",
        )

        self.assertEqual(
            result.query.strength_value,
            500,
        )

        self.assertEqual(
            result.query.strength_unit,
            "mg",
        )

        self.assertIsNotNone(result.selected_candidate)

        self.assertEqual(
            result.selected_candidate.canonical_name,
            "Paracetamol",
        )

        self.assertTrue(result.explanation)

    @patch(
        "app.layer4_medicine_intelligence.runtime.pipeline.CandidateRetriever",
        FakeCandidateRetriever,
    )
    def test_missing_medicine_name_is_not_attempted(self):

        medicine = MedicineUsageRecord(
            raw_medicine_text="",
            raw_medicine_name=None,
            normalized_medicine_name=None,
            dosage_form=None,
            strength=Strength(value=None, unit=None),
        )

        pipeline = MedicineIntelligencePipeline(
            repository=object()
        )

        result = pipeline.match_medicine(medicine)

        self.assertEqual(
            result.match_status,
            RuntimeMatchStatus.NOT_ATTEMPTED,
        )

        self.assertIsNone(result.selected_candidate)


if __name__ == "__main__":
    unittest.main()
