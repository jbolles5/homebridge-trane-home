import { expect, it, vi, afterEach } from 'vitest';
import { Coordinator } from '../../src/coordinator.js';
import { RoomIQ } from '../../src/roomiq.js';
import { config, fixture } from '../helpers.js';
afterEach(() => vi.useRealTimers());
async function setup() {
  const data = fixture();
  const features = data.result._links.child[0].data.items[0].zones[0].features;
  features.push({
    name: 'room_iq_sensors',
    sensors: [
      { id: 1, name: 'Thermostat', weight: 1, temperature: 72, temperature_valid: true },
      {
        id: 2,
        name: 'Bedroom',
        weight: 0,
        temperature: 70,
        temperature_valid: true,
        humidity: 45,
        humidity_valid: true,
        has_battery: true,
        battery_valid: true,
        battery_level: 80,
      },
    ],
  });
  const request = vi.fn(async (path: string): Promise<unknown> =>
    path.includes('announcements')
      ? { status: 'success' }
      : { result: { polling_path: '/backstage/announcements/test' } },
  );
  const c = new Coordinator(config({ enableRoomIQ: true }), {
    house: async () => ({ data }),
    request,
    close: () => {},
  });
  await c.refresh();
  return { c, iq: new RoomIQ(c), request };
}
it('debounces inclusion changes, posts normalized weights and polls completion', async () => {
  vi.useFakeTimers();
  const { c, iq, request } = await setup();
  const added = iq.include('100001', '100101', '2', true);
  const removed = iq.include('100001', '100101', '1', false);
  await vi.advanceTimersByTimeAsync(4100);
  await Promise.all([added, removed]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/mobile/xxl_zones/100101/update_active_sensors', 'POST', {
    updated_sensors: expect.arrayContaining([
      expect.objectContaining({ id: 1, weight: 0 }),
      expect.objectContaining({ id: 2, weight: 1 }),
    ]),
  });
  await vi.advanceTimersByTimeAsync(5100);
  expect(request.mock.calls.some((c) => c[0].includes('announcements'))).toBe(true);
  iq.stop();
  c.stop();
});
it('rejects removing the last sensor and unknown sensor IDs', async () => {
  const { c, iq, request } = await setup();
  await expect(iq.include('100001', '100101', '1', false)).rejects.toThrow('one sensor');
  await expect(iq.include('100001', '100101', '99', true)).rejects.toThrow('Unknown');
  expect(request).not.toHaveBeenCalled();
  iq.stop();
  c.stop();
});
it('never starts RoomIQ network traffic unless explicitly enabled', async () => {
  const { c, iq, request } = await setup();
  c.config.enableRoomIQ = false;
  await iq.refreshSensors();
  expect(request).not.toHaveBeenCalled();
  iq.stop();
  c.stop();
});
