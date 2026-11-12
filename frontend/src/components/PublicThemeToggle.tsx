import { useTheme } from '../providers/theme-context';
import { Icon } from './Icon';
import './public-theme-toggle.css';

// CampusConnect PublicThemeToggle: opposite of the effective theme, including System.
export function PublicThemeToggle() {
  const { resolvedTheme, setMode } = useTheme();
  const next = resolvedTheme === 'light' ? 'dark' : 'light';
  return <button aria-label={`Switch to ${next} mode`} className="cc-public-theme-toggle"
    onClick={() => setMode(next)} title={`Switch to ${next} mode`} type="button">
    <Icon name={resolvedTheme === 'light' ? 'moon' : 'sun'} />
    <span>{resolvedTheme === 'light' ? 'Dark' : 'Light'}</span>
  </button>;
}
