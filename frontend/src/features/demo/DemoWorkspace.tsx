import { HomePage } from './HomePage';
import { UploadPage } from './UploadPage';
import { CompareMedicinesPage } from './CompareMedicinesPage';
import { MedicineInsightsPage } from './MedicineInsightsPage';
import { MyCabinet, Reminders } from './ManagePages';
import { ResourcesPage } from './ResourcesPage';
import './demo.css';
export function DemoWorkspace({ path }: { path: string }) {
  switch (path) {
    case '/upload-prescription': return <UploadPage />;
    case '/medicine-insights': return <MedicineInsightsPage />;
    case '/compare-medicines': return <CompareMedicinesPage />;
    case '/my-cabinet': return <MyCabinet />;
    case '/reminders': return <Reminders />;
    case '/learn-resources': return <ResourcesPage />;
    default: return <HomePage />;
  }
}
