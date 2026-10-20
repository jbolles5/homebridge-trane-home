import { readFileSync } from 'node:fs';
import { parseConfig } from '../src/config.js';
export const fixture = () =>
  JSON.parse(readFileSync(new URL('fixtures/two-xl1050.json', import.meta.url), 'utf8'));
export const config = (overrides: Record<string, unknown> = {}) =>
  parseConfig({ username: 'user@example.test', password: 'test-password', readOnly: false, ...overrides });
