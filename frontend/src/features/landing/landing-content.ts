import type { IconName } from '../../components/Icon';

export const capabilities: readonly { title: string; icon: IconName; description: string; labels: readonly string[] }[] = [
  { title: 'Prescription Understanding', icon: 'copy', description: 'Organize available details from a prescription into a clearer view.', labels: ['Prescription details', 'Medicine information', 'Review with a professional'] },
  { title: 'Medicine Insights', icon: 'search', description: 'Explore medicine identities, active ingredients and supporting information.', labels: ['Medicine identity', 'Active ingredients', 'Available sources'] },
  { title: 'Compare Medicines', icon: 'filter', description: 'Review equivalent formulations and available cost information with context.', labels: ['Formulations', 'Available cost information', 'Professional guidance'] },
  { title: 'Medicine Cabinet', icon: 'briefcase', description: 'Keep medicine and expiry information organized in one place.', labels: ['Your medicines', 'Expiry information', 'Cabinet overview'] },
  { title: 'Reminders', icon: 'calendar', description: 'Plan medicine-management and refill reminders around your needs.', labels: ['Reminder preferences', 'Refill planning', 'Your routine'] },
  { title: 'Safety Awareness', icon: 'shield', description: 'Review supported interaction and precaution information when available.', labels: ['Available precautions', 'Source context', 'Ask a healthcare professional'] },
];

export const journey: readonly { title: string; description: string; icon: IconName; fragment: string }[] = [
  { title: 'Upload a prescription', description: 'Choose a supported prescription image or PDF.', icon: 'inbox', fragment: 'Image or PDF' },
  { title: 'Understand the information', description: 'MedDecode is designed to extract available prescription details and organize medicine information.', icon: 'search', fragment: 'Organized information' },
  { title: 'Explore and manage', description: 'Review available medicine insights, comparisons and medicine-management features.', icon: 'briefcase', fragment: 'Your next step' },
];

export const safetyDisclaimer = 'MedDecode provides informational medicine insights and does not replace professional medical advice. Consult a qualified healthcare professional before making medication decisions.';
