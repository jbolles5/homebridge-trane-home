import { expect, it, vi } from 'vitest';
import { SensorAccessory, AutomationAccessory } from '../../src/accessories/sensors.js';
import { Coordinator } from '../../src/coordinator.js';
import { Commands } from '../../src/api/commands.js';
import { RoomIQ } from '../../src/roomiq.js';
import { homebridge, logger } from '../hap.js';
import { fixture, config } from '../helpers.js';
it('exposes valid RoomIQ readings and batteries without inventing unavailable measurements', async () => {
  const api = homebridge();
  const c = new Coordinator(config({ enableRoomIQ: true }), {
    house: async () => ({ data: fixture() }),
    request: async () => ({}),
    close: () => {},
  });
  await c.refresh();
  c.state!.thermostats[0]!.zones[0]!.sensors = [
    {
      id: '5',
      name: 'Bedroom',
      raw: {},
      selected: true,
      temperature: 68,
      humidity: 42,
      battery: 80,
      lowBattery: false,
      online: true,
    },
  ];
  const iq = new RoomIQ(c);
  vi.spyOn(iq, 'fresh').mockReturnValue(true);
  const accessory = new api.platformAccessory('Room', api.hap.uuid.generate('sensor'));
  const sensor = new SensorAccessory(api, accessory, c, iq, '100001', '100101', '5', logger);
  expect(accessory.getService(api.hap.Service.TemperatureSensor)).toBeDefined();
  expect(
    await accessory
      .getService(api.hap.Service.TemperatureSensor)!
      .getCharacteristic(api.hap.Characteristic.CurrentTemperature)
      .handleGetRequest(),
  ).toBe(20);
  expect(
    await accessory
      .getService(api.hap.Service.Battery)!
      .getCharacteristic(api.hap.Characteristic.BatteryLevel)
      .handleGetRequest(),
  ).toBe(80);
  vi.mocked(iq.fresh).mockReturnValue(false);
  await expect(
    accessory
      .getService(api.hap.Service.TemperatureSensor)!
      .getCharacteristic(api.hap.Characteristic.CurrentTemperature)
      .handleGetRequest(),
  ).rejects.toBeDefined();
  sensor.destroy();
  iq.stop();
  c.stop();
});
it('activates vendor automations once through a momentary switch', async () => {
  const api = homebridge();
  const request = vi.fn(async () => ({ success: true }));
  const c = new Coordinator(config(), { house: async () => ({ data: fixture() }), request, close: () => {} });
  await c.refresh();
  c.state!.automations = [{ id: '42', name: 'Good Night', raw: { id: 42 } }];
  const accessory = new api.platformAccessory('Good Night', api.hap.uuid.generate('automation'));
  const adapter = new AutomationAccessory(api, accessory, c, new Commands(c), '42', logger);
  const switchService = accessory.getService(api.hap.Service.Switch);
  expect(switchService).toBeDefined();
  await switchService!.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true);
  expect(request).toHaveBeenCalledTimes(1);
  expect(await switchService!.getCharacteristic(api.hap.Characteristic.On).handleGetRequest()).toBe(false);
  adapter.destroy();
  c.stop();
});
