import { useTheme } from '../providers/theme-context';
import { isThemeMode } from '../providers/theme';

export function App() {
  const { mode, resolvedTheme, setMode } = useTheme();
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12 sm:py-20">
      <section className="foundation-panel" aria-labelledby="foundation-title">
        <p className="eyebrow">Frontend foundation verification</p>
        <h1 id="foundation-title">MedDecode</h1>
        <p className="tagline">Intelligence Behind Every Prescription</p>
        <p>This screen verifies the application foundation and appearance preferences.</p>
        <div className="theme-control">
          <label htmlFor="theme">Appearance</label>
          <select id="theme" value={mode} onChange={(event) => {
            if (isThemeMode(event.target.value)) setMode(event.target.value);
          }} aria-describedby="theme-description">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
          <p id="theme-description" className="muted" role="status">Effective theme: {resolvedTheme}.</p>
        </div>
        <p className="muted">Product workflows are not yet implemented. This screen does not connect to application services.</p>
      </section>
    </main>
  );
}
