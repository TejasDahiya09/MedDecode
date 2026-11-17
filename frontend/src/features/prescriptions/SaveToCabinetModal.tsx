import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Badge, Button } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import { addMedicineCabinetEntry, type CabinetFields } from '../cabinet/medicine-cabinet-api';
import type { ContractV1MedicineItem } from './prescription-api';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SaveToCabinetModalProps {
  readonly medicine: ContractV1MedicineItem;
  readonly prescriptionId: string;
  readonly onClose: () => void;
}

export function SaveToCabinetModal({ medicine, prescriptionId, onClose }: SaveToCabinetModalProps) {
  const auth = useAuth();
  const token = auth.getAccessToken() ?? '';
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const medicineName = medicine.extraction.medicine_name || medicine.medicine_match.brand_name || 'Extracted Medicine';
  const matchedId = medicine.medicine_match.medicine_external_id;
  const hasValidCatalogueId = Boolean(
    medicine.medicine_match.status === 'matched' && matchedId && UUID_PATTERN.test(matchedId),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }

    return () => {
      if (typeof dialog.close === 'function') {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute('open');
        }
      } else {
        dialog.removeAttribute('open');
      }
    };
  }, []);

  const [quantity, setQuantity] = useState<string>(
    medicine.extraction.quantity?.value != null ? String(medicine.extraction.quantity.value) : '',
  );
  const [usageInfo, setUsageInfo] = useState<string>(
    [
      medicine.extraction.dosage_form,
      medicine.extraction.timing,
      medicine.extraction.instructions,
    ]
      .filter(Boolean)
      .join(' · '),
  );
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState<string>('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || !hasValidCatalogueId || !matchedId || busy) return;

    setBusy(true);
    setError(null);

    const fields: CabinetFields = {
      quantity: quantity.trim() ? quantity.trim() : null,
      usage_information: usageInfo.trim() ? usageInfo.trim() : null,
      expiry_date: expiryDate.trim() ? expiryDate.trim() : null,
      purchase_date: purchaseDate.trim() ? purchaseDate.trim() : null,
      refill_date: null,
    };

    try {
      await addMedicineCabinetEntry(matchedId, fields, token);
      setSuccess(true);
    } catch (cause: unknown) {
      if (cause instanceof ApiError) {
        if (cause.status === 400) {
          setError('Please check the quantity and dates, then try again.');
        } else if (cause.status === 404) {
          setError('The catalogue reference could not be found by the cabinet service.');
        } else if (cause.status === 409) {
          setError('This medicine is already recorded in your cabinet.');
        } else {
          setError(`Unable to save to Medicine Cabinet (${cause.status ?? 'service error'}).`);
        }
      } else {
        setError('Failed to connect to the medicine cabinet service.');
      }
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      role="dialog"
      className="md-compare-dialog cc-modal"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="md-compare-dialog-head">
        <div>
          <h2 id={titleId} className="cc-section-title">
            Save to Medicine Cabinet
          </h2>
          <p className="text-xs text-[var(--cc-muted)] mt-0.5">
            Add extracted prescription medication to your personal tracker.
          </p>
        </div>
        <button
          type="button"
          className="cc-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" className="size-5" />
        </button>
      </header>

      <div className="md-compare-dialog-content space-y-4">
        {/* Source reference banner */}
        <div className="p-3 rounded-lg bg-[var(--cc-panel-muted)] border border-[var(--cc-border)] text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--cc-text)]">{medicineName}</span>
            <Badge tone={hasValidCatalogueId ? 'success' : 'neutral'}>
              {hasValidCatalogueId ? 'Verified Catalogue Item' : 'Unmatched to Catalogue'}
            </Badge>
          </div>
          <p className="text-[var(--cc-muted)]">Prescription Ref: <code>{prescriptionId}</code></p>
        </div>

        {success ? (
          <div className="p-6 text-center space-y-4">
            <span className="size-12 rounded-full bg-[var(--cc-success-soft)] text-[var(--cc-success)] flex items-center justify-center mx-auto">
              <Icon name="check" className="size-6" />
            </span>
            <div>
              <h3 className="text-base font-bold text-[var(--cc-text)]">Saved to Medicine Cabinet</h3>
              <p className="text-xs text-[var(--cc-muted)] mt-1">
                {medicineName} has been recorded in your personal cabinet.
              </p>
            </div>
            <div className="flex justify-center gap-3 pt-2">
              <Link to="/my-cabinet" className="cc-button cc-button--primary">
                View in My Cabinet
              </Link>
              <Button variant="secondary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : !hasValidCatalogueId ? (
          /* Honest guidance when catalogue UUID is unavailable */
          <div className="space-y-4 py-2">
            <div className="p-4 rounded-xl border border-[var(--cc-warning)]/40 bg-[var(--cc-warning-soft)]/20 text-xs text-[var(--cc-text-soft)] space-y-2">
              <p className="font-semibold text-[var(--cc-warning)]">
                Catalogue Association Required
              </p>
              <p>
                Saving a prescription medicine requires a verified mapping to the cabinet's medicine reference. That mapping is not available yet; you can add a supported medicine manually in Cabinet.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link
                to={`/medicine-library?q=${encodeURIComponent(medicineName)}`}
                className="cc-button cc-button--primary text-xs"
              >
                Search in Medicine Library
              </Link>
              <Link to="/my-cabinet" className="cc-button cc-button--secondary text-xs">
                Add manually in Cabinet
              </Link>
              <Button variant="ghost" onClick={onClose} className="text-xs">
                Close
              </Button>
            </div>
          </div>
        ) : (
          /* Editable Cabinet Form */
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="text-xs font-semibold text-[var(--cc-text)] block mb-1">
                Usage Instructions
              </label>
              <input
                type="text"
                maxLength={100}
                value={usageInfo}
                onChange={(e) => setUsageInfo(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-[var(--cc-border)] bg-[var(--cc-panel-muted)] text-[var(--cc-text)]"
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="text-xs font-semibold text-[var(--cc-text)] block mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  max="9999"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-[var(--cc-border)] bg-[var(--cc-panel-muted)] text-[var(--cc-text)]"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--cc-text)] block mb-1">
                  Purchase Date
                </label>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-[var(--cc-border)] bg-[var(--cc-panel-muted)] text-[var(--cc-text)]"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--cc-text)] block mb-1">
                  Expiry Date
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-[var(--cc-border)] bg-[var(--cc-panel-muted)] text-[var(--cc-text)]"
                />
              </div>
            </div>

            {error ? (
              <div role="alert" className="p-2.5 rounded-lg border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 text-xs text-[var(--cc-danger)]">
                {error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2.5 pt-3 border-t border-[var(--cc-border)]">
              <Button variant="secondary" onClick={onClose} type="button" disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Save to Cabinet
              </Button>
            </div>
          </form>
        )}
      </div>
    </dialog>,
    document.querySelector('.cc-app-shell') ?? document.body,
  );
}
