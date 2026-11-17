from __future__ import annotations

from dataclasses import dataclass

from app.schemas.ocr import OCRBlock, OCRPageResult


@dataclass(frozen=True)
class ExpectedMedicine:
    raw_text: str
    instructions: tuple[str, ...]
    strength_value: float
    strength_unit: str
    schedule: str | None
    duration_days: float | None
    ambiguous_instruction: str | None = None


@dataclass(frozen=True)
class FictionalPrescription:
    page: OCRPageResult
    medicines: tuple[ExpectedMedicine, ...]
    adversarial: bool


def build_fictional_prescriptions() -> list[FictionalPrescription]:
    """Build 30 deterministic, fictional OCR prescriptions with 100 entries."""
    prescriptions: list[FictionalPrescription] = []
    for prescription_number in range(30):
        variant = prescription_number % 10
        medicine_count = (2, 3, 5)[prescription_number % 3]
        blocks: list[OCRBlock] = []
        expected: list[ExpectedMedicine] = []
        top = 40.0
        adversarial = variant in {2, 5, 6, 7, 9}

        for medicine_number in range(medicine_count):
            name = f"Fictionalmed{prescription_number:02d}{medicine_number}"
            strength_value, strength_unit = (
                (2.5, "mg") if variant == 9 and medicine_number == 0
                else (500.0, "mcg") if variant == 9 and medicine_number == 1
                else (10.0 + medicine_number, "mg")
            )
            strength_text = f"{strength_value:g} {strength_unit}"
            form = "Cap" if medicine_number % 2 else "Tab"
            medicine_text = f"{form} {name} {strength_text}"

            if variant == 9 and medicine_number == 0:
                medicine_text += " + Fictionalcomponent 125 mcg"
            if variant == 2:
                medicine_text = f"{medicine_number + 1}. {medicine_text}"

            expected_medicine_text = (
                medicine_text.split(". ", 1)[1]
                if variant == 2
                else medicine_text
            )
            schedule = ("1-0-1", "0-0-1", "1-1-1", "0.5-0-0.5")[
                medicine_number % 4
            ]
            timing = (
                "khane ke baad" if medicine_number % 2
                else "AC" if variant == 8
                else "after food"
            )
            duration_days = float(3 + medicine_number)
            instruction = f"{schedule} {timing} for {duration_days:g} days"
            if variant == 4 and medicine_number == 1:
                instruction = f"{timing} for {duration_days:g} days"
            elif variant == 4 and medicine_number == 2:
                instruction = f"{schedule} {timing}"
            elif variant == 4 and medicine_number == 3:
                instruction = schedule
            instructions = [instruction]
            ambiguous_instruction = None
            if variant == 1 and medicine_number == 0:
                medicine_text = f"{form} {name}"
                _add_block(blocks, medicine_text, 20, top)
                _add_block(blocks, strength_text, 20, top + 24)
                medicine_text = f"{form} {name} {strength_text}"
                top += 24
            elif variant == 3:
                _add_block(blocks, f"{medicine_text} {instruction}", 20, top)
                instructions = [instruction]
            else:
                _add_block(blocks, medicine_text, 20, top)
                if variant == 5 and medicine_number == 0:
                    _add_block(blocks, medicine_text, 20, top)

            if variant == 3:
                pass
            elif variant == 4 and medicine_number == 0:
                instructions = []
            elif variant == 6 and medicine_number == 0:
                ambiguous_instruction = instruction
                instructions = []
                _add_block(blocks, instruction, 360, top + 24)
            elif variant == 7 and medicine_number == 0:
                conflicting = f"0-0-1 before food for {duration_days:g} days"
                instructions.append(conflicting)
                _add_block(blocks, instruction, 20, top + 24)
                _add_block(blocks, conflicting, 20, top + 48)
            elif instructions:
                _add_block(blocks, instruction, 20, top + 24)

            if variant == 3:
                schedule_value = schedule
            elif variant == 6 and medicine_number == 0:
                schedule_value = None
            elif variant == 7 and medicine_number == 0:
                schedule_value = None
            elif variant == 4 and medicine_number == 1:
                schedule_value = None
            elif not instructions:
                schedule_value = None
            else:
                schedule_value = schedule

            expected.append(
                ExpectedMedicine(
                    raw_text=expected_medicine_text,
                    instructions=tuple(instructions),
                    strength_value=strength_value,
                    strength_unit=strength_unit,
                    schedule=schedule_value,
                    duration_days=(
                        duration_days
                        if instructions and "days" in instruction
                        else None
                    ),
                    ambiguous_instruction=ambiguous_instruction,
                )
            )
            top += 80

        if prescription_number % 10 == 8:
            blocks.reverse()
        prescriptions.append(
            FictionalPrescription(
                page=OCRPageResult(
                    full_text="\n".join(block.text for block in blocks),
                    blocks=blocks,
                ),
                medicines=tuple(expected),
                adversarial=adversarial,
            )
        )
    return prescriptions


def _add_block(
    blocks: list[OCRBlock],
    text: str,
    left: float,
    top: float,
) -> None:
    blocks.append(
        OCRBlock(
            text=text,
            confidence=0.99,
            bounding_box=[
                [left, top],
                [left + 420, top],
                [left + 420, top + 18],
                [left, top + 18],
            ],
        )
    )
