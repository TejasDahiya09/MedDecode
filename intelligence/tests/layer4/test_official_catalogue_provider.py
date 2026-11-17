import pytest

from app.layer4_medicine_intelligence.runtime.official_catalogue_provider import LocalOfficialCatalogueMedicineRepository, OfficialCatalogueProvider
class Cursor:
    def __init__(self, rows): self.rows=rows; self.call=None
    def execute(self, statement, parameters=()): self.call=(statement,parameters)
    def fetchall(self): return self.rows
class DB:
    def __init__(self, rows): self.c=Cursor(rows)
    def cursor(self): return self.c
def test_requires_full_ingredient_identity():
    assert OfficialCatalogueProvider(DB([])).find_exact_formulation(ingredients=[{'name':'x'}],dosage_form='tablet').status=='unresolved'
def test_returns_ambiguous_without_canonical_selection():
    result=OfficialCatalogueProvider(DB([({'source':'a'},),({'source':'b'},)])).find_exact_formulation(ingredients=[{'name':'x','strength_value':'1','strength_unit':'mg'}],dosage_form='tablet')
    assert result.status=='ambiguous' and len(result.evidence)==2
def test_returns_exact_evidence_only():
    db=DB([({'source':'official'},)])
    assert OfficialCatalogueProvider(db).find_exact_formulation(ingredients=[{'name':'x','strength_value':'1','strength_unit':'mg'}],dosage_form='tablet').status=='matched'
    assert 'catalogue_entities' in db.c.call[0]


def test_catalogue_query_errors_propagate_instead_of_becoming_no_match():
    class FailingCursor(Cursor):
        def execute(self, statement, parameters=()):
            raise PermissionError("missing SELECT privilege")

    class FailingDB:
        def cursor(self):
            return FailingCursor([])

    with pytest.raises(PermissionError, match="missing SELECT privilege"):
        OfficialCatalogueProvider(FailingDB()).find_exact_formulation(
            ingredients=[
                {"name": "x", "strength_value": "1", "strength_unit": "mg"}
            ],
            dosage_form="tablet",
        )

    with pytest.raises(PermissionError, match="missing SELECT privilege"):
        LocalOfficialCatalogueMedicineRepository(
            FailingDB()
        ).find_by_normalized_name("paracetamol")


def test_local_repository_returns_only_official_formulation_evidence():
    evidence={'canonical_name':'Paracetamol 500 mg Tablet','normalized_name':'paracetamol','dosage_form':'tablet','strength_value':'500','strength_unit':'mg'}
    identity={'ingredients':[{'name':'paracetamol','strength_value':'500','strength_unit':'mg'}]}
    repository=LocalOfficialCatalogueMedicineRepository(DB([('50000000-0000-4000-8000-000000000001',evidence,identity)]))
    candidate=repository.find_by_normalized_name('Paracetamol')[0]
    assert candidate.canonical_name == 'Paracetamol 500 mg Tablet'
    assert candidate.ingredients[0].strength_value == 500
    assert repository.find_by_alias('unverified-brand') == []
