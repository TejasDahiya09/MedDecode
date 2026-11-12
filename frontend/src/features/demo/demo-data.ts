// Fictional presentation data. No clinical properties or patient records.
export interface Medicine { id: string; name: string; ingredient: string; form: string; category: string; code: string }
export interface CabinetItem { id: string; name: string; quantity: number; location: string }
export interface Reminder { id: string; title: string; date: string; time: string; enabled: boolean }
export const medicines: readonly Medicine[] = [
  { id: 'aster', name: 'Aster — Sample 01', ingredient: 'Illustrative ingredient A', form: 'Tablet (example)', category: 'Reference example', code: 'MD / 001' },
  { id: 'birch', name: 'Birch — Sample 02', ingredient: 'Illustrative ingredient B', form: 'Capsule (example)', category: 'Reference example', code: 'MD / 002' },
  { id: 'cedar', name: 'Cedar — Sample 03', ingredient: 'Illustrative ingredient A', form: 'Liquid (example)', category: 'Reference example', code: 'MD / 003' },
  { id: 'dune', name: 'Dune — Sample 04', ingredient: 'Not available in this demo', form: 'Tablet (example)', category: 'Incomplete example', code: 'MD / 004' },
];
export const initialCabinet: CabinetItem[] = [
  { id: 'c1', name: medicines[0]!.name, quantity: 12, location: 'Example shelf A' },
  { id: 'c2', name: medicines[1]!.name, quantity: 3, location: 'Example shelf A' },
  { id: 'c3', name: medicines[2]!.name, quantity: 8, location: 'Example shelf B' },
];
export const initialReminders: Reminder[] = [
  { id: 'r1', title: 'Review example cabinet', date: '2026-10-31', time: '09:00', enabled: true },
  { id: 'r2', title: 'Organize sample documents', date: '2026-10-31', time: '18:30', enabled: true },
  { id: 'r3', title: 'Explore reference information', date: '2026-11-01', time: '10:00', enabled: false },
];
export const prescriptions = [
  { id: 'RX-DEMO-01', title: 'Example document 01', date: '31 Oct 2026', count: 2 },
  { id: 'RX-DEMO-02', title: 'Example document 02', date: '30 Oct 2026', count: 1 },
] as const;
export const resources = [
  { id: 'reading', title: 'Read a reference card', category: 'Getting started', description: 'Find your way around the information explorer.', body: 'Each fictional reference card separates its example name, ingredient label and formulation. A field marked unavailable has no verified information behind it. The examples are interface fixtures, not medicine recommendations.' },
  { id: 'prescription', title: 'Explore a sample prescription', category: 'Prescriptions', description: 'Understand the difference between a file and a sample result.', body: 'Browse or drop a JPG, PNG or PDF to preview its filename locally. View Sample Analysis opens a predefined example independently of that file. OCR, extraction and clinical verification are not connected.' },
  { id: 'terms', title: 'Understand the labels', category: 'Reference literacy', description: 'A short guide to the fields used in this demonstration.', body: 'Name identifies a fictional reference entry. Ingredient is an illustrative label. Formulation is an example format. Source status tells you whether information has been verified. Matching labels alone do not establish therapeutic equivalence.' },
  { id: 'questions', title: 'Prepare questions for a professional', category: 'Responsible use', description: 'Keep interpretation with a qualified healthcare professional.', body: 'Use the interface to organize questions. Ask a qualified healthcare professional to interpret your prescription, explain unfamiliar terms and discuss any concerns before changing medicines. This demo cannot assess individual suitability, interactions or dosage.' },
  { id: 'privacy', title: 'Know where your data goes', category: 'Responsible use', description: 'Local demo state, explained in plain language.', body: 'No selected files are sent to a server. Cabinet and reminder changes exist in memory for this visit and reset on reload. Theme preference is the only persistent application setting. Do not enter real patient information for a demonstration.' },
  { id: 'compare', title: 'Compare without assuming equivalence', category: 'Reference literacy', description: 'See differences without making a treatment decision.', body: 'The comparison screen aligns available example properties. It does not evaluate clinical equivalence, safety, efficacy, interactions or prices. Missing properties remain unavailable; no equivalence score is calculated.' },
] as const;
