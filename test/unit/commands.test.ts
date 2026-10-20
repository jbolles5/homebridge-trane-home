import { expect, it, vi, afterEach } from 'vitest';
import { Coordinator } from '../../src/coordinator.js';
import { Commands } from '../../src/api/commands.js';
import { config, fixture } from '../helpers.js';
afterEach(() => vi.useRealTimers());
async function setup(overrides: Record<string, unknown> = {}) {
  const request = vi.fn(async (_path: string, _method?: string, _body?: unknown): Promise<unknown> => ({}));
  const c = new Coordinator(config(overrides), {
    house: async () => ({ data: fixture() }),
    request,
    close: () => {},
  });
  await c.refresh();
  return { c, commands: new Commands(c), request };
}
it('uses the actual XL1050 action endpoint and keeps thermostat 2 unchanged', async () => {
  const { c, commands, request } = await setup();
  await commands.mode('100001', '100101', 'HEAT');
  expect(request).toHaveBeenCalledWith('https://www.mynexia.com/mobile/xxl_zones/100101/zone_mode', 'POST', {
    value: 'HEAT',
  });
  expect(c.state?.thermostats[1]?.zones[0]?.mode).toBe('AUTO');
  c.stop();
});
it('coalesces rapid one-sided Celsius writes into one valid native pair', async () => {
  vi.useFakeTimers();
  const { c, commands, request } = await setup();
  const writes = [
    commands.targets('100001', '100101', { heat: 20 }),
    commands.targets('100001', '100101', { heat: 21.111111 }),
  ];
  await vi.advanceTimersByTimeAsync(300);
  await Promise.all(writes);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/mobile/xxl_zones/100101/setpoints', 'POST', { heat: 70, cool: 73 });
  commands.stop();
  c.stop();
});
it('does not send unchanged fan or clamped humidity targets', async () => {
  const { c, commands, request } = await setup();
  await commands.setting('100001', '100101', 'fan', 'circulate');
  await commands.setting('100001', '100101', 'dehumidify', 51);
  expect(request).not.toHaveBeenCalled();
  c.stop();
});
it('honors advertised PUT methods', async () => {
  const { c, commands, request } = await setup();
  const raw = c.state!.thermostats[0]!.zones[0]!.raw;
  const features = raw.features as Record<string, unknown>[];
  features.find((f) => f.name === 'thermostat_mode')!.actions = {
    self: { href: '/mobile/custom/mode', method: 'PUT' },
  };
  await commands.mode('100001', '100101', 'COOL');
  expect(request).toHaveBeenCalledWith('/mobile/custom/mode', 'PUT', { value: 'COOL' });
  c.stop();
});
it('rejects out-of-range temperatures and unsupported fan values without cloud writes', async () => {
  vi.useFakeTimers();
  const { c, commands, request } = await setup();
  const rejection = expect(commands.targets('100001', '100101', { heat: 99 })).rejects.toThrow('limits');
  await vi.advanceTimersByTimeAsync(300);
  await rejection;
  await expect(commands.setting('100001', '100101', 'fan', 'turbo')).rejects.toThrow('Unsupported');
  expect(request).not.toHaveBeenCalled();
  commands.stop();
  c.stop();
});
it('rejects mutations during the read-only pilot', async () => {
  const { c, commands, request } = await setup({ readOnly: true });
  await expect(commands.mode('100001', '100101', 'COOL')).rejects.toThrow('read-only');
  expect(request).not.toHaveBeenCalled();
  c.stop();
});
it('never retries a timed-out automation', async () => {
  const { c, commands, request } = await setup();
  c.state!.automations = [{ id: '42', name: 'Test automation', raw: { id: 42 } }];
  request.mockRejectedValue(new Error('network timeout'));
  await expect(commands.automation('42')).rejects.toThrow('network timeout');
  expect(request).toHaveBeenCalledTimes(1);
  c.stop();
});
it('rejects an automation whose response explicitly reports failure', async () => {
  const { c, commands, request } = await setup();
  c.state!.automations = [{ id: '42', name: 'Automation', raw: { id: 42 } }];
  request.mockResolvedValue({ success: false });
  await expect(commands.automation('42')).rejects.toThrow('rejected');
  expect(request).toHaveBeenCalledTimes(1);
  c.stop();
});
it('reconciles a sparse response before comparing the next mode with the cache', async () => {
  vi.useFakeTimers();
  const raw = fixture();
  const calls: string[] = [];
  const c = new Coordinator(config(), {
    house: async () => ({ data: structuredClone(raw) }),
    close: () => {},
    request: async (_p, _m, body) => {
      const value = (body as { value: string }).value;
      calls.push(value);
      raw.result._links.child[0].data.items[0].zones[0].features.find(
        (f: { name: string }) => f.name === 'thermostat_mode',
      ).value = value;
      return { success: true, result: {} };
    },
  });
  await c.refresh();
  const commands = new Commands(c);
  await commands.mode('100001', '100101', 'COOL');
  const second = commands.mode('100001', '100101', 'AUTO');
  await vi.advanceTimersByTimeAsync(7100);
  await second;
  expect(calls).toEqual(['COOL', 'AUTO']);
  commands.stop();
  c.stop();
});
it('starts the settling window after a slow sparse write response', async () => {
  vi.useFakeTimers();
  const data = fixture();
  const house = vi.fn(async () => ({ data: structuredClone(data) }));
  const request = vi.fn(async () => {
    vi.setSystemTime(Date.now() + 8000);
    return { success: true, result: {} };
  });
  const c = new Coordinator(config(), { house, request, close: () => {} });
  await c.refresh();
  const commands = new Commands(c);
  await commands.mode('100001', '100101', 'COOL');
  const next = commands.mode('100001', '100101', 'HEAT');
  await vi.advanceTimersByTimeAsync(1);
  expect(house).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(7100);
  await next;
  expect(house.mock.calls.length).toBeGreaterThan(1);
  commands.stop();
  c.stop();
});
