export interface Config {
  platform: string;
  name: string;
  username: string;
  password: string;
  brand: 'trane' | 'nexia' | 'asair';
  houseId?: string;
  pollIntervalSeconds: number;
  staleAfterSeconds: number;
  readOnly: boolean;
  holdOnSetpointChange: boolean;
  exposeFanModes: boolean;
  exposePresets: boolean;
  exposeEmergencyHeat: boolean;
  exposeOutdoorTemperature: boolean;
  exposeHumidityTargets: boolean;
  exposeAirCleaner: boolean;
  exposeFanSpeed: boolean;
  enableRoomIQ: boolean;
  exposeAutomations: boolean;
  exposeAdvancedCharacteristics: boolean;
  thermostatIds: string[];
  names: Record<string, string>;
}
export function parseConfig(input: unknown): Config {
  if (!input || typeof input !== 'object') throw new Error('Configuration must be an object');
  const data = input as Record<string, unknown>;
  const required = (key: string) => {
    if (typeof data[key] !== 'string' || !String(data[key]).trim())
      throw new Error(`Configure ${key} in plugin settings`);
    return String(data[key]);
  };
  const bool = (key: string, fallback = false) => {
    if (data[key] === undefined) return fallback;
    if (typeof data[key] !== 'boolean') throw new Error(`${key} must be true or false`);
    return data[key] as boolean;
  };
  const interval = (key: string, fallback: number, min: number, max: number) => {
    const value = data[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw new Error(`${key} is out of range`);
    return value;
  };
  const poll = interval('pollIntervalSeconds', 120, 60, 3600);
  const stale = interval('staleAfterSeconds', Math.max(360, poll * 3), poll * 2, 86400);
  const brand = data.brand ?? 'trane';
  if (brand !== 'trane' && brand !== 'nexia' && brand !== 'asair') throw new Error('Invalid brand');
  const names: Record<string, string> = {};
  if (data.names !== undefined) {
    if (!data.names || typeof data.names !== 'object' || Array.isArray(data.names))
      throw new Error('names must be an object');
    for (const [id, name] of Object.entries(data.names)) {
      if (typeof name !== 'string' || !name.trim())
        throw new Error('Accessory names must be non-empty strings');
      names[id] = name;
    }
  }
  if (
    data.thermostatIds !== undefined &&
    (!Array.isArray(data.thermostatIds) || !data.thermostatIds.every((v) => typeof v === 'string'))
  )
    throw new Error('thermostatIds must be a string array');
  if (data.houseId !== undefined && !/^[a-zA-Z0-9_-]+$/.test(String(data.houseId)))
    throw new Error('Invalid houseId');
  return {
    platform: 'TraneHome',
    name: typeof data.name === 'string' ? data.name : 'Trane Home',
    username: required('username').trim(),
    password: required('password'),
    brand,
    houseId: data.houseId === undefined ? undefined : String(data.houseId),
    pollIntervalSeconds: poll,
    staleAfterSeconds: stale,
    readOnly: bool('readOnly', true),
    holdOnSetpointChange: bool('holdOnSetpointChange'),
    exposeFanModes: bool('exposeFanModes', true),
    exposePresets: bool('exposePresets'),
    exposeEmergencyHeat: bool('exposeEmergencyHeat'),
    exposeOutdoorTemperature: bool('exposeOutdoorTemperature'),
    exposeHumidityTargets: bool('exposeHumidityTargets'),
    exposeAirCleaner: bool('exposeAirCleaner'),
    exposeFanSpeed: bool('exposeFanSpeed'),
    enableRoomIQ: bool('enableRoomIQ'),
    exposeAutomations: bool('exposeAutomations'),
    exposeAdvancedCharacteristics: bool('exposeAdvancedCharacteristics'),
    thermostatIds: (data.thermostatIds as string[]) ?? [],
    names,
  };
}
