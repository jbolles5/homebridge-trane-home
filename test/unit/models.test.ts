import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseHouse } from '../../src/api/models.js';
export const fixture = () =>
  JSON.parse(readFileSync(new URL('../fixtures/two-xl1050.json', import.meta.url), 'utf8'));
it('parses two real-format XL1050s, native zones and equipment capabilities', () => {
  const home = parseHouse(fixture());
  expect(home.thermostats).toHaveLength(2);
  expect(home.thermostats[0]).toMatchObject({
    id: '100001',
    name: 'Downstairs',
    humidity: 45,
    online: true,
    limits: { min: 55, max: 99, deadband: 3, unit: 'F' },
  });
  expect(home.thermostats[0]?.zones[0]).toMatchObject({
    id: '100101',
    name: 'Downstairs',
    mode: 'AUTO',
    temperature: 74,
    calling: true,
    hold: true,
  });
  expect(home.thermostats[0]?.fan?.value).toBe('circulate');
  expect(home.thermostats[0]?.dehumidify?.values).toContain(0.5);
});
it('finds device collections by link and supports grouped devices', () => {
  const h = fixture();
  const links = h.result._links.child;
  const devices = links[0].data.items;
  links[0].data.items = [{ type: 'group', _links: { child: devices.map((data: unknown) => ({ data })) } }];
  links.reverse();
  expect(parseHouse(h).thermostats).toHaveLength(2);
});
it('keeps offline status and zero humidity, and does not invent missing sensor readings', () => {
  const h = fixture();
  const raw = h.result._links.child[0].data.items[0];
  raw.system_status = 'Not Connected';
  raw.indoor_humidity = 0;
  raw.outdoor_temperature = '--';
  expect(parseHouse(h).thermostats[0]).toMatchObject({ online: false, humidity: 0, outdoor: undefined });
});
it('rejects malformed required measurements instead of reporting zero', () => {
  const h = fixture();
  h.result._links.child[0].data.items[0].zones[0].temperature = null;
  expect(() => parseHouse(h)).toThrow('temperature');
});
it('uses upstream setpoint fallbacks for inactive targets and truthy status fallback', () => {
  const h = fixture();
  const raw = h.result._links.child[0].data.items[0];
  raw.zones[0].setpoints.heat = null;
  raw.zones[0].setpoints.cool = null;
  raw.system_status = '';
  raw.operating_state = 'System Idle';
  const t = parseHouse(h).thermostats[0]!;
  expect(t.zones[0]?.targets).toEqual({ heat: 55, cool: 99 });
  expect(t.zones[0]?.calling).toBe(false);
  expect(t.status).toBe('System Idle');
});
