import { useState } from 'react';
import { Badge, Button, Card, PageHeader, SectionHeader } from '../../components/ui';
import { useAuth } from '../auth/AuthProvider';
import {
  approvedPrescriptionId,
  processingStatus,
  requestTestBackend,
  verifiedIdentity,
  verifiedOwnedPrescription,
  verifiedSubmission,
} from './processing-rpc-test';

type Check = 'auth' | 'ownership' | 'status' | 'submit' | 'deduplicate';
type Message = { readonly tone: 'danger' | 'success' | 'warning'; readonly text: string };

export default function ProcessingRpcTestPanel() {
  const auth = useAuth();
  const [busy, setBusy] = useState<Check | null>(null);
  const [messages, setMessages] = useState<Partial<Record<Check, Message>>>({});
  const [authPassed, setAuthPassed] = useState(false);
  const [ownershipPassed, setOwnershipPassed] = useState(false);
  const [statusPassed, setStatusPassed] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [deduplicated, setDeduplicated] = useState(false);

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
    catch { fail(check, 'The check failed safely. Stop; do not continue to a write operation.'); }
    finally { setBusy(null); }
  }

  const message = (check: Check) => messages[check]
    ? <p role={messages[check]?.tone === 'danger' ? 'alert' : 'status'}><Badge tone={messages[check]!.tone}>{messages[check]!.text}</Badge></p>
    : null;

  return <main className="md-page" tabIndex={-1}>
    <PageHeader eyebrow="Local development only" title="Processing RPC integration test" description="Explicit, authenticated checks against the isolated port-3001 backend. No request runs automatically." />
    <Card className="mt-6">
      <SectionHeader title="Fixed test scope" description={`Approved synthetic prescription: ${approvedPrescriptionId}`} />
      <p className="cc-page-description mt-2">The access token stays inside the authenticated request helper and is never displayed or logged.</p>
    </Card>
    <div className="mt-6 grid gap-5">
      <Card><SectionHeader title="1. Authentication check" description="Read-only: verifies the current browser session with the isolated backend." />
        <Button loading={busy === 'auth'} disabled={busy !== null} onClick={() => void run('auth', async token => {
          const result = await requestTestBackend('/api/v1/auth/me', token);
          if (result.status !== 200 || !auth.user || !verifiedIdentity(result.body, auth.user.id)) throw new Error('Invalid identity');
          setAuthPassed(true); setMessages(current => ({ ...current, auth: { tone: 'success', text: 'Authenticated test account verified.' } }));
        })}>Run authentication check</Button>{message('auth')}</Card>

      <Card><SectionHeader title="2. Prescription ownership check" description="Read-only: requires the approved prescription to be owned and still uploaded." />
        <Button loading={busy === 'ownership'} disabled={busy !== null || !authPassed} onClick={() => void run('ownership', async token => {
          const result = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}`, token);
          if (result.status !== 200 || !verifiedOwnedPrescription(result.body)) throw new Error('Invalid prescription');
          setOwnershipPassed(true); setMessages(current => ({ ...current, ownership: { tone: 'success', text: 'Owned uploaded prescription verified.' } }));
        })}>Run ownership check</Button>{message('ownership')}</Card>

      <Card><SectionHeader title="3. Processing-status check" description="Read-only: requires no existing processing job before submission." />
        <Button loading={busy === 'status'} disabled={busy !== null || !ownershipPassed} onClick={() => void run('status', async token => {
          const result = await requestTestBackend(`/api/v1/prescriptions/${approvedPrescriptionId}/processing-status`, token);
          const status = result.status === 200 ? processingStatus(result.body) : undefined;
          if (status === undefined) throw new Error('Malformed status');
          if (!createdJobId && status !== null) throw new Error('Unexpected existing job');
          if (createdJobId && (status === null || status.job_id !== createdJobId)) throw new Error('Job mismatch');
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
