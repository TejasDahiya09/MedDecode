import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { CabinetItem, Reminder } from './demo-data';
interface DemoState { cabinet: CabinetItem[]; setCabinet: Dispatch<SetStateAction<CabinetItem[]>>; reminders: Reminder[]; setReminders: Dispatch<SetStateAction<Reminder[]>>; notice: string; setNotice: Dispatch<SetStateAction<string>> }
export const DemoContext = createContext<DemoState | null>(null);
export function useDemo() { const state = useContext(DemoContext); if (!state) throw new Error('DemoProvider is required'); return state; }
