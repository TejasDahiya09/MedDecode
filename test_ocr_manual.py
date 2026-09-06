from PIL import Image, ImageDraw

from app.layer1_document_processing.ocr_engine import OCREngine


# Create a simple test image.
image = Image.new(
    "RGB",
    (1000, 400),
    "white",
)

draw = ImageDraw.Draw(image)

draw.text(
    (50, 80),
    "Amoxicillin 500 mg",
    fill="black",
)

draw.text(
    (50, 180),
    "Take twice daily",
    fill="black",
)


print("Creating OCR engine...")
engine = OCREngine()

print("Running OCR...")
result = engine.process_page(image)

print("\nFULL TEXT:")
print(result.full_text)

print("\nBLOCKS:")

for block in result.blocks:
    print(
        {
            "text": block.text,
            "confidence": block.confidence,
            "bounding_box": block.bounding_box,
        }
    )