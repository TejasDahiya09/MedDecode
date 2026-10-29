import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { destinations } from './navigation';
import { NotFound, SectionPlaceholder } from './SectionPlaceholder';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate replace to="/home" />} />
        {destinations.map((destination) => <Route key={destination.path} path={destination.path} element={<SectionPlaceholder destination={destination} />} />)}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App() { return <BrowserRouter><AppRoutes /></BrowserRouter>; }
