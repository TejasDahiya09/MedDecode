import { useEffect, useLayoutEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { ThemeContext } from './theme-context';
import { isThemeMode, readThemeMode, resolveTheme, themeStorageKey, type ThemeMode } from './theme';

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, updateMode] = useState(readThemeMode);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const resolvedTheme = resolveTheme(mode, systemDark);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const synchronizeSystem = () => setSystemDark(media.matches);
    const changed = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    const sync = (event: StorageEvent) => {
      if (event.key === themeStorageKey || event.key === null) updateMode(readThemeMode());
    };
    media.addEventListener('change', changed);
    synchronizeSystem();
    window.addEventListener('storage', sync);
    return () => {
      media.removeEventListener('change', changed);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#0d1018' : '#f8f9fc');
  }, [resolvedTheme]);

  const value = useMemo(() => ({
    mode, resolvedTheme,
    setMode: (next: ThemeMode) => {
      if (!isThemeMode(next)) return;
      try { localStorage.setItem(themeStorageKey, next); } catch { /* Session-only fallback. */ }
      updateMode(next);
    },
  }), [mode, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
