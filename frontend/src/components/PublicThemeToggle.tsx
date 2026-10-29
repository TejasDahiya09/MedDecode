import { useEffect, useRef } from 'react';
import { useTheme } from '../providers/theme-context';
import { Icon } from './Icon';
import { ThemeControl } from './ThemeControl';
import './public-theme-toggle.css';

// CampusConnect PublicThemeToggle presentation; MedDecode provider and preference key.
export function PublicThemeToggle() {
  const { mode, resolvedTheme, setMode } = useTheme();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const next = resolvedTheme === 'light' ? 'dark' : 'light';

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target)) {
        if (disclosure.current) disclosure.current.open = false;
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !disclosure.current?.open) return;
      event.preventDefault();
      disclosure.current.open = false;
      disclosure.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  return <div className="md-public-theme" role="group" aria-label="Appearance">
    <button aria-label={`Switch to ${next} mode`} className="cc-public-theme-toggle"
      onClick={() => setMode(next)} title={`Switch to ${next} mode`} type="button">
      <Icon name={resolvedTheme === 'light' ? 'moon' : 'sun'} />
      <span>{resolvedTheme === 'light' ? 'Dark' : 'Light'}</span>
    </button>
    <details className="md-theme-preferences" ref={disclosure}
      onBlur={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
      <summary aria-label={`Theme preference: ${mode}. Open options`} role="button" title={`Theme preference: ${mode}`}>
        <Icon name={mode === 'system' ? 'monitor' : 'chevron'} />
      </summary>
      <div className="md-theme-preferences-panel" onClick={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest('button')) return;
        if (disclosure.current) {
          disclosure.current.open = false;
          disclosure.current.querySelector('summary')?.focus();
        }
      }}>
        <ThemeControl />
      </div>
    </details>
  </div>;
}
