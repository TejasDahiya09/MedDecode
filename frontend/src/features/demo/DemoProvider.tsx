import { useState, type PropsWithChildren } from 'react';
import { DemoContext } from './demo-context';
import { initialCabinet, initialReminders, type CabinetItem, type Reminder } from './demo-data';

function useDemoState() {
  const [cabinet, setCabinet] = useState<CabinetItem[]>(() => initialCabinet.map(item => ({ ...item })));
  const [reminders, setReminders] = useState<Reminder[]>(() => initialReminders.map(item => ({ ...item })));
  const [notice, setNotice] = useState('');
  return { cabinet, setCabinet, reminders, setReminders, notice, setNotice };
}
export function DemoProvider({ children }: PropsWithChildren) { const state = useDemoState(); return <DemoContext.Provider value={state}>{children}</DemoContext.Provider>; }
