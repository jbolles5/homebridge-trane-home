import { expect, it } from 'vitest';
import { Coordinator } from '../../src/coordinator.js';
import { Commands } from '../../src/api/commands.js';
import { ThermostatAccessory } from '../../src/accessories/thermostat.js';
import { homebridge, logger } from '../hap.js';
import { fixture, config } from '../helpers.js';
async function setup(options: Record<string, unknown> = {}) {
  const api = homebridge();
  const c = new Coordinator(config(options), {
    house: async () => ({ data: fixture() }),
    request: async () => ({}),
    close: () => {},
  });
  await c.refresh();
  const commands = new Commands(c);
  const accessory = new api.platformAccessory('Downstairs', api.hap.uuid.generate('controls'));
  const adapter = new ThermostatAccessory(api, accessory, c, commands, '100001', '100101', logger);
  return { api, c, accessory, adapter };
}
it('exposes hold and supported fan selectors with confirmed state', async () => {
  const { api, c, accessory, adapter } = await setup();
  const S = api.hap.Service;
  const C = api.hap.Characteristic;
  expect(await accessory.getServiceById(S.Switch, 'hold')!.getCharacteristic(C.On).handleGetRequest()).toBe(
    true,
  );
  expect(
    await accessory.getServiceById(S.Switch, 'fan:circulate')!.getCharacteristic(C.On).handleGetRequest(),
  ).toBe(true);
  await expect(
    accessory.getServiceById(S.Switch, 'fan:circulate')!.getCharacteristic(C.On).handleSetRequest(false),
  ).rejects.toBeDefined();
  adapter.destroy();
  c.stop();
});
it('gates optional hardware controls and exposes actual equipment limits', async () => {
  const { api, c, accessory, adapter } = await setup({
    exposeFanSpeed: true,
    exposeEmergencyHeat: true,
    exposePresets: true,
    exposeOutdoorTemperature: true,
    exposeAirCleaner: true,
    exposeHumidityTargets: true,
  });
  const S = api.hap.Service;
  const C = api.hap.Characteristic;
  expect(accessory.getServiceById(S.Switch, 'emergencyHeat')).toBeDefined();
  expect(accessory.getServiceById(S.Switch, 'preset:2')).toBeDefined();
  expect(accessory.getServiceById(S.Switch, 'airCleaner:quick')).toBeDefined();
  expect(
    await accessory
      .getServiceById(S.Fanv2, 'fan-speed')!
      .getCharacteristic(C.RotationSpeed)
      .handleGetRequest(),
  ).toBe(50);
  expect(
    await accessory
      .getServiceById(S.TemperatureSensor, 'outdoor')!
      .getCharacteristic(C.CurrentTemperature)
      .handleGetRequest(),
  ).toBeCloseTo(((61 - 32) * 5) / 9, 1);
  expect(
    await accessory.getService(S.Thermostat)!.getCharacteristic(C.TargetRelativeHumidity).handleGetRequest(),
  ).toBe(50);
  adapter.destroy();
  c.stop();
});
it('does not publish disabled extra controls', async () => {
  const { api, c, accessory, adapter } = await setup();
  expect(accessory.getServiceById(api.hap.Service.Switch, 'emergencyHeat')).toBeUndefined();
  expect(accessory.getServiceById(api.hap.Service.Fanv2, 'fan-speed')).toBeUndefined();
  adapter.destroy();
  c.stop();
});
it('advertises descriptive configured names for all four default switches', async () => {
  const { api, c, accessory, adapter } = await setup();
  const C = api.hap.Characteristic;
  for (const [subtype, label] of [
    ['hold', 'Downstairs Permanent Hold'],
    ['fan:auto', 'Downstairs Fan Auto'],
    ['fan:on', 'Downstairs Fan On'],
    ['fan:circulate', 'Downstairs Fan Circulate'],
  ]) {
    const service = accessory.getServiceById(api.hap.Service.Switch, subtype!)!;
    expect(service.testCharacteristic(C.ConfiguredName)).toBe(true);
    expect(await service.getCharacteristic(C.ConfiguredName).handleGetRequest()).toBe(label);
  }
  adapter.destroy();
  c.stop();
});
it('repairs cached generic switch labels without replacing services and preserves user labels', async () => {
  const { api, c, accessory, adapter } = await setup();
  const C = api.hap.Characteristic;
  const hold = accessory.getServiceById(api.hap.Service.Switch, 'hold')!;
  hold.addOptionalCharacteristic(C.ConfiguredName);
  hold.setCharacteristic(C.ConfiguredName, 'Switch 1');
  hold.getCharacteristic(C.Name).onGet(() => {
    throw new api.hap.HapStatusError(api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  });
  adapter.destroy();
  const commands = new Commands(c);
  const restored = new ThermostatAccessory(api, accessory, c, commands, '100001', '100101', logger);
  expect(accessory.getServiceById(api.hap.Service.Switch, 'hold')).toBe(hold);
  expect(hold.getCharacteristic(C.ConfiguredName).value).toBe('Downstairs Permanent Hold');
  expect(await hold.getCharacteristic(C.Name).handleGetRequest()).toBe('Downstairs Permanent Hold');
  await hold.getCharacteristic(C.ConfiguredName).handleSetRequest('My Schedule Hold');
  restored.destroy();
  const rebound = new ThermostatAccessory(api, accessory, c, commands, '100001', '100101', logger);
  expect(await hold.getCharacteristic(C.ConfiguredName).handleGetRequest()).toBe('My Schedule Hold');
  rebound.destroy();
  c.stop();
});
