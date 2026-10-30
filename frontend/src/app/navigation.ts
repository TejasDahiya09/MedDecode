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
  { path: '/upload-prescription', label: 'Upload Prescription', icon: 'inbox', description: 'A place to begin the prescription upload workflow.' },
  { path: '/medicine-insights', label: 'Medicine Insights', icon: 'search', description: 'A place to explore medicine information when available.' },
  { path: '/compare-medicines', label: 'Compare Medicines', icon: 'copy', description: 'A place to review medicine comparisons when available.' },
  { path: '/my-cabinet', label: 'My Cabinet', icon: 'briefcase', description: 'A place for your future cabinet workflow.' },
  { path: '/reminders', label: 'Reminders', icon: 'calendar', description: 'A place for your future reminder preferences.' },
  { path: '/learn-resources', label: 'Learn & Resources', icon: 'bookmark', description: 'A place for future learning materials and resources.' },
];

export const mobileDestinations = [
  { path: '/home', label: 'Home', icon: 'home' },
  { path: '/upload-prescription', label: 'Upload', icon: 'inbox' },
  { path: '/medicine-insights', label: 'Insights', icon: 'search' },
  { path: '/my-cabinet', label: 'Cabinet', icon: 'briefcase' },
  { path: '/reminders', label: 'Reminders', icon: 'calendar' },
  { path: '/learn-resources', label: 'Learn', icon: 'bookmark' },
] as const;
