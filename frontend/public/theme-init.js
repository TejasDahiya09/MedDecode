// Runs before styles/React. Keep this key and resolution in sync with theme.ts.
(() => {
  let mode = 'system';
  try {
    const stored = localStorage.getItem('meddecode-theme');
    if (['light', 'dark', 'system'].includes(stored)) mode = stored;
  } catch { /* The interface also works when storage is blocked. */ }
  const theme = mode === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1018' : '#f8f9fc');
})();
