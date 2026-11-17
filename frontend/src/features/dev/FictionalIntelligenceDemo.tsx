import { useState } from 'react';
import { Badge, Button, Card, PageHeader, SectionHeader } from '../../components/ui';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import { runFictionalIntelligenceDemo, type FictionalIntelligenceResult } from './fictional-intelligence-demo';

export default function FictionalIntelligenceDemo() {
  const auth = useAuth();
  const [result, setResult] = useState<FictionalIntelligenceResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (running) return;
    const token = auth.getAccessToken();
    if (!token) { setError('Sign in with a verified local session before running this fixture.'); return; }
    setRunning(true); setError(null); setResult(null);
    try { setResult(await runFictionalIntelligenceDemo(token)); }
    catch (cause) { setError(cause instanceof ApiError && cause.status === 401 ? 'Your session is no longer valid. Sign in again.' : 'The local fictional intelligence fixture is unavailable.'); }
    finally { setRunning(false); }
  }
  return <main className="md-page" tabIndex={-1}>
    <PageHeader eyebrow="Development fixture only" title="Fictional intelligence result" description="Runs a marked fictional PDF through the local Node-to-Python fixture. It does not analyze an uploaded prescription." />
    <Card className="mt-6"><div className="flex flex-wrap gap-3"><Badge tone="warning">DEVELOPMENT FIXTURE / SIMULATED OCR</Badge><Badge tone="info">No database writes</Badge></div><p className="cc-page-description mt-3">The result uses injected fixture OCR and a fictional catalogue. It is not genuine OCR, clinical advice, or a result for an uploaded document.</p><Button className="mt-5" loading={running} disabled={running} onClick={() => void run()}>{running ? 'Running local fixture…' : 'Run fictional intelligence fixture'}</Button>{error ? <p className="mt-3" role="alert"><Badge tone="danger">{error}</Badge></p> : null}</Card>
    {result ? <section className="mt-6 grid gap-5" aria-label="Fictional intelligence result"><Card><SectionHeader title="Result status" description="Validated Contract v1 response from the local fixture." /><p className="mt-3"><Badge tone="warning">{result.status}</Badge></p></Card><Card><SectionHeader title="Recognized fictional medicine" /><div className="mt-4 grid gap-3">{result.medicines.map(medicine => <article key={medicine.sequence_number} className="rounded-xl border border-[var(--cc-border)] p-4"><h3 className="font-semibold">{medicine.extraction.medicine_name ?? medicine.extraction.raw_text}</h3><dl className="mt-3 grid gap-2 text-sm"><div><dt className="text-[var(--cc-muted)]">Strength</dt><dd>{medicine.extraction.strength?.value ?? 'Not available'} {medicine.extraction.strength?.unit ?? ''}</dd></div><div><dt className="text-[var(--cc-muted)]">Instructions</dt><dd>{medicine.extraction.instructions ?? 'Not available'}</dd></div><div><dt className="text-[var(--cc-muted)]">Match state</dt><dd>{medicine.medicine_match.status}</dd></div></dl></article>)}</div></Card><Card><SectionHeader title="Warnings" description="No alternatives, prices, or medical recommendations are shown." /><ul className="mt-3 grid gap-2">{result.warnings.map(warning => <li key={warning.code}><Badge tone={warning.severity === 'high' || warning.severity === 'medium' ? 'warning' : 'info'}>{warning.code}</Badge> <span className="text-sm">{warning.message}</span></li>)}</ul></Card></section> : null}
  </main>;
}
