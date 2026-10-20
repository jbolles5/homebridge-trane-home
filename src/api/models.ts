import type { Limits, Range } from '../domain/temperature.js';
export type Wire = Record<string, unknown>;
export interface Option {
  value: string | number | boolean;
  label: string;
}
export interface Choice {
  value: string | number | boolean;
  options: Option[];
  values: number[];
  raw: Wire;
}
export interface RoomSensor {
  id: string;
  name: string;
  raw: Wire;
  selected: boolean;
  temperature?: number;
  humidity?: number;
  battery?: number;
  lowBattery?: boolean;
  online: boolean;
}
export interface Zone {
  id: string;
  apiId: string;
  name: string;
  raw: Wire;
  temperature: number;
  targets: Range;
  mode: string;
  modes: string[];
  calling: boolean;
  hold: boolean;
  runMode?: Choice;
  preset?: Choice;
  sensors: RoomSensor[];
}
export interface Thermostat {
  id: string;
  name: string;
  model: string;
  firmware: string;
  raw: Wire;
  limits: Limits;
  online: boolean;
  status: string;
  humidity?: number;
  outdoor?: number;
  fan?: Choice;
  fanSpeed?: Choice;
  humidify?: Choice;
  dehumidify?: Choice;
  airCleaner?: Choice;
  emergencyHeat?: Choice;
  zones: Zone[];
}
export interface Automation {
  id: string;
  name: string;
  raw: Wire;
}
export interface House {
  id: string;
  name: string;
  thermostats: Thermostat[];
  automations: Automation[];
}
export function object(value: unknown): Wire {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Wire) : {};
}
export function array(value: unknown): Wire[] {
  return Array.isArray(value) ? value.map(object) : [];
}
export function feature(raw: Wire, name: string): Wire {
  return array(raw.features).find((f) => f.name === name) ?? {};
}
export function setting(raw: Wire, name: string): Wire {
  return array(raw.settings).find((f) => f.type === name) ?? {};
}
export function zoneSetting(t: Wire, z: Wire, name: string): Wire {
  return array(z.settings).length
    ? setting(z, name)
    : setting(t, name === 'zone_mode' ? 'system_mode' : name);
}
export function number(value: unknown): number | undefined {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
    Number.isFinite(Number(value))
    ? Number(value)
    : undefined;
}
function identifier(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[a-zA-Z0-9_-]+$/.test(String(value)))
    throw new Error('Invalid cloud device identifier');
  return String(value);
}
function requiredNumber(value: unknown, field: string): number {
  const parsed = number(value);
  if (parsed === undefined) throw new Error(`Missing or invalid ${field} in cloud response`);
  return parsed;
}
export function choice(raw: Wire): Choice | undefined {
  if (!Object.keys(raw).length) return undefined;
  const value = raw.current_value ?? raw.value;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined;
  const options = array(raw.options)
    .filter((o) => !o.header && ['string', 'number', 'boolean'].includes(typeof o.value))
    .map((o) => ({ value: o.value as Option['value'], label: String(o.label ?? o.value) }));
  return {
    value,
    options,
    values: (Array.isArray(raw.values) ? raw.values : options.map((o) => o.value))
      .map(number)
      .filter((n): n is number => n !== undefined),
    raw,
  };
}
function parseZone(raw: Wire, thermostat: Wire, status: string, online: boolean): Zone {
  const id = identifier(raw.id);
  const apiId = typeof raw.id === 'number' && raw.id < 256 ? `${identifier(thermostat.id)}_${id}` : id;
  const modeFeature = feature(raw, 'thermostat_mode');
  const mode = String(
    modeFeature.value ?? zoneSetting(thermostat, raw, 'zone_mode').current_value ?? 'OFF',
  ).toUpperCase();
  if (!['OFF', 'HEAT', 'COOL', 'AUTO'].includes(mode)) throw new Error('Unknown thermostat operating mode');
  const run =
    choice(zoneSetting(thermostat, raw, 'run_mode')) ??
    choice(zoneSetting(thermostat, raw, 'thermostat_run_mode')) ??
    choice(feature(raw, 'thermostat_run_mode'));
  const modeOptions =
    choice(modeFeature)?.options ?? choice(zoneSetting(thermostat, raw, 'zone_mode'))?.options ?? [];
  const modes = modeOptions
    .map((o) => String(o.value).toUpperCase())
    .filter((v) => ['OFF', 'HEAT', 'COOL', 'AUTO'].includes(v));
  const native = raw.name === 'NativeZone';
  const setpoints = object(raw.setpoints);
  return {
    id,
    apiId,
    name: native ? String(thermostat.name) : String(raw.name ?? 'Zone'),
    raw,
    temperature: online
      ? requiredNumber(raw.temperature, 'zone temperature')
      : (number(raw.temperature) ?? NaN),
    targets: {
      heat: requiredNumber(
        setpoints.heat ?? feature(thermostat, 'thermostat').setpoint_heat_min,
        'heating setpoint',
      ),
      cool: requiredNumber(
        setpoints.cool ?? feature(thermostat, 'thermostat').setpoint_cool_max,
        'cooling setpoint',
      ),
    },
    mode,
    modes: modes.length ? modes : ['OFF', 'HEAT', 'COOL', 'AUTO'],
    calling: native
      ? !['System Idle', 'System Off', 'Waiting...', 'Not Connected'].includes(status)
      : ['heating', 'cooling'].includes(String(raw.zone_status)) ||
        (!!raw.operating_state && raw.operating_state !== 'Damper Closed'),
    hold: !run || ['permanent_hold', 'hold'].includes(String(run.value)),
    runMode: run,
    preset: choice(zoneSetting(thermostat, raw, 'preset_selected')),
    sensors: array(feature(raw, 'room_iq_sensors').sensors).map((s) => ({
      id: identifier(s.id),
      name: String(s.name ?? 'Room sensor'),
      raw: s,
      selected: (number(s.weight) ?? 0) > 0,
      temperature: s.temperature_valid ? number(s.temperature) : undefined,
      humidity: s.humidity_valid ? number(s.humidity) : undefined,
      battery: s.has_battery && s.battery_valid ? number(s.battery_level) : undefined,
      lowBattery: typeof s.battery_low === 'boolean' ? s.battery_low : undefined,
      online: s.has_online !== true || s.connected === true,
    })),
  };
}
function parseThermostat(raw: Wire): Thermostat {
  const t = feature(raw, 'thermostat');
  const status = String(raw.system_status || raw.operating_state || t.status || 'Unknown');
  const online =
    status.toUpperCase() !== 'NOT CONNECTED' &&
    raw.connected !== false &&
    feature(raw, 'connection').is_connected !== false;
  const info = array(feature(raw, 'advanced_info').items);
  const label = (names: string[]) => info.find((x) => names.includes(String(x.label)))?.value;
  const unit = String(t.scale).toUpperCase();
  if (unit !== 'F' && unit !== 'C') throw new Error('Unknown thermostat temperature scale');
  return {
    id: identifier(raw.id),
    name: String(raw.name ?? 'Trane thermostat'),
    model: String(label(['Model']) ?? 'XL1050'),
    firmware: String(label(['Firmware Version', 'Main Firmware Version']) ?? 'Unknown'),
    raw,
    limits: {
      min: requiredNumber(t.setpoint_heat_min, 'minimum setpoint'),
      max: requiredNumber(t.setpoint_cool_max, 'maximum setpoint'),
      heatMax: number(t.setpoint_heat_max),
      coolMin: number(t.setpoint_cool_min),
      deadband: requiredNumber(t.setpoint_delta, 'deadband'),
      unit,
    },
    status,
    online,
    humidity: number(raw.indoor_humidity),
    outdoor: raw.has_outdoor_temperature ? number(raw.outdoor_temperature) : undefined,
    fan: choice(setting(raw, 'fan_mode')) ?? choice(feature(raw, 'thermostat_fan_mode')),
    fanSpeed: choice(setting(raw, 'fan_speed')),
    humidify: choice(setting(raw, 'humidify')),
    dehumidify: choice(setting(raw, 'dehumidify')),
    airCleaner: choice(setting(raw, 'air_cleaner_mode')),
    emergencyHeat: choice(setting(raw, 'emergency_heat')),
    zones: array(raw.zones).map((z) => parseZone(z, raw, status, online)),
  };
}
export function parseHouse(input: unknown): House {
  const envelope = object(input);
  if (envelope.success === false) throw new Error('Cloud returned an unsuccessful house response');
  const raw = object(envelope.result);
  const links = array(object(raw._links).child);
  const deviceLink = links.find((l) => String(l.href).includes('/devices'));
  if (!deviceLink) throw new Error('House response has no device collection');
  const items = (data: unknown) => (Array.isArray(data) ? array(data) : array(object(data).items));
  const flatten = (entries: Wire[]): Wire[] =>
    entries.flatMap((d) =>
      d.type === 'group' ? flatten(array(object(d._links).child).map((l) => object(l.data))) : [d],
    );
  const thermostats = flatten(items(deviceLink.data))
    .filter((d) => Array.isArray(d.zones) && d.zones.length > 0)
    .map(parseThermostat);
  const automations = items(links.find((l) => String(l.href).includes('/automations'))?.data).map((a) => ({
    id: identifier(a.id),
    name: String(a.name ?? 'Automation'),
    raw: a,
  }));
  return { id: identifier(raw.id), name: String(raw.name ?? 'Trane home'), thermostats, automations };
}
