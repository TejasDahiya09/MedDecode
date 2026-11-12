import { medicines } from './demo-data';

// Normalize the matching value only; the controlled input retains the user's text.
export function normalizeMedicineQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
export function findExampleMedicines(value: string) {
  const query = normalizeMedicineQuery(value);
  return medicines.filter(item => normalizeMedicineQuery(`${item.name} ${item.ingredient} ${item.form} ${item.code}`).includes(query));
}
