import { Link, Navigate, useParams } from 'react-router-dom';
import { DemoWorkspace } from './DemoWorkspace';
import { PhaseD1DemoPage } from './PhaseD1DemoPage';

const demoPaths: Readonly<Record<string, string>> = {
  home: '/home',
  'medicine-insights': '/medicine-insights',
  'compare-medicines': '/compare-medicines',
  'my-cabinet': '/my-cabinet',
  reminders: '/reminders',
  'learn-resources': '/learn-resources',
  'phase-d1': '/phase-d1',
};

const demoSections = [
  ['home', 'Home'],
  ['medicine-insights', 'Medicine Insights'],
  ['compare-medicines', 'Compare Medicines'],
  ['my-cabinet', 'My Cabinet'],
  ['reminders', 'Reminders'],
  ['learn-resources', 'Learn & Resources'],
  ['phase-d1', 'Phase D.1 Preview'],
] as const;

export function DemoWorkspaceRoute() {
  const { section } = useParams<{ section: string }>();
  const path = section ? demoPaths[section] : undefined;
  const isPhaseD1Preview = section === 'phase-d1';
  if (!path) return <Navigate replace to="/demo/home" />;

  return (
    <main className="md-page p-4 sm:p-6 max-w-6xl mx-auto space-y-5" id="main-content" tabIndex={-1}>
      <header className="rounded-2xl border border-[var(--cc-warning)]/40 bg-[var(--cc-warning-soft)]/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-warning)]">Separate demonstration</p>
            <h1 className="mt-1 text-lg font-bold text-[var(--cc-text)]">
              {isPhaseD1Preview ? 'Source-backed local demo fixtures' : 'Fictional interface fixtures'}
            </h1>
            <p className="mt-1 text-sm text-[var(--cc-muted)]">
              {isPhaseD1Preview
                ? 'NLEM 2022 medicine attributes; all patient, schedule, reminder, and dose-history data are synthetic. No account data or backend writes.'
                : 'Not connected to account data, verified medicine sources, or backend write operations.'}
            </p>
          </div>
          <Link className="cc-button cc-button--secondary" to="/home">Return to account workspace</Link>
        </div>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Demo navigation">
          {demoSections.map(([slug, label]) => (
            <Link key={slug} className="cc-button cc-button--ghost" aria-current={section === slug ? 'page' : undefined} to={`/demo/${slug}`}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      {isPhaseD1Preview ? <PhaseD1DemoPage /> : <DemoWorkspace path={path} />}
    </main>
  );
}
