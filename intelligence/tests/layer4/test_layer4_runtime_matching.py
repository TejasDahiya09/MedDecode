
import unittest
from uuid import uuid4

from app.layer4_medicine_intelligence.runtime.candidate_ranker import (
    CandidateRanker,
)
from app.layer4_medicine_intelligence.runtime.match_classifier import (
    MatchClassifier,
)
from app.layer4_medicine_intelligence.runtime.schemas import (
    MedicineCandidate,
    MedicineQuery,
    RuntimeMatchStatus,
)


class TestMedicineRuntimeMatching(unittest.TestCase):

    def setUp(self):
        self.ranker = CandidateRanker()
        self.classifier = MatchClassifier()

    def make_query(self, strength_value=None, strength_unit=None):
        return MedicineQuery(
            raw_medicine_text="Paracetamol",
            medicine_name="Paracetamol",
            normalized_medicine_name="paracetamol",
            dosage_form=None,
            strength_value=strength_value,
            strength_unit=strength_unit,
            active_ingredients=[],
        )

    def make_candidate(self, strength_value=None, strength_unit=None):
        return MedicineCandidate(
            medicine_id=uuid4(),
            canonical_name="Paracetamol",
            normalized_name="paracetamol",
            brand_name=None,
            generic_name="Paracetamol",
            dosage_form=None,
            strength_value=strength_value,
            strength_unit=strength_unit,
            medicine_type=None,
            prescription_required=None,
            ingredients=[],
        )

    def test_exact_name_and_strength_produce_matched(self):
        query = self.make_query(500, "mg")
        candidate = self.make_candidate(500, "mg")

        ranking = self.ranker.rank(query, [candidate])
        result = self.classifier.classify(ranking)

        self.assertEqual(
            result.match_status,
            RuntimeMatchStatus.MATCHED,
        )
        self.assertIsNotNone(result.selected_candidate)
        self.assertEqual(
            result.selected_candidate.medicine_id,
            candidate.medicine_id,
        )

    def test_strength_conflict_never_produces_matched(self):
        query = self.make_query(500, "mg")
        candidate = self.make_candidate(650, "mg")

        ranking = self.ranker.rank(query, [candidate])
        result = self.classifier.classify(ranking)

        self.assertTrue(
            ranking.ranked_candidates[0].hard_conflicts
        )
        self.assertNotEqual(
            result.match_status,
            RuntimeMatchStatus.MATCHED,
        )
        self.assertIsNone(result.selected_candidate)

    def test_name_only_evidence_is_not_confirmed_match(self):
        query = self.make_query()
        candidate = self.make_candidate()

        ranking = self.ranker.rank(query, [candidate])
        result = self.classifier.classify(ranking)

        self.assertEqual(
            result.match_status,
            RuntimeMatchStatus.PROBABLE_MATCH,
        )
        self.assertIsNotNone(result.selected_candidate)

    def test_no_candidates_produce_unmatched(self):
        query = self.make_query(500, "mg")

        ranking = self.ranker.rank(query, [])
        result = self.classifier.classify(ranking)

        self.assertEqual(
            result.match_status,
            RuntimeMatchStatus.UNMATCHED,
        )
        self.assertIsNone(result.selected_candidate)


if __name__ == "__main__":
    unittest.main()
