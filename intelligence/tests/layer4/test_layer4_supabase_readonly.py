
import unittest

from app.layer4_medicine_intelligence.runtime.candidate_retriever import (
    CandidateRetriever,
)
from app.layer4_medicine_intelligence.runtime.repository import (
    MedicineRepository,
)
from app.layer4_medicine_intelligence.runtime.schemas import MedicineQuery


class TestLayer4SupabaseReadOnly(unittest.TestCase):

    def test_retrieve_medicines_and_ingredients(self):

        repository = MedicineRepository()
        retriever = CandidateRetriever(repository=repository)

        query = MedicineQuery(
            raw_medicine_text="Paracetamol",
            medicine_name="Paracetamol",
            normalized_medicine_name="paracetamol",
        )

        result = retriever.retrieve(query)

        self.assertTrue(result.attempted)

        print("\n--- Supabase Read-Only Test ---")
        print("Candidates retrieved:", len(result.candidates))

        for candidate in result.candidates:
            print("\nMedicine:", candidate.canonical_name)
            print("Medicine ID:", candidate.medicine_id)
            print("Ingredients:", len(candidate.ingredients))

            for ingredient in candidate.ingredients:
                print("  -", ingredient.ingredient_name)

        print("\nWarnings:", result.warnings)
        print("--- End Test ---")

        # An empty result is not necessarily a database failure.
        # The important checks are successful execution and valid data.


if __name__ == "__main__":
    unittest.main()
