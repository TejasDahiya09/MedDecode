import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Badge, Button, Card, SectionHeader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { DemoPage, DemoLink, Verification } from './DemoShared';
import { medicines } from './demo-data';

export function UploadPage() {
  const [file, setFile] = useState<File | null>(null); const [error, setError] = useState(''); const [sample, setSample] = useState(false); const [dragging, setDragging] = useState(false); const input = useRef<HTMLInputElement>(null);
  function select(next?: File, count = 1) {
    setSample(false); setError('');
    if (!next) return;
    if (count !== 1) { setError('Choose one file at a time.'); return; }
    const extension = next.name.split('.').at(-1)?.toLowerCase();
    const expected = extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : ['jpg','jpeg'].includes(extension ?? '') ? 'image/jpeg' : null;
    if (!expected || (next.type && next.type !== expected)) { setError('Choose a JPG, PNG or PDF file.'); return; }
    if (!next.size || next.size > 10 * 1024 * 1024) { setError('Choose a non-empty file up to 10 MB.'); return; }
    setFile(next);
  }
  function drop(event: DragEvent) { event.preventDefault(); setDragging(false); select(event.dataTransfer.files[0], event.dataTransfer.files.length); }
  function browse(event: ChangeEvent<HTMLInputElement>) { select(event.target.files?.[0], event.target.files?.length); event.target.value = ''; }
  return <DemoPage title="Upload Prescription" description="A local file-selection preview. Your file stays in this browser tab.">
    <div className="md-demo-two"><Card className="md-demo-panel"><SectionHeader title="Choose a document" description="Use a synthetic file for your university demonstration." /><div className={`md-demo-drop ${dragging ? 'is-dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><span className="md-demo-big-icon"><Icon name="inbox" /></span><h2>Drop a prescription file here</h2><p>JPG, PNG or PDF · One file · Up to 10 MB</p><Button onClick={() => input.current?.click()}>Browse files</Button><input className="sr-only" aria-label="Choose prescription file" ref={input} type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={browse} /><small>Filename preview only. No file content is read or uploaded.</small></div>{error && <p className="md-demo-error" role="alert">{error}</p>}{file && <div className="md-demo-selected" role="status"><Icon name="inbox" className="size-5" /><div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(1)} KB · Selected locally, not analyzed</small></div><Button variant="ghost" onClick={() => { setFile(null); setSample(false); setError(''); }}>Remove file</Button></div>}</Card>
    <Card className="md-demo-panel md-demo-accent"><p className="cc-eyebrow">Guided demonstration</p><h2>See the workflow,<br />without uploading a record.</h2><p>Open a predefined, fictional result to explore how extracted information could be organized.</p><Button onClick={() => setSample(true)}>View Sample Analysis</Button><p className="md-demo-muted">This sample is independent of any selected file. OCR and clinical validation are not connected.</p></Card></div>
    {sample && <Card className="md-demo-panel" ><section aria-label="Sample analysis"><SectionHeader title="Sample Analysis — predefined example" description="Not an analysis of your selected file. No OCR or medical verification was performed." actions={<Button variant="secondary" onClick={() => setSample(false)}>Close sample</Button>} /><div className="md-demo-result-meta"><Badge>RX-DEMO-01</Badge><Verification /></div><div className="md-demo-two">{medicines.slice(0,2).map((item,index) => <div className="md-demo-result" key={item.id}><p className="cc-eyebrow">Example entry 0{index+1}</p><h3>{item.name}</h3><dl className="md-demo-properties"><div><dt>Ingredient label</dt><dd>{item.ingredient}</dd></div><div><dt>Instructions / dosage</dt><dd>Not available in this demo</dd></div><div><dt>Confidence / clinical assessment</dt><dd>Not calculated</dd></div></dl></div>)}</div><DemoLink to="/medicine-insights">Explore reference cards</DemoLink></section></Card>}
  </DemoPage>;
}
