import React, { useState, useEffect } from 'react';
import type { DocumentPreviewData, SourceCoordinateHighlight } from './types';

interface PrescriptionDocumentPreviewProps {
  preview: DocumentPreviewData | null;
  activeHighlight?: SourceCoordinateHighlight | null;
  activeMedicineName?: string | null;
  loading?: boolean;
}

function isSafePreviewUrl(url?: string): boolean {
  if (!url) return false;
  if (url.startsWith('blob:')) return true;
  if (
    url.startsWith('data:image/svg+xml') ||
    url.startsWith('data:image/png') ||
    url.startsWith('data:image/jpeg')
  ) {
    return true;
  }
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url, window.location.origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === window.location.origin
    );
  } catch {
    return false;
  }
}

function isValidHighlightCoordinate(highlight?: SourceCoordinateHighlight | null): boolean {
  if (!highlight) return false;
  const { x, y, width, height, pageNumber } = highlight;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return false;
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return false;
  if (x + width > 100.5 || y + height > 100.5) return false;
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return false;
  return true;
}

export const PrescriptionDocumentPreview: React.FC<PrescriptionDocumentPreviewProps> = ({
  preview,
  activeHighlight,
  activeMedicineName,
  loading = false,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [documentError, setDocumentError] = useState<string | null>(null);

  // Revoke object URL on unmount if requested
  useEffect(() => {
    return () => {
      if (preview?.revokeOnUnmount && preview.url?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(preview.url);
        } catch {
          // ignore
        }
      }
    };
  }, [preview]);

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 0.25, 0.5));
  const handleZoomReset = () => {
    setZoomLevel(1);
    setRotationDegrees(0);
    setDocumentError(null);
  };
  const handleRotate = () => setRotationDegrees((prev) => (prev + 90) % 360);

  const totalPages = preview?.totalPages || 1;
  const handlePrevPage = () => setCurrentPage((prev) => Math.max(prev - 1, 1));
  const handleNextPage = () => setCurrentPage((prev) => Math.min(prev + 1, totalPages));

  if (loading) {
    return (
      <div className="review-preview-panel loading" aria-busy="true" aria-label="Loading prescription document preview">
        <div className="review-preview-skeleton">
          <div className="preview-spinner" />
          <p>Loading prescription document preview...</p>
        </div>
      </div>
    );
  }

  if (!preview || !preview.available) {
    return (
      <div className="review-preview-panel unavailable" role="region" aria-label="Document preview unavailable">
        <div className="preview-fallback-card">
          <div className="preview-fallback-icon" aria-hidden="true">📄</div>
          <h3 className="preview-fallback-title">Document Preview Unavailable</h3>
          <p className="preview-fallback-text">
            {preview?.message ||
              'The original document preview is currently unavailable or storage access is restricted.'}
          </p>
          <div className="preview-fallback-hint">
            You can still review, edit and verify the structured medicine information in the panel on the right.
          </div>
        </div>
      </div>
    );
  }

  const isPdf =
    preview.fileType === 'application/pdf' ||
    Boolean(preview.fileName?.toLowerCase().endsWith('.pdf'));

  const urlIsSafe = isSafePreviewUrl(preview.url);
  const hasValidHighlight = isValidHighlightCoordinate(activeHighlight);
  const showHighlight = hasValidHighlight && activeHighlight?.pageNumber === currentPage;

  return (
    <section className="review-preview-panel" aria-label="Original prescription document preview">
      <div className="preview-toolbar" role="toolbar" aria-label="Preview controls">
        <div className="preview-metadata-info">
          {preview.isDemoMock && (
            <span className="demo-preview-pill" title="Fictional document sample">
              DEMO SAMPLE
            </span>
          )}
          <span className="preview-file-name" title={preview.fileName || 'Prescription Scan'}>
            {preview.fileName || 'Prescription Scan'}
          </span>
          {preview.fileType && (
            <span className="preview-badge">
              {isPdf ? 'PDF' : preview.fileType.includes('png') ? 'PNG' : 'IMAGE'}
            </span>
          )}
          {totalPages > 1 && (
            <span className="preview-page-indicator">
              Page {currentPage} of {totalPages}
            </span>
          )}
        </div>

        <div className="preview-control-group">
          {totalPages > 1 && (
            <>
              <button
                type="button"
                className="preview-btn"
                onClick={handlePrevPage}
                disabled={currentPage <= 1}
                aria-label="Previous page"
              >
                ◀ Prev
              </button>
              <button
                type="button"
                className="preview-btn"
                onClick={handleNextPage}
                disabled={currentPage >= totalPages}
                aria-label="Next page"
              >
                Next ▶
              </button>
            </>
          )}

          <button
            type="button"
            className="preview-btn"
            onClick={handleZoomOut}
            disabled={zoomLevel <= 0.5}
            aria-label="Zoom out"
            title="Zoom out"
          >
            －
          </button>
          <span className="zoom-percentage" aria-label={`Zoom level ${Math.round(zoomLevel * 100)} percent`}>
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            className="preview-btn"
            onClick={handleZoomIn}
            disabled={zoomLevel >= 3}
            aria-label="Zoom in"
            title="Zoom in"
          >
            ＋
          </button>
          <button
            type="button"
            className="preview-btn"
            onClick={handleRotate}
            aria-label="Rotate document 90 degrees"
            title="Rotate 90°"
          >
            ↻
          </button>
          <button
            type="button"
            className="preview-btn text-btn"
            onClick={handleZoomReset}
            aria-label="Reset zoom and rotation"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Coordinate status notice if active item lacks valid evidence coordinates */}
      {activeMedicineName && !hasValidHighlight && (
        <div className="preview-coords-notice" role="note" aria-live="polite">
          <span className="coords-icon" aria-hidden="true">ℹ️</span>
          <span>Source OCR bounding box coordinates unavailable for &quot;{activeMedicineName}&quot;.</span>
        </div>
      )}

      <div className="preview-viewport-scroll" tabIndex={0} aria-label="Prescription document canvas">
        <div
          className="preview-canvas-wrapper"
          style={{
            transform: `scale(${zoomLevel}) rotate(${rotationDegrees}deg)`,
            transformOrigin: 'top center',
            transition: 'transform 0.15s ease-out',
          }}
        >
          {documentError ? (
            <div className="preview-error-state" role="alert">
              <span className="error-icon" aria-hidden="true">⚠️</span>
              <p className="error-message">{documentError}</p>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setDocumentError(null)}
              >
                Retry View
              </button>
            </div>
          ) : !urlIsSafe ? (
            <div className="preview-error-state" role="alert">
              <span className="error-icon" aria-hidden="true">🛡️</span>
              <p className="error-message">The document preview URL is invalid or uses an untrusted origin.</p>
            </div>
          ) : preview.url ? (
            <div className="preview-image-container">
              {isPdf ? (
                <iframe
                  src={preview.url}
                  title={`Prescription document PDF preview for ${preview.fileName || 'Prescription'}`}
                  className="preview-document-frame"
                  sandbox="allow-scripts allow-same-origin"
                  onError={() => setDocumentError('Failed to load the prescription PDF document.')}
                />
              ) : (
                <img
                  src={preview.url}
                  alt={`Original prescription scan for ${preview.fileName || 'Prescription'}`}
                  className="preview-document-img"
                  onError={() => setDocumentError('Failed to load the prescription document image.')}
                />
              )}

              {/* Source highlight overlay if active and coordinates verified */}
              {showHighlight && activeHighlight && (
                <div
                  className="preview-highlight-box"
                  style={{
                    left: `${activeHighlight.x}%`,
                    top: `${activeHighlight.y}%`,
                    width: `${activeHighlight.width}%`,
                    height: `${activeHighlight.height}%`,
                  }}
                  role="note"
                  aria-label={`Source OCR region for ${activeMedicineName || 'selected medicine'}`}
                >
                  <span className="highlight-tag">{activeMedicineName || 'Selected Item'}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="preview-placeholder-doc">
              <div className="doc-page-representation">
                <h4>[Prescription Document Preview]</h4>
                <p><strong>File:</strong> {preview.fileName || 'Prescription'}</p>
                {preview.message && (
                  <div className="doc-raw-text">
                    <p><strong>Transcribed Source:</strong></p>
                    <pre>{preview.message}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {preview.message && (
        <div className="preview-footer-provenance">
          <span className="provenance-title">Transcribed source: </span>
          <span className="provenance-body">{preview.message}</span>
        </div>
      )}
    </section>
  );
};
