import type { IconName } from '../components/Icon';

export interface Destination {
  readonly path: string;
  readonly label: string;
  readonly icon: IconName;
  readonly description: string;
}

// Frontend destinations only; these paths do not declare application API endpoints.
export const destinations: readonly Destination[] = [
  { path: '/home', label: 'Home', icon: 'home', description: 'A starting point for your MedDecode tasks.' },
  { path: '/prescriptions', label: 'My Prescriptions', icon: 'inbox', description: 'View and track your uploaded prescriptions and OCR results.' },
  { path: '/upload-prescription', label: 'Upload Prescription', icon: 'plus', description: 'Upload a PDF or image and track prescription processing.' },
  { path: '/medicine-library', label: 'Medicine Library', icon: 'search', description: 'Explore official Indian medicine formulations.' },
  { path: '/compare-medicines', label: 'Compare Medicines', icon: 'copy', description: 'Compare selected catalogue formulations without implying clinical equivalence.' },
  { path: '/my-cabinet', label: 'My Cabinet', icon: 'briefcase', description: 'Organize saved medicines, quantities, refill dates and expiry details.' },
  { path: '/reminders', label: 'Reminders', icon: 'calendar', description: 'Create and manage medication schedules and recorded dose events.' },
  { path: '/learn-resources', label: 'Learn & Resources', icon: 'bookmark', description: 'A place for future learning materials and resources.' },
];

export const mobileDestinations = [
  { path: '/home', label: 'Home', icon: 'home' },
  { path: '/prescriptions', label: 'Prescriptions', icon: 'inbox' },
  { path: '/upload-prescription', label: 'Upload', icon: 'plus' },
  { path: '/medicine-library', label: 'Library', icon: 'search' },
  { path: '/my-cabinet', label: 'Cabinet', icon: 'briefcase' },
] as const;
