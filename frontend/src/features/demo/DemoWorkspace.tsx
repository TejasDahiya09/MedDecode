import { HomePage } from './HomePage';
import { UploadPage } from './UploadPage';
import { MedicineInsights, CompareMedicines } from './MedicinePages';
import { MyCabinet, Reminders } from './ManagePages';
import { ResourcesPage } from './ResourcesPage';
import './demo.css';
export function DemoWorkspace({ path }: { path: string }) {
  switch (path) {
    case '/upload-prescription': return <UploadPage />;
    case '/medicine-insights': return <MedicineInsights />;
    case '/compare-medicines': return <CompareMedicines />;
    case '/my-cabinet': return <MyCabinet />;
    case '/reminders': return <Reminders />;
    case '/learn-resources': return <ResourcesPage />;
    default: return <HomePage />;
  }
}
