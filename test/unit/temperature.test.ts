import { describe, expect, it } from 'vitest';
import { celsius, native, normalize } from '../../src/domain/temperature.js';

const limits = { min: 55, max: 90, deadband: 3, unit: 'F' as const };
describe('temperature boundary', () => {
  it('converts Fahrenheit to HomeKit Celsius and back', () => {
    expect(celsius(68, 'F')).toBe(20);
    expect(native(20, 'F')).toBe(68);
    expect(celsius(20.5, 'C')).toBe(20.5);
  });
  it('fills and adjusts the cool counterpart for a heat-only change', () => {
    expect(normalize({ heat: 68, cool: 74 }, { heat: 73 }, limits)).toEqual({ heat: 73, cool: 76 });
  });
  it('fills and adjusts the heat counterpart for a cool-only change', () => {
    expect(normalize({ heat: 68, cool: 74 }, { cool: 69 }, limits)).toEqual({ heat: 66, cool: 69 });
  });
  it('rounds in native units before enforcing deadband', () => {
    expect(
      normalize({ heat: 20, cool: 24 }, { heat: 22.3 }, { min: 10, max: 32, deadband: 2, unit: 'C' }),
    ).toEqual({ heat: 22.5, cool: 24.5 });
  });
  it('rejects impossible limits and explicit crossed ranges', () => {
    expect(() => normalize({ heat: 68, cool: 74 }, { heat: 89 }, limits)).toThrow();
    expect(() => normalize({ heat: 68, cool: 74 }, { heat: 75, cool: 76 }, limits)).toThrow();
    expect(() => normalize({ heat: 68, cool: 74 }, { cool: NaN }, limits)).toThrow();
  });
  it('honors separate device heating maximum and cooling minimum limits', () => {
    expect(() =>
      normalize({ heat: 68, cool: 74 }, { heat: 92 }, { ...limits, max: 99, heatMax: 90, coolMin: 60 }),
    ).toThrow('limits');
    expect(() =>
      normalize({ heat: 68, cool: 74 }, { cool: 59 }, { ...limits, max: 99, heatMax: 90, coolMin: 60 }),
    ).toThrow('limits');
  });
});
