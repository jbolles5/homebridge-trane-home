import { expect, it } from 'vitest';
import { Coordinator } from '../../src/coordinator.js';
import { Commands } from '../../src/api/commands.js';
import { ThermostatAccessory } from '../../src/accessories/thermostat.js';
import { homebridge, logger } from '../hap.js';
import { fixture, config } from '../helpers.js';
it('publishes clearly named custom status and independent humidity target characteristics only when enabled', async () => {
  const api = homebridge();
  const c = new Coordinator(config({ exposeAdvancedCharacteristics: true }), {
    house: async () => ({ data: fixture() }),
    request: async () => ({}),
    close: () => {},
  });
  await c.refresh();
  const accessory = new api.platformAccessory('Downstairs', api.hap.uuid.generate('advanced'));
  const adapter = new ThermostatAccessory(api, accessory, c, new Commands(c), '100001', '100101', logger);
  const characteristics = accessory.services.flatMap((s) => s.characteristics);
  const status = characteristics.find((c) => c.displayName === 'Trane System Status');
  expect(status).toBeDefined();
  expect(await status!.handleGetRequest()).toBe('Cooling');
  const target = characteristics.find((c) => c.displayName === 'Trane Dehumidify Target');
  expect(target).toBeDefined();
  expect(await target!.handleGetRequest()).toBe(50);
  adapter.destroy();
  c.stop();
});
