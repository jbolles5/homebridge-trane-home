import { expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';
const base = { username: 'user@example.test', password: 'secret' };
it('defaults to a read-only pilot and one shared two-minute poll', () => {
  expect(parseConfig(base)).toMatchObject({
    brand: 'trane',
    readOnly: true,
    pollIntervalSeconds: 120,
    staleAfterSeconds: 360,
  });
});
it('rejects missing credentials without echoing secrets', () => {
  expect(() => parseConfig({ password: 'do-not-echo' })).toThrow('username');
  expect(() => parseConfig({ username: 'user' })).toThrow('password');
});
it('rejects unsafe intervals, invalid booleans and unknown brands', () => {
  for (const change of [
    { pollIntervalSeconds: 1 },
    { staleAfterSeconds: 50 },
    { readOnly: 'false' },
    { brand: 'unknown' },
  ]) {
    expect(() => parseConfig({ ...base, ...change })).toThrow();
  }
});
