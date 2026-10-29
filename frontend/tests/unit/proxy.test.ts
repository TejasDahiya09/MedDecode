// @vitest-environment node
import { expect, it } from 'vitest';
import { resolveConfig } from 'vite';

it('limits the proxy to development and rewrites only its namespace', async () => {
  const config = await resolveConfig({}, 'serve', 'development');
  const rule = config.server.proxy?.['^/backend(?:/|$)'];
  expect(rule).toBeTruthy();
  if (!rule || typeof rule === 'string') throw new Error('Missing proxy options');
  expect(rule.target).toBe('http://127.0.0.1:3000');
  expect(rule.rewrite?.('/backend/health')).toBe('/health');
  expect(rule.rewrite?.('/backend')).toBe('/');
  expect(new RegExp('^/backend(?:/|$)').test('/backend-other')).toBe(false);
  const preview = await resolveConfig({}, 'serve', 'production', 'production', true);
  expect(preview.server.proxy).toBeUndefined();
});
