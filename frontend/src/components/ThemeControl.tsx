import { Icon } from './Icon';
import { cn } from '../utils/class-names';
import { useTheme } from '../providers/theme-context';
import type { ThemeMode } from '../providers/theme';

const options: ReadonlyArray<{
  readonly icon: 'monitor' | 'moon' | 'sun';
  readonly label: string;
  readonly value: ThemeMode;
}> = [
  { icon: 'sun', label: 'Light', value: 'light' },
  { icon: 'moon', label: 'Dark', value: 'dark' },
  { icon: 'monitor', label: 'System', value: 'system' },
];

export function ThemeControl({ compact = false }: { readonly compact?: boolean }) {
  const { mode, setMode } = useTheme();
  return (
    <div
      aria-label="Color theme"
      className={cn('cc-theme-control', compact && 'cc-theme-control--compact')}
      role="group"
    >
      {options.map((option) => (
        <button
          aria-label={`Use ${option.label.toLowerCase()} theme`}
          aria-pressed={mode === option.value}
          className="cc-theme-option"
          key={option.value}
          onClick={() => setMode(option.value)}
          title={`${option.label} theme`}
          type="button"
        >
          <Icon className="size-4" name={option.icon} />
          {compact ? <span className="sr-only">{option.label}</span> : <span>{option.label}</span>}
        </button>
      ))}
    </div>
  );
}
