import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, SectionHeader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import { isPrescriptionAutoSubmitEnabled, uploadPrescription, type PrescriptionUploadResult } from '../prescriptions/prescription-upload';
import { medicines } from './demo-data';
import { fileSizeLabel, fileTypeLabel, validateUploadSelection } from './upload-file';
import './upload.css';

export function UploadPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sample, setSample] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [uploadError, setUploadError] = useState('');
  const [uploadResult, setUploadResult] = useState<PrescriptionUploadResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const sampleButton = useRef<HTMLButtonElement>(null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const nextFocus = useRef<'browse' | 'replace' | 'sample' | 'results' | null>(null);
  const dragDepth = useRef(0);
  const uploadPending = useRef(false);
  const id = useId();
  const helpId = `${id}-help`, errorId = `${id}-error`, sampleId = `${id}-sample`, descriptionId = `${id}-description`;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useLayoutEffect(() => {
    const destination = nextFocus.current;
    nextFocus.current = null;
    if (!destination) return;
    const frame = requestAnimationFrame(() => {
      const element = { browse: browseButton, replace: replaceButton, sample: sampleButton, results: resultTitle }[destination].current;
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: destination === 'results' ? 'start' : 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [file, sample, error, selectionRevision]);

  function resetUpload() { setUploadState('idle'); setUploadError(''); setUploadResult(null); }
  function select(next?: File, count = 1) {
    if (!next || uploadPending.current) return;
    const message = validateUploadSelection(next, count);
    setSelectionRevision(revision => revision + 1);
    nextFocus.current = message ? (file ? 'replace' : 'browse') : 'replace';
    setSample(false); setError(message); resetUpload();
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (message) { setAnnouncement(''); return; }
    setFile(next);
    if (next.type.startsWith('image/')) {
      try {
        setPreviewUrl(URL.createObjectURL(next));
      } catch {
        setPreviewUrl(null);
      }
    }
    setAnnouncement(`${next.name} selected locally. ${fileTypeLabel(next.name)}, ${fileSizeLabel(next.size)}. Ready to upload.`);
  }
  function browse(event: ChangeEvent<HTMLInputElement>) { select(event.target.files?.[0], event.target.files?.length); event.target.value = ''; }
  function drop(event: DragEvent) {
    event.preventDefault(); dragDepth.current = 0; setDragging(false);
    if (!uploadPending.current) select(event.dataTransfer.files[0], event.dataTransfer.files.length);
  }
  function remove() {
    if (uploadPending.current) return;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    nextFocus.current = 'browse'; setFile(null); setError(''); setSample(false); resetUpload();
    setAnnouncement('File removed. Choose another file or explore the fictional sample.');
    if (input.current) input.current.value = '';
  }
  function openSample() {
    setAnnouncement('Predefined fictional sample opened. Your selected document has not been processed.');
    if (sample) { resultTitle.current?.focus(); resultTitle.current?.scrollIntoView({ block: 'start' }); }
    else { nextFocus.current = 'results'; setSample(true); }
  }
  function closeSample(backToFile = false) {
    nextFocus.current = backToFile ? (file ? 'replace' : 'browse') : 'sample';
    setSample(false); setAnnouncement('Sample closed. No document was processed.');
  }
  async function submitUpload() {
    if (!file || uploadPending.current) return;
    const accessToken = auth.getAccessToken();
    if (!accessToken) {
      setUploadState('error'); setUploadError('Your session is no longer available. Sign in again before uploading.');
      return;
    }
    uploadPending.current = true;
    setUploadState('uploading'); setUploadError(''); setUploadResult(null); setAnnouncement('Uploading prescription securely.');
    try {
      const autoSubmit = isPrescriptionAutoSubmitEnabled();
      const result = await uploadPrescription(file, accessToken, { autoSubmit });
      setUploadResult(result); setUploadState('success');
      if (result.processing.requested === true || result.processing.requested === null) {
        setAnnouncement(
          result.processing.requested
            ? `Prescription uploaded. Automatic processing submission was confirmed for job ${result.processing.job_id}.`
            : 'Prescription uploaded. Processing submission could not be confirmed; checking status without re-uploading.',
        );
        navigate(`/prescriptions/${result.prescription_id}`, {
          state: { uploadProcessing: result.processing },
        });
      } else {
        setAnnouncement(`Prescription uploaded successfully. Reference ${result.prescription_id}. Processing has not been requested.`);
      }
    } catch (cause) {
      let message = 'The upload could not be completed. Please try again.';
      if (cause instanceof ApiError) {
        if (cause.status === 401) message = 'Your session expired or is invalid. Sign in again before uploading.';
        else if (cause.kind === 'network') message = 'MedDecode could not reach the upload service. Check your connection and try again.';
        else if (cause.status === 413) message = 'The upload service rejected this file because it is larger than 10 MB.';
        else if (cause.status === 400 || cause.status === 415) message = 'The upload service rejected this document. Choose a valid JPEG, PNG or PDF file.';
        else if (cause.status === 422) message = 'The document content does not match its declared type or appears malformed. Choose a complete, valid JPEG, PNG or PDF file.';
        else if (cause.status && cause.status >= 500) message = 'The secure upload service is temporarily unavailable. Please try again later.';
      } else if (cause instanceof Error && cause.message.includes('unexpected response')) {
        message = 'The upload service returned an invalid response. No successful upload can be confirmed.';
      }
      setUploadState('error'); setUploadError(message); setAnnouncement(message);
    } finally { uploadPending.current = false; }
  }

  return <div className="md-page md-upload-page">
    <header className="md-upload-intro">
      <div className="md-upload-heading-row"><h1 className="cc-page-title">Upload Prescription</h1><Badge tone="info">Secure upload</Badge></div>
      <p className="cc-page-description">Upload a prescription document securely, or explore a separate fictional sample.</p>
      <p className="md-upload-explanation"><Icon name="shield" /><span>Your prescription documents are uploaded securely and stored privately. PDF, JPEG, and PNG formats are supported for character extraction and medicine intelligence.</span></p>
    </header>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    <div className="md-upload-workspace">
      <section className="md-upload-form" aria-label="Prescription document selection">
        <SectionHeader title={file ? 'Selected document' : 'Choose a file'} description="The document is uploaded only after you confirm below." />
        <input className="sr-only" tabIndex={-1} disabled={uploadState === 'uploading'} aria-label="Choose prescription file" aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`} aria-invalid={!!error} ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={browse} />
        <div className={`md-upload-selection${dragging ? ' is-dragging' : ''}`}
          onDragEnter={event => { if (!uploadPending.current && event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
          onDragOver={event => { event.preventDefault(); if (!uploadPending.current && event.dataTransfer.types.includes('Files')) setDragging(true); }}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={drop}>
          {file ? <div className="md-upload-selected">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={`Preview of selected prescription ${file.name}`}
                className="md-upload-preview-thumb"
              />
            ) : file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? (
              <div className="md-upload-pdf-thumb" aria-label="PDF Document">
                <Icon name="copy" className="size-6" />
                <span>PDF</span>
              </div>
            ) : (
              <span className="cc-icon-box"><Icon name="inbox" className="size-6" /></span>
            )}
            <div className="md-upload-file-copy">
              <strong>{file.name}</strong>
              <span>{fileTypeLabel(file.name)} · {fileSizeLabel(file.size)}</span>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge tone={uploadState === 'success' ? 'success' : 'info'}>
                  {uploadState === 'success'
                    ? uploadResult?.processing.requested === false ? 'Uploaded, not processed' : 'Upload stored'
                    : 'Ready to upload'}
                </Badge>
                <Badge tone="info">Supported format (PDF, JPEG, PNG)</Badge>
                <Badge tone="neutral">Hosted worker currently disabled</Badge>
              </div>
            </div>
            <div className="md-upload-file-actions"><button className="cc-button cc-button--secondary" disabled={uploadState === 'uploading'} type="button" ref={replaceButton} aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`} onClick={() => input.current?.click()}>Replace file</button><Button disabled={uploadState === 'uploading'} variant="ghost" onClick={remove}>Remove file</Button></div>
          </div> : <button type="button" className="md-upload-drop" aria-label="Browse files" aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`} ref={browseButton} onClick={() => input.current?.click()}>
            <span className="cc-icon-box"><Icon name="inbox" className="size-6" /></span><strong>Drop a prescription file here</strong><span className="md-upload-drop-copy">or choose a document from your device</span><span className="cc-button cc-button--primary" aria-hidden="true"><Icon name="plus" className="size-4" />Browse files</span>
          </button>}
        </div>
        <p className="md-upload-help" id={helpId}>PDF, JPEG, PNG supported for OCR &amp; analysis · Up to 10 MB (images up to 10,000 px/side, 25M px total){file ? <span> · Drop another file here or use Replace file.</span> : null}</p>
        {error && <p key={selectionRevision} id={errorId} className="md-upload-error" role="alert"><Icon name="warning" className="size-5" /><span>{error}{file && <small>The previous file is still selected.</small>}</span></p>}
        {file && <Button loading={uploadState === 'uploading'} disabled={uploadState === 'success'} icon="inbox" onClick={() => void submitUpload()}>{uploadState === 'uploading' ? 'Uploading securely…' : uploadState === 'success' ? 'Upload complete' : 'Upload prescription'}</Button>}
        {uploadState === 'error' && <div className="md-upload-error" role="alert"><Icon name="warning" className="size-5" /><span>{uploadError}{uploadError.includes('session') && <small><Link to="/sign-in">Sign in again</Link></small>}</span></div>}
        {uploadResult && <section className="md-upload-success" aria-label="Upload confirmation">
          <div className="flex items-center gap-2">
            <Badge tone="success">Stored securely</Badge>
            <span className="text-xs font-semibold text-[var(--cc-success)]">Upload confirmed by backend</span>
          </div>
          <h2>Prescription uploaded successfully</h2>
          <p>Prescription ID: <code>{uploadResult.prescription_id}</code></p>
          <p>
            {uploadResult.processing.requested === false
              ? 'The document has been securely stored, but processing has not been requested. Hosted cloud worker is currently disabled; an analysis job will wait until an authorized worker is available.'
              : uploadResult.processing.requested === true
                ? `Automatic processing submission was confirmed for job ${uploadResult.processing.job_id}.`
                : 'The document is stored, but processing submission could not be confirmed. Check its status before taking any further action; do not upload it again.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {uploadResult.processing.requested === false ? <Link className="cc-button cc-button--primary" to={`/prescriptions/${uploadResult.prescription_id}?process=true`}>
              Start OCR &amp; Analysis
              <Icon name="arrow" className="size-4" />
            </Link> : null}
            <Link className="cc-button cc-button--secondary" to={`/prescriptions/${uploadResult.prescription_id}`}>
              View details only
            </Link>
            <Link className="cc-button cc-button--ghost" to="/prescriptions">
              All prescriptions
            </Link>
          </div>
        </section>}
      </section>
      <Card className="md-upload-demo-entry">
        <span className="cc-icon-box"><Icon name="copy" className="size-6" /></span>
        <SectionHeader title="Explore a fictional sample" description="See a predefined example without uploading or processing your document." />
        <button className="cc-button cc-button--primary" type="button" ref={sampleButton} aria-controls={sampleId} aria-expanded={sample} onClick={openSample}>View Sample Analysis<Icon name="arrow" className="size-4" /></button>
        <p className="md-upload-help">Predefined fictional content, independent of your selected file.</p>
      </Card>
    </div>
    {sample && <section className="md-upload-results" id={sampleId} aria-label="Sample analysis" aria-describedby={descriptionId}>
      <header className="cc-section-header"><div><h2 className="cc-section-title" tabIndex={-1} ref={resultTitle}>Sample Analysis — predefined example</h2><p className="cc-section-description" id={descriptionId}>Fictional sample. Not an analysis of your selected file. No OCR or medical verification was performed.</p></div><Button variant="secondary" onClick={() => closeSample()}>Close sample</Button></header>
      <div className="md-upload-result-meta"><Badge>RX-DEMO-01</Badge><Badge tone="warning">Clinical verification unavailable</Badge></div>
      <div className="md-upload-medicines">{medicines.slice(0, 2).map((item, index) => <article className="md-upload-medicine" key={item.id}><p className="cc-eyebrow">Fictional entry 0{index + 1}</p><h3>{item.name}</h3><dl className="md-upload-facts"><div><dt>Ingredient label</dt><dd>{item.ingredient}</dd></div><div><dt>Instructions / dosage</dt><dd>Not available in this demo</dd></div><div><dt>Confidence / clinical assessment</dt><dd>Not calculated</dd></div></dl></article>)}</div>
      <nav className="md-upload-sample-actions" aria-label="Sample next steps"><Link className="cc-button cc-button--primary" to="/demo/medicine-insights">Explore reference cards<Icon name="arrow" className="size-4" /></Link><Link className="cc-button cc-button--secondary" to="/demo/compare-medicines">Open comparison demo</Link><Link className="cc-button cc-button--secondary" to="/demo/my-cabinet">Open cabinet demo</Link></nav>
      <div><Button variant="ghost" onClick={() => closeSample(true)}>Back to file selection</Button></div>
    </section>}
    <p className="md-demo-footnote">Real uploads are stored privately. Sample analysis remains fictional and isolated. No background processing is started.</p>
  </div>;
}
