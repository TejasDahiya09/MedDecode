from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import fitz
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


@dataclass(frozen=True)
class OCRAccuracyFixture:
    identifier: str
    path: Path
    document_type: str
    expected_pages: tuple[str, ...]
    fields: dict[str, tuple[str, ...]]
    critical_pairs: tuple[tuple[str, str], ...] = ()
    unsupported_field_count: int = 0
    writing_style: str = "printed"


def build_ocr_accuracy_fixtures(output_directory: Path) -> tuple[OCRAccuracyFixture, ...]:
    output_directory.mkdir(parents=True, exist_ok=True)
    fixtures: list[OCRAccuracyFixture] = []

    def image_fixture(
        identifier: str,
        lines: tuple[str, ...],
        *,
        image_format: str = "PNG",
        width: int = 1500,
        height: int = 900,
        font_size: int = 42,
        foreground: tuple[int, int, int] = (20, 20, 20),
        background: tuple[int, int, int] = (255, 255, 255),
        writing_style: str = "printed",
        transform: str | None = None,
        fields: dict[str, tuple[str, ...]] | None = None,
        critical_pairs: tuple[tuple[str, str], ...] = (),
        unsupported_field_count: int = 0,
    ) -> OCRAccuracyFixture:
        image = _make_page(
            lines,
            width=width,
            height=height,
            font_size=font_size,
            foreground=foreground,
            background=background,
            handwriting_like=writing_style == "synthetic_handwriting_like",
        )
        if transform == "skew":
            image = image.rotate(2, expand=False, fillcolor=(255, 255, 255))
        elif transform == "blur":
            image = image.filter(ImageFilter.GaussianBlur(radius=1.2))
        elif transform == "uneven_lighting":
            image = _apply_lighting_gradient(image)

        suffix = ".jpg" if image_format == "JPEG" else ".png"
        path = output_directory / f"{identifier}{suffix}"
        if transform == "low_contrast":
            image = ImageEnhance.Contrast(image).enhance(0.35)
            image = ImageEnhance.Brightness(image).enhance(0.95)
        if image_format == "JPEG":
            image.save(path, format=image_format, quality=88, optimize=True)
        else:
            image.save(path, format=image_format)
        if transform == "exif_rotation":
            image = image.rotate(90, expand=True, fillcolor=(255, 255, 255))
            exif = image.getexif()
            exif[274] = 6
            image.save(path, format="JPEG", quality=88, exif=exif)
        transcription = "\n".join(lines)
        fixtures.append(
            OCRAccuracyFixture(
                identifier=identifier,
                path=path,
                document_type="image",
                expected_pages=(transcription,),
                fields=fields or {},
                critical_pairs=critical_pairs,
                unsupported_field_count=unsupported_field_count,
                writing_style=writing_style,
            )
        )
        return fixtures[-1]

    clean_text = (
        "Tab FictionalMedA 0.5 mg",
        "1-0-1 after food for 5 days",
        "Cap FictionalMedB 500 mcg",
        "0-0-1 khane ke baad for 7 days",
    )
    image_fixture(
        "clean_print_two_medicines",
        clean_text,
        fields={
            "medicine_names": ("FictionalMedA", "FictionalMedB"),
            "strengths": ("0.5 mg", "500 mcg"),
            "units": ("mg", "mcg"),
            "frequencies": ("1-0-1", "0-0-1"),
            "timings": ("after food", "khane ke baad"),
            "durations": ("5 days", "7 days"),
        },
    )

    image_fixture(
        "typed_three_medicines",
        (
            "1. Tab FictionalA 10 mg OD x 3 days",
            "2. Cap FictionalB 250 mg BD x 5 days",
            "3. Syr FictionalC 5 ml TDS x 7 days",
        ),
        fields={
            "medicine_names": ("FictionalA", "FictionalB", "FictionalC"),
            "strengths": ("10 mg", "250 mg", "5 ml"),
            "units": ("mg", "mg", "ml"),
            "frequencies": ("OD", "BD", "TDS"),
            "durations": ("3 days", "5 days", "7 days"),
        },
    )

    image_fixture(
        "low_contrast_print",
        ("Tab FictionalContrast 25 mg", "1-1-1 after food for 5 days"),
        foreground=(95, 95, 95),
        background=(225, 225, 225),
        transform="low_contrast",
        fields={
            "medicine_names": ("FictionalContrast",),
            "strengths": ("25 mg",),
            "units": ("mg",),
            "frequencies": ("1-1-1",),
            "timings": ("after food",),
            "durations": ("5 days",),
        },
    )

    image_fixture(
        "slight_skew_print",
        ("Tab FictionalSkew 12.5 mg", "0-1-0 after food for 10 days"),
        transform="skew",
        fields={
            "medicine_names": ("FictionalSkew",),
            "strengths": ("12.5 mg",),
            "units": ("mg",),
            "frequencies": ("0-1-0",),
            "timings": ("after food",),
            "durations": ("10 days",),
        },
    )

    image_fixture(
        "uneven_lighting_photo",
        ("Tab FictionalPhoto 5 mg", "1-0-0 before food for 3 days"),
        image_format="JPEG",
        transform="uneven_lighting",
        fields={
            "medicine_names": ("FictionalPhoto",),
            "strengths": ("5 mg",),
            "units": ("mg",),
            "frequencies": ("1-0-0",),
            "timings": ("before food",),
            "durations": ("3 days",),
        },
    )

    image_fixture(
        "small_print_png",
        ("Tab FictionalSmall 0.25 mg", "1/2 tablet at night for 15 days"),
        font_size=26,
        width=1100,
        height=650,
        fields={
            "medicine_names": ("FictionalSmall",),
            "strengths": ("0.25 mg",),
            "units": ("mg",),
            "frequencies": ("1/2 tablet",),
            "durations": ("15 days",),
        },
    )

    image_fixture(
        "synthetic_handwriting_like",
        ("Tab FictionalScript 20 mg", "1-0-1 khane ke baad for 5 days"),
        writing_style="synthetic_handwriting_like",
        fields={
            "medicine_names": ("FictionalScript",),
            "strengths": ("20 mg",),
            "units": ("mg",),
            "frequencies": ("1-0-1",),
            "timings": ("khane ke baad",),
            "durations": ("5 days",),
        },
    )

    image_fixture(
        "romanized_hindi_combination",
        ("Tab FictionalCombo 5 mg + 50 mg", "1-0-1 khane se pehle x 3 days"),
        fields={
            "medicine_names": ("FictionalCombo",),
            "strengths": ("5 mg + 50 mg",),
            "units": ("mg", "mg"),
            "frequencies": ("1-0-1",),
            "timings": ("khane se pehle",),
            "durations": ("3 days",),
        },
    )

    image_fixture(
        "blurred_print",
        ("Tab FictionalBlur 8 mg", "0-0-1 for 4 days"),
        transform="blur",
        fields={
            "medicine_names": ("FictionalBlur",),
            "strengths": ("8 mg",),
            "units": ("mg",),
            "frequencies": ("0-0-1",),
            "durations": ("4 days",),
        },
    )

    image_fixture(
        "exif_rotated_jpeg",
        ("Tab FictionalRotate 2 mg", "1-0-1 for 6 days"),
        image_format="JPEG",
        transform="exif_rotation",
        fields={
            "medicine_names": ("FictionalRotate",),
            "strengths": ("2 mg",),
            "units": ("mg",),
            "frequencies": ("1-0-1",),
            "durations": ("6 days",),
        },
    )

    adversarial_lines = (
        "FictionalA 0.5 mg",
        "FictionalB 5 mg",
        "FictionalC 0.25 mg",
        "FictionalD 25 mg",
        "FictionalE 500 mg",
        "FictionalF 500 mcg",
        "FictionalG 1-0-1",
        "FictionalH 1-1-1",
        "FictionalI OD",
        "FictionalJ BD",
        "FictionalK for 5 days",
        "FictionalL for 15 days",
        "FictionalM 1/2 tablet",
        "FictionalN 2 tablets",
    )
    adversarial_pairs = (
        ("0.5 mg", "5 mg"),
        ("0.25 mg", "25 mg"),
        ("500 mg", "500 mcg"),
        ("1-0-1", "1-1-1"),
        ("OD", "BD"),
        ("5 days", "15 days"),
        ("1/2 tablet", "2 tablets"),
    )
    image_fixture(
        "numeric_adversarial_sheet",
        adversarial_lines,
        font_size=34,
        height=1500,
        fields={
            "strengths": ("0.5 mg", "5 mg", "0.25 mg", "25 mg", "500 mg", "500 mcg"),
            "units": ("mg", "mg", "mg", "mg", "mg", "mcg"),
            "frequencies": ("1-0-1", "1-1-1", "OD", "BD", "1/2 tablet", "2 tablets"),
            "durations": ("5 days", "15 days"),
        },
        critical_pairs=adversarial_pairs,
        unsupported_field_count=2,
    )

    handwriting_page = _make_page(
        ("Tab FictionalScan 0.5 mg", "1-0-1 after food for 5 days"),
        width=1200,
        height=900,
        font_size=40,
    )
    second_scan_page = _make_page(
        ("Cap FictionalScanB 500 mcg", "0-0-1 for 7 days"),
        width=1200,
        height=900,
        font_size=40,
    )
    fixtures.append(
        _create_scanned_pdf(
            output_directory / "two_page_scanned.pdf",
            "two_page_scanned_pdf",
            (handwriting_page, second_scan_page),
            (
                "Tab FictionalScan 0.5 mg\n1-0-1 after food for 5 days",
                "Cap FictionalScanB 500 mcg\n0-0-1 for 7 days",
            ),
            {
                "medicine_names": ("FictionalScan", "FictionalScanB"),
                "strengths": ("0.5 mg", "500 mcg"),
                "units": ("mg", "mcg"),
                "frequencies": ("1-0-1", "0-0-1"),
                "timings": ("after food",),
                "durations": ("5 days", "7 days"),
            },
        )
    )

    fixtures.append(
        _create_searchable_pdf(
            output_directory / "two_page_searchable.pdf",
            "two_page_searchable_pdf",
            (
                ("Tab FictionalNativeA 0.5 mg", "1-0-1 after food for 5 days"),
                ("Cap FictionalNativeB 500 mcg", "0-0-1 for 7 days"),
            ),
            {
                "medicine_names": ("FictionalNativeA", "FictionalNativeB"),
                "strengths": ("0.5 mg", "500 mcg"),
                "units": ("mg", "mcg"),
                "frequencies": ("1-0-1", "0-0-1"),
                "timings": ("after food",),
                "durations": ("5 days", "7 days"),
            },
        )
    )

    fixtures.append(
        _create_mixed_pdf(
            output_directory / "mixed_two_page.pdf",
            "mixed_two_page_pdf",
            ("Tab FictionalMixedNative 25 mg", "1-0-1 for 3 days"),
            (_make_page(("Tab FictionalMixedScan 0.25 mg", "1/2 tablet for 5 days"), width=1200, height=900, font_size=40),),
            {
                "medicine_names": ("FictionalMixedNative", "FictionalMixedScan"),
                "strengths": ("25 mg", "0.25 mg"),
                "units": ("mg", "mg"),
                "frequencies": ("1-0-1", "1/2 tablet"),
                "durations": ("3 days", "5 days"),
            },
        )
    )
    return tuple(fixtures)


def _font(size: int, handwriting_like: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    windows = Path("C:/Windows/Fonts")
    candidates = (
        [windows / "segoepr.ttf", windows / "arial.ttf"]
        if handwriting_like
        else [windows / "arial.ttf", windows / "calibri.ttf"]
    )
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def _make_page(
    lines: tuple[str, ...],
    *,
    width: int,
    height: int,
    font_size: int,
    foreground: tuple[int, int, int] = (20, 20, 20),
    background: tuple[int, int, int] = (255, 255, 255),
    handwriting_like: bool = False,
) -> Image.Image:
    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)
    font = _font(font_size, handwriting_like=handwriting_like)
    line_height = font_size + max(20, font_size // 2)
    for index, line in enumerate(lines):
        draw.text((70, 70 + index * line_height), line, fill=foreground, font=font)
    return image


def _apply_lighting_gradient(image: Image.Image) -> Image.Image:
    pixels = np.asarray(image, dtype=np.float32).copy()
    gradient = np.linspace(0.72, 1.0, image.width, dtype=np.float32)[None, :, None]
    return Image.fromarray(np.clip(pixels * gradient, 0, 255).astype(np.uint8), mode="RGB")


def _image_bytes(image: Image.Image) -> bytes:
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def _create_scanned_pdf(
    path: Path,
    identifier: str,
    images: tuple[Image.Image, ...],
    expected_pages: tuple[str, ...],
    fields: dict[str, tuple[str, ...]],
) -> OCRAccuracyFixture:
    document = fitz.open()
    for image in images:
        page = document.new_page(width=612, height=792)
        page.insert_image(page.rect, stream=_image_bytes(image))
    document.save(path)
    document.close()
    return OCRAccuracyFixture(identifier, path, "scanned_pdf", expected_pages, fields)


def _create_searchable_pdf(
    path: Path,
    identifier: str,
    page_lines: tuple[tuple[str, ...], ...],
    fields: dict[str, tuple[str, ...]],
) -> OCRAccuracyFixture:
    document = fitz.open()
    for lines in page_lines:
        page = document.new_page(width=612, height=792)
        for index, line in enumerate(lines):
            page.insert_text((55, 80 + index * 28), line, fontsize=16)
    document.save(path)
    document.close()
    return OCRAccuracyFixture(
        identifier,
        path,
        "searchable_pdf",
        tuple("\n".join(lines) for lines in page_lines),
        fields,
    )


def _create_mixed_pdf(
    path: Path,
    identifier: str,
    native_page_lines: tuple[str, ...],
    scanned_images: tuple[Image.Image, ...],
    fields: dict[str, tuple[str, ...]],
) -> OCRAccuracyFixture:
    document = fitz.open()
    page = document.new_page(width=612, height=792)
    for index, line in enumerate(native_page_lines):
        page.insert_text((55, 80 + index * 28), line, fontsize=16)
    expected = ["\n".join(native_page_lines)]
    for image in scanned_images:
        page = document.new_page(width=612, height=792)
        page.insert_image(page.rect, stream=_image_bytes(image))
        expected.append("Tab FictionalMixedScan 0.25 mg\n1/2 tablet for 5 days")
    document.save(path)
    document.close()
    return OCRAccuracyFixture(identifier, path, "mixed_pdf", tuple(expected), fields)
