import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { BackendUnavailablePage } from '../features/workspace/BackendUnavailablePage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { RouteLoadingState } from './RouteLoadingState';

const MedicineCabinetPage = lazy(() => import('../features/cabinet/MedicineCabinetPage').then((module) => ({ default: module.MedicineCabinetPage })));
const UploadPage = lazy(() => import('../features/demo/UploadPage').then((module) => ({ default: module.UploadPage })));
const MedicineInsightsPage = lazy(() => import('../features/catalogue/MedicineInsightsPage').then((module) => ({ default: module.MedicineInsightsPage })));
const CompareMedicinesPage = lazy(() => import('../features/catalogue/CompareMedicinesPage').then((module) => ({ default: module.CompareMedicinesPage })));
const RemindersPage = lazy(() => import('../features/reminders/RemindersPage').then((module) => ({ default: module.RemindersPage })));

function FeatureRoute({ component: Component, label }: { readonly component: LazyExoticComponent<ComponentType>; readonly label: string }) {
  return (
    <Suspense fallback={<RouteLoadingState label={label} />}>
      <Component />
    </Suspense>
  );
}

export function WorkspacePage({ path }: { readonly path: string }) {
  switch (path) {
    case '/home':
      return <DashboardPage />;
    case '/upload-prescription':
      return <FeatureRoute component={UploadPage} label="prescription upload" />;
    case '/my-cabinet':
      return <FeatureRoute component={MedicineCabinetPage} label="medicine cabinet" />;
    case '/medicine-library':
    case '/medicine-insights':
      return <FeatureRoute component={MedicineInsightsPage} label="medicine library" />;
    case '/compare-medicines':
      return <FeatureRoute component={CompareMedicinesPage} label="medicine comparison" />;
    case '/reminders':
      return <FeatureRoute component={RemindersPage} label="medication reminders" />;
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
