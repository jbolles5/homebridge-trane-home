import { vi } from 'vitest';
import type { API, Logger } from 'homebridge';
// Test-only access to the installed implementation; production receives API from Homebridge.
const { HomebridgeAPI } = await import(new URL('./api.js', import.meta.resolve('homebridge')).href);
export function homebridge(): API {
  const api = new HomebridgeAPI();
  api.registerPlatformAccessories = vi.fn();
  api.updatePlatformAccessories = vi.fn();
  api.unregisterPlatformAccessories = vi.fn();
  return api as API;
}
export const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
  log: vi.fn(),
} as unknown as Logger;
