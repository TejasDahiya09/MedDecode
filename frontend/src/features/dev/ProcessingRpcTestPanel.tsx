import { useRef, useState } from 'react';
import { Badge, Button, Card, PageHeader, SectionHeader } from '../../components/ui';
import { useAuth } from '../auth/AuthProvider';
import { endpointFor } from '../../services/api-client';
import {
  approvedPrescriptionId,
  processingStatus,
  requestTestBackend,
  RpcPanelError,
  verifiedIdentity,
  verifiedOwnedPrescription,
  verifiedSubmission,
} from './processing-rpc-test';

type Check = 'auth' | 'ownership' | 'status' | 'submit' | 'deduplicate' | 'existing' | 'cancel';
type Message = { readonly tone: 'danger' | 'success' | 'warning'; readonly text: string };
const cancellationMarker = 'meddecode.synthetic-cancellation.65624a5e-f197-465e-a34a-712f979e9624';

export default function ProcessingRpcTestPanel() {
  const auth = useAuth();
  const [busy, setBusy] = useState<Check | null>(null);
  const [messages, setMessages] = useState<Partial<Record<Check, Message>>>({});
  const [authPassed, setAuthPassed] = useState(false);
  const [ownershipPassed, setOwnershipPassed] = useState(false);
  const [statusPassed, setStatusPassed] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [deduplicated, setDeduplicated] = useState(false);
  const cancellationInFlight = useRef(false);
  const [cancellationAttempted, setCancellationAttempted] = useState(() => {
    try { return window.localStorage.getItem(cancellationMarker) !== null; }
    catch { return true; }
  });

  const fail = (check: Check, text: string) => {
    setMessages(current => ({ ...current, [check]: { tone: 'danger', text } }));
    if (check === 'auth') setAuthPassed(false);
    if (check === 'ownership') setOwnershipPassed(false);
    if (check === 'status') setStatusPassed(false);
  };

  async function run(check: Check, action: (token: string) => Promise<void>) {
    if (busy) return;
    const token = auth.getAccessToken();
    if (!token) { fail(check, 'No verified browser session is available. Stop and sign in again.'); return; }
    setBusy(check);
    setMessages(current => ({ ...current, [check]: undefined }));
    try { await action(token); }
    catch (error) { fail(check, error instanceof RpcPanelError ? error.message : 'Unexpected verification response. No write was performed.'); }
    finally { setBusy(null); }
  }

  const message = (check: Check) => messages[check]
    ? <p role={messages[check]?.tone === 'danger' ? 'alert' : 'status'}><Badge tone={messages[check]!.tone}>{messages[check]!.text}</Badge></p>
    : null;

  return <main className="md-page" tabIndex={-1}>
    <PageHeader eyebrow="Local development only" title="Processing RPC integration test" description="Explicit, authenticated checks through the configured API. No request runs automatically." />
    <Card className="mt-6">
      <SectionHeader title="Fixed test scope" description={`Approved synthetic prescription: ${approvedPrescriptionId}`} />
      <p className="cc-page-description mt-2">The access token stays inside the authenticated request helper and is never displayed or logged.</p>
    </Card>
    <div className="mt-6 grid gap-5">
      <Card><SectionHeader title="Existing synthetic job" description="Read-only: verify the signed-in account owns the previously approved queued prescription and job." />
        <Button loading={busy === 'existing'} disabled={busy !== null} onClick={() => void run('existing', async token => {
          const identity = await requestTestBackend('/api/v1/auth/me', token);
          if (identity.status !== 200 || !auth.user || !verifiedIdentity(identity.body, auth.user.id)) throw new RpcPanelError(null, 'The signed-in session and backend identity do not match.');
          const prescription = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}`, token);
          if (prescription.status !== 200 || !verifiedOwnedPrescription(prescription.body, 'queued')) throw new RpcPanelError(null, 'The prescription response is invalid or its state is not queued.');
          const response = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}/processing-status`, token);
          const job = response.status === 200 ? processingStatus(response.body) : undefined;
          if (job === null) throw new RpcPanelError(null, 'No processing job is visible for this prescription.');
          if (!job || job.status !== 'queued') throw new RpcPanelError(null, 'The job response is invalid or its state is not queued.');
          if (job.job_id !== '65624a5e-f197-465e-a34a-712f979e9624') throw new RpcPanelError(null, 'A different processing job is current; stop and review.');
          setMessages(current => ({ ...current, existing: { tone: 'success', text: 'Signed-in account owns the approved queued synthetic job. Result absence and S3 object existence require separate verification.' } }));
        })}>Verify existing synthetic job</Button>{message('existing')}</Card>
      <Card><SectionHeader title="Approved one-job cancellation" description="One-time action for the explicitly approved synthetic job. Do not retry after an uncertain response." />
        <Button variant="danger" loading={busy === 'cancel'} disabled={busy !== null || cancellationAttempted} onClick={() => {
          if (cancellationInFlight.current || cancellationAttempted) return;
          if (!window.confirm('Cancel only the approved synthetic job 65624a5e-f197-465e-a34a-712f979e9624? This changes hosted job data.')) return;
          cancellationInFlight.current = true;
          void run('cancel', async token => {
            const path = `/api/v1/prescriptions/${approvedPrescriptionId}/jobs/65624a5e-f197-465e-a34a-712f979e9624/cancel`;
            const endpoint = endpointFor(path);
            if (endpoint.origin !== window.location.origin || endpoint.pathname !== path) throw new RpcPanelError(null, 'The local API proxy is not configured. No cancellation was attempted.');
            const identity = await requestTestBackend('/api/v1/auth/me', token);
            if (identity.status !== 200 || !auth.user || !verifiedIdentity(identity.body, auth.user.id)) throw new RpcPanelError(null, 'The signed-in session and backend identity do not match. No cancellation was attempted.');
            const prescription = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}`, token);
            if (!verifiedOwnedPrescription(prescription.body, 'queued')) throw new RpcPanelError(null, 'The owned prescription is not queued. No cancellation was attempted.');
            const current = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}/processing-status`, token);
            const job = processingStatus(current.body);
            if (!job || job.status !== 'queued' || job.job_id !== '65624a5e-f197-465e-a34a-712f979e9624') throw new RpcPanelError(null, 'The target job is not the current queued job. No cancellation was attempted.');
            try { window.localStorage.setItem(cancellationMarker, 'attempted'); }
            catch { throw new RpcPanelError(null, 'The one-attempt safety marker is unavailable. No cancellation was attempted.'); }
            setCancellationAttempted(true);
            try {
              const result = await requestTestBackend(path, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
              const row = result.body as Record<string, unknown> | null;
              if (result.status !== 200 || !row || row.prescription_id !== approvedPrescriptionId ||
                  row.job_id !== '65624a5e-f197-465e-a34a-712f979e9624' || row.status !== 'cancelled' ||
                  row.already_cancelled !== false || typeof row.cancelled_at !== 'string' || !Number.isFinite(Date.parse(row.cancelled_at))) {
                throw new Error('Unexpected response');
              }
              setMessages(currentMessages => ({ ...currentMessages, cancel: { tone: 'success', text: 'Cancellation response received. Do not retry; independent verification is required.' } }));
            } catch {
              throw new RpcPanelError(null, 'Cancellation outcome is uncertain or rejected. Do not retry; independent database verification is required.');
            }
          }).finally(() => { cancellationInFlight.current = false; });
        }}>Cancel approved synthetic job once</Button>{message('cancel')}</Card>
      <Card><SectionHeader title="1. Authentication check" description="Read-only: verifies the current browser session with the isolated backend." />
        <Button loading={busy === 'auth'} disabled={busy !== null} onClick={() => void run('auth', async token => {
          const result = await requestTestBackend('/api/v1/auth/me', token);
          if (result.status !== 200 || !auth.user || !verifiedIdentity(result.body, auth.user.id)) throw new Error('Invalid identity');
          setAuthPassed(true); setMessages(current => ({ ...current, auth: { tone: 'success', text: 'Authenticated test account verified.' } }));
        })}>Run authentication check</Button>{message('auth')}</Card>

      <Card><SectionHeader title="2. Prescription ownership check" description="Read-only: requires the approved prescription to be owned and still uploaded." />
        <Button loading={busy === 'ownership'} disabled={busy !== null || !authPassed} onClick={() => void run('ownership', async token => {
          const result = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}`, token);
          if (result.status !== 200 || !verifiedOwnedPrescription(result.body)) {
            if (verifiedOwnedPrescription(result.body, 'queued')) throw new RpcPanelError(null, 'This pre-submission check requires an uploaded prescription; this prescription is already queued. Use the existing-job check.');
            throw new RpcPanelError(null, 'The prescription response is invalid or is not ready for submission.');
          }
          setOwnershipPassed(true); setMessages(current => ({ ...current, ownership: { tone: 'success', text: 'Owned uploaded prescription verified.' } }));
        })}>Run ownership check</Button>{message('ownership')}</Card>

      <Card><SectionHeader title="3. Processing-status check" description="Read-only: requires no existing processing job before submission." />
        <Button loading={busy === 'status'} disabled={busy !== null || !ownershipPassed} onClick={() => void run('status', async token => {
          const result = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}/processing-status`, token);
          const status = result.status === 200 ? processingStatus(result.body) : undefined;
          if (status === undefined) throw new Error('Malformed status');
          if (!createdJobId && status?.status === 'cancelled') {
            setStatusPassed(false);
            setMessages(current => ({ ...current, status: { tone: 'warning', text: 'A historical cancelled job is recorded. No new submission was made.' } }));
            return;
          }
          if (!createdJobId && status !== null) throw new Error('Unexpected existing job');
          if (createdJobId && (status === null || status.status !== 'queued' || status.job_id !== createdJobId)) throw new Error('Job mismatch');
          setStatusPassed(true); setMessages(current => ({ ...current, status: { tone: 'success', text: status === null ? 'No processing job exists.' : 'Queued job status verified.' } }));
        })}>Run processing-status check</Button>{message('status')}</Card>

      <Card><SectionHeader title="4. First processing submission" description="Write: creates one hosted queued job and changes the prescription status to queued." />
        <Button variant="danger" loading={busy === 'submit'} disabled={busy !== null || !authPassed || !ownershipPassed || !statusPassed || createdJobId !== null} onClick={() => {
          if (!window.confirm('This authorized test will create one hosted queued job and change prescription status to queued. Continue?')) return;
          void run('submit', async token => {
            const result = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}/process`, token, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            const submission = result.status === 202 ? verifiedSubmission(result.body, true) : null;
            if (!submission) throw new Error('Invalid submission');
            setCreatedJobId(submission.jobId); setStatusPassed(false);
            setMessages(current => ({ ...current, submit: { tone: 'success', text: `Queued job created and verified: ${submission.jobId}` } }));
          });
        }}>Confirm and submit first job</Button>{message('submit')}</Card>

      <Card><SectionHeader title="5. Deduplication retry" description="Write request: must return the same active job without creating another one." />
        <Button loading={busy === 'deduplicate'} disabled={busy !== null || !authPassed || !ownershipPassed || createdJobId === null || deduplicated} onClick={() => void run('deduplicate', async token => {
          const result = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}/process`, token, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
          });
          const submission = result.status === 200 ? verifiedSubmission(result.body, false, createdJobId ?? undefined) : null;
          if (!submission) throw new Error('Invalid deduplication');
          setDeduplicated(true); setMessages(current => ({ ...current, deduplicate: { tone: 'success', text: 'Deduplication returned the same queued job.' } }));
        })}>Run authorized deduplication retry</Button>{message('deduplicate')}</Card>
    </div>
  </main>;
}
