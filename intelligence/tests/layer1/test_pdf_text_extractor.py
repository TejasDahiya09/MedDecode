import fitz

from app.layer1_document_processing.pdf_text_extractor import extract_searchable_pdf_text


def test_searchable_pdf_text_is_extracted_in_native_order(tmp_path):
    pdf_path = tmp_path / "searchable_prescription.pdf"
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "Tab Metformin 500 mg")
    page.insert_text((72, 100), "1-0-1 after food")
    document.save(pdf_path)
    document.close()

    result = extract_searchable_pdf_text(pdf_path)

    assert result["is_searchable"] is True
    assert result["searchable_page_count"] == 1
    assert any("Metformin" in page_result["text"] for page_result in result["pages"])
    assert any("500 mg" in page_result["text"] for page_result in result["pages"])


def test_image_only_pdf_is_flagged_without_native_text_layer(tmp_path):
    pdf_path = tmp_path / "image_only.pdf"
    document = fitz.open()
    document.new_page()
    document.save(pdf_path)
    document.close()

    result = extract_searchable_pdf_text(pdf_path)

    assert result["is_searchable"] is False
    assert result["pages"][0]["searchable"] is False
    assert any("no_native_text_layer_detected" in warning for warning in result["pages"][0]["warnings"])


def test_missing_pdf_raises_file_not_found_error(tmp_path):
    missing_path = tmp_path / "missing.pdf"

    try:
        extract_searchable_pdf_text(missing_path)
    except FileNotFoundError:
        return

    raise AssertionError("Expected FileNotFoundError")
