import { expect, it, vi } from 'vitest';
import type { PlatformConfig } from 'homebridge';
import { TranePlatform } from '../../src/platform.js';
import { homebridge, logger } from '../hap.js';
import { fixture, config } from '../helpers.js';

it('registers exactly two accessories and restores identical IDs after rename/reorder', async () => {
  const api = homebridge();
  let data = fixture();
  const deps = {
    client: () => ({ house: async () => ({ data }), request: async () => ({}), close: () => {} }),
    deviceId: async () => 'device-uuid',
  };
  const first = new TranePlatform(logger, config() as unknown as PlatformConfig, api, deps);
  await first.launch();
  const calls = vi.mocked(api.registerPlatformAccessories).mock.calls;
  const accessories = calls.flatMap((args) => args[2]);
  expect(accessories).toHaveLength(2);
  expect(new Set(accessories.map((a) => a.UUID)).size).toBe(2);
  first.stop();
  const restoredApi = homebridge();
  const restored = new TranePlatform(logger, config() as unknown as PlatformConfig, restoredApi, deps);
  for (const accessory of accessories) restored.configureAccessory(accessory);
  data = fixture();
  data.result._links.child[0].data.items.reverse();
  data.result._links.child[0].data.items[0].name = 'Renamed thermostat';
  await restored.launch();
  expect(restoredApi.registerPlatformAccessories).not.toHaveBeenCalled();
  expect(accessories.some((a) => a.displayName === 'Renamed thermostat')).toBe(true);
  restored.stop();
});
it('never writes to thermostats during startup and retains cached accessories on cloud failure', async () => {
  const api = homebridge();
  const request = vi.fn(async () => ({}));
  const deps = {
    client: () => ({ house: async () => ({ data: fixture() }), request, close: () => {} }),
    deviceId: async () => 'device-uuid',
  };
  const platform = new TranePlatform(logger, config() as unknown as PlatformConfig, api, deps);
  await platform.launch();
  expect(request).not.toHaveBeenCalled();
  platform.stop();
  const restored = new TranePlatform(logger, config() as unknown as PlatformConfig, api, {
    ...deps,
    client: () => ({
      house: async () => {
        throw new Error('unavailable');
      },
      request,
      close: () => {},
    }),
  });
  for (const args of vi.mocked(api.registerPlatformAccessories).mock.calls)
    for (const a of args[2]) restored.configureAccessory(a);
  await restored.launch();
  expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
  restored.stop();
});
