# OCR provider inventory

| Provider | Implementation and role | FastAPI | Audit evidence / limits |
|---|---|---|---|
| EasyOCR | `app/layer1_document_processing/hybrid_ocr.py:EasyOCRProvider`, whole page, English default, local assets, download disabled | Sole configured whole-page provider | Installed 1.7.2; tests passed. Earlier real PDF/JPEG/PNG evidence exists in `docs/integration-demo-status.md`; not rerun here. Quality or handwriting suitability not established. |
| PaddleOCR | `ocr_engine.py:OCREngine`, `hybrid_ocr.py:PaddleOCRProvider`; local whole-page alternative | Not configured | Installed 3.7.0/PaddlePaddle 3.2.2; initialization and real document inference not tested this audit. Legacy docs report Windows runtime failure; may be stale. |
| TrOCR | `hybrid_ocr.py:TrOCRHandwrittenProvider`; detected line-region recognizer, local-only transformers assets | Not configured | transformers unavailable; local model/assets and real handwriting inference unverified. No handwriting detector established. |
| AWS Textract | `hybrid_ocr.py:AwsTextractProvider`, optional explicit cloud page adapter | Not configured | boto3 unavailable; cloud calls neither authorized nor performed. Fake-transport tests do not establish real service access. |
| Google Cloud Vision | `google_vision_provider.py:GoogleVisionProvider` plus separate same-named implementation in `hybrid_ocr.py` | Not configured | Optional cloud, fake-transport tests; installed state and real calls unverified. Both are implementations of one service, not independent OCR engines. |

Five provider categories are implemented in source, but they do not constitute five active or verified mechanisms. No authoritative original design specifying exactly five independent providers was located in inspected docs. Only EasyOCR is wired into FastAPI. Optional local worker has separate explicit provider selection; that does not make providers available in the HTTP path. CPU torch is installed; hardware/GPU, model memory, model licenses, language coverage beyond configured English, initialization and running latency were not measured here.

Fixtures exist: `C:/Users/dahiy/MedDecode-Test-Fixtures/synthetic-prescription-001.{pdf,jpg,png}` and `synthetic-prescription-002.pdf`. No annotated handwriting, low-light, rotation or ground truth dataset was verified; accuracy, CER/WER and entity precision/recall cannot be calculated from the evidence collected. Do not transmit prescriptions to cloud OCR without a separate privacy and authorization decision.
