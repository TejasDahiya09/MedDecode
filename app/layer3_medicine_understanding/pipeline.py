from app.layer3_medicine_understanding.instruction_parser import (
    parse_medicine_instructions,
)
from app.layer3_medicine_understanding.medicine_normaliser import (
    normalize_medicine_record,
)
from app.layer3_medicine_understanding.medicine_parser import (
    parse_medicine_entry,
)
from app.schemas.medicine import (
    MedicineUsageRecord,
)
from app.schemas.prescription import (
    RawMedicineEntry,
)


def understand_medicine_entries(
    entries: list[RawMedicineEntry],
) -> list[MedicineUsageRecord]:
    """
    Convert Layer 2 raw medicine entries into Layer 3
    structured medicine usage records.

    Layer 3 understands information explicitly present in
    the prescription but does not determine canonical
    medicine identity.
    """

    return [
        understand_medicine_entry(
            entry
        )
        for entry in entries
    ]


def understand_medicine_entry(
    entry: RawMedicineEntry,
) -> MedicineUsageRecord:
    """
    Process one Layer 2 medicine entry through the complete
    Layer 3 understanding pipeline.
    """

    medicine = parse_medicine_entry(
        entry
    )

    medicine = normalize_medicine_record(
        medicine
    )

    instruction_result = (
        parse_medicine_instructions(
            medicine.source_instructions
        )
    )

    medicine.dosage_schedule = (
        instruction_result.dosage_schedule
    )

    medicine.timing = (
        instruction_result.timing
    )

    medicine.duration = (
        instruction_result.duration
    )

    medicine.additional_instructions = (
        instruction_result.additional_instructions
    )

    return medicine