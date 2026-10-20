import { expect, it } from 'vitest';
import { Coordinator } from '../../src/coordinator.js';
import { Commands } from '../../src/api/commands.js';
import { ThermostatAccessory } from '../../src/accessories/thermostat.js';
import { homebridge, logger } from '../hap.js';
import { fixture, config } from '../helpers.js';

async function setup(readOnly = false) {
  const api = homebridge();
  const c = new Coordinator(config({ readOnly }), {
    house: async () => ({ data: fixture() }),
    request: async () => ({}),
    close: () => {},
  });
  await c.refresh();
  const commands = new Commands(c);
  const accessory = new api.platformAccessory('Downstairs', api.hap.uuid.generate('test-thermostat'));
  const adapter = new ThermostatAccessory(api, accessory, c, commands, '100001', '100101', logger);
  return { api, c, commands, accessory, adapter };
}
it('uses actual HAP thermostat characteristics with Celsius temperatures and Auto thresholds', async () => {
  const { api, c, accessory, adapter } = await setup();
  const C = api.hap.Characteristic;
  const service = accessory.getService(api.hap.Service.Thermostat)!;
  expect(service).toBeDefined();
  expect(await service.getCharacteristic(C.CurrentTemperature).handleGetRequest()).toBeCloseTo(
    ((74 - 32) * 5) / 9,
    1,
  );
  expect(await service.getCharacteristic(C.TargetHeatingCoolingState).handleGetRequest()).toBe(
    C.TargetHeatingCoolingState.AUTO,
  );
  expect(await service.getCharacteristic(C.HeatingThresholdTemperature).handleGetRequest()).toBe(20);
  expect(await service.getCharacteristic(C.CurrentRelativeHumidity).handleGetRequest()).toBe(45);
  expect(await service.getCharacteristic(C.CurrentHeatingCoolingState).handleGetRequest()).toBe(
    C.CurrentHeatingCoolingState.COOL,
  );
  adapter.destroy();
  c.stop();
});
it('does not duplicate optional services when restoring the same accessory', async () => {
  const { api, c, commands, accessory, adapter } = await setup();
  const count = accessory.services.length;
  adapter.destroy();
  const restored = new ThermostatAccessory(api, accessory, c, commands, '100001', '100101', logger);
  expect(accessory.services.length).toBe(count);
  restored.destroy();
  c.stop();
});
it('fails HAP writes in read-only mode and reads when offline', async () => {
  const { api, c, accessory, adapter } = await setup(true);
  const C = api.hap.Characteristic;
  const service = accessory.getService(api.hap.Service.Thermostat)!;
  await expect(
    service.getCharacteristic(C.TargetHeatingCoolingState).handleSetRequest(1),
  ).rejects.toBeDefined();
  c.state!.thermostats[0]!.online = false;
  await expect(service.getCharacteristic(C.CurrentTemperature).handleGetRequest()).rejects.toBeDefined();
  adapter.destroy();
  c.stop();
});
