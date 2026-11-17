import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PrescriptionHistoryPage } from '../features/prescriptions/PrescriptionHistoryPage';
import { MedicineCabinetPage } from '../features/cabinet/MedicineCabinetPage';
import { UploadPage } from '../features/demo/UploadPage';
import { MedicineInsightsPage } from '../features/catalogue/MedicineInsightsPage';
import { CompareMedicinesPage } from '../features/catalogue/CompareMedicinesPage';
import { RemindersPage } from '../features/reminders/RemindersPage';
import { BackendUnavailablePage } from '../features/workspace/BackendUnavailablePage';

export function WorkspacePage({ path }: { readonly path: string }) {
  switch (path) {
    case '/home':
      return <DashboardPage />;
    case '/prescriptions':
      return <PrescriptionHistoryPage />;
    case '/upload-prescription':
      return <UploadPage />;
    case '/my-cabinet':
      return <MedicineCabinetPage />;
    case '/medicine-library':
    case '/medicine-insights':
      return <MedicineInsightsPage />;
    case '/compare-medicines':
      return <CompareMedicinesPage />;
    case '/reminders':
      return <RemindersPage />;
    case '/learn-resources':
      return (
        <BackendUnavailablePage
          title="Learn & Resources"
          description="Reference resources are not yet connected to a verified source service."
          requirement="The current materials are demonstration fixtures, not externally verified medical articles. Open the separate demo to inspect the interface only."
          demoPath="/demo/learn-resources"
        />
      );
    default:
      return <DashboardPage />;
  }
}
