import { expect, it, vi, afterEach } from 'vitest';
import { Coordinator, type CloudClient } from '../../src/coordinator.js';
import { config, fixture } from '../helpers.js';
afterEach(() => vi.useRealTimers());
const cloud = (): CloudClient => ({
  house: async () => ({ data: fixture(), etag: 'tag' }),
  request: async () => ({}),
  close: () => {},
});
it('coalesces concurrent refreshes into one house fetch', async () => {
  const api = cloud();
  const spy = vi.spyOn(api, 'house');
  const c = new Coordinator(config(), api);
  await Promise.all([c.refresh(), c.refresh(), c.refresh()]);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(c.state?.thermostats).toHaveLength(2);
});
it('preserves the cache and renews freshness on 304', async () => {
  vi.useFakeTimers();
  const api = cloud();
  const c = new Coordinator(config(), api);
  await c.refresh();
  const original = c.state;
  api.house = async (etag) => {
    expect(etag).toBe('tag');
    return {};
  };
  vi.setSystemTime(Date.now() + 300_000);
  await c.refresh();
  expect(c.state).toBe(original);
  expect(c.get('100001', '100101').thermostat.online).toBe(true);
});
it('reports offline/stale devices without dropping their accessories', async () => {
  const data = fixture();
  data.result._links.child[0].data.items[0].system_status = 'Not Connected';
  const c = new Coordinator(config(), { ...cloud(), house: async () => ({ data }) });
  await c.refresh();
  expect(() => c.get('100001', '100101')).toThrow('offline');
  expect(c.get('100002', '100102').thermostat.online).toBe(true);
  c.lastSuccess = Date.now() - 400_000;
  expect(() => c.get('100002', '100102')).toThrow('stale');
});
it('serializes mutations and prevents a rejected command from blocking later ones', async () => {
  const c = new Coordinator(config(), cloud());
  const order: string[] = [];
  const first = c.mutate(async () => {
    order.push('one');
    await Promise.resolve();
    throw new Error('failed');
  });
  const second = c.mutate(async () => {
    order.push('two');
  });
  await expect(first).rejects.toThrow('failed');
  await second;
  expect(order).toEqual(['one', 'two']);
});
it('blocks every write in read-only mode', async () => {
  const c = new Coordinator(config({ readOnly: true }), cloud());
  const action = vi.fn(async () => {});
  await expect(c.mutate(action)).rejects.toThrow('read-only');
  expect(action).not.toHaveBeenCalled();
});
it('polls both thermostats with one timer and stops cleanly', async () => {
  vi.useFakeTimers();
  const api = cloud();
  const spy = vi.spyOn(api, 'house');
  const c = new Coordinator(config(), api);
  c.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(spy).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(130_000);
  expect(spy).toHaveBeenCalledTimes(2);
  c.stop();
  await vi.advanceTimersByTimeAsync(500_000);
  expect(spy).toHaveBeenCalledTimes(2);
});
it('does not merge a command response for a different device into the target cache', async () => {
  const c = new Coordinator(config(), cloud());
  await c.refresh();
  c.notePendingWrite();
  c.acceptUpdate('100001', '100101', { result: { id: 999999, temperature: 60, name: 'Wrong device' } });
  expect(c.state!.thermostats[0]!.zones[0]).toMatchObject({ id: '100101', temperature: 74 });
  c.stop();
});
