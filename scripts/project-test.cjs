'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const intelligence = path.join(root, 'intelligence');
const python = process.env.MEDDECODE_PYTHON_EXECUTABLE || path.join(intelligence, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const commands = [
  [process.execPath, ['--test', 'scripts/dev-launcher.test.cjs'], root],
  [process.execPath, [path.join(backend, 'node_modules/tsx/dist/cli.mjs'), '--test', 'tests/*.test.ts'], backend],
  [process.execPath, [path.join(frontend, 'node_modules/vitest/vitest.mjs'), 'run'], frontend],
  [python, ['-m', 'pytest', 'tests'], intelligence],
];
if (!fs.existsSync(python)) { console.error('Python virtual environment is unavailable.'); process.exit(1); }
for (const [command, args, cwd] of commands) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log('Unit and integration suites passed. Browser E2E is separate: npm run test:e2e.');
