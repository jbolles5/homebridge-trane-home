export interface Range {
  heat: number;
  cool: number;
}
export interface Limits {
  min: number;
  max: number;
  heatMax?: number;
  coolMin?: number;
  deadband: number;
  unit: 'F' | 'C';
}
export function celsius(value: number, unit: 'F' | 'C'): number {
  return unit === 'F' ? ((value - 32) * 5) / 9 : value;
}
export function native(value: number, unit: 'F' | 'C'): number {
  return unit === 'F' ? (value * 9) / 5 + 32 : value;
}
export function normalize(current: Range, change: Partial<Range>, limits: Limits): Range {
  const step = limits.unit === 'F' ? 1 : 0.5;
  const round = (v: number) => Math.round(v / step) * step;
  let heat = round(change.heat ?? current.heat);
  let cool = round(change.cool ?? current.cool);
  if (change.heat !== undefined && change.cool === undefined)
    cool = Math.max(cool, Math.ceil((heat + limits.deadband) / step) * step);
  if (change.cool !== undefined && change.heat === undefined)
    heat = Math.min(heat, Math.floor((cool - limits.deadband) / step) * step);
  if (
    ![heat, cool, limits.min, limits.max, limits.deadband].every(Number.isFinite) ||
    limits.deadband <= 0 ||
    heat < limits.min ||
    heat > (limits.heatMax ?? limits.max) ||
    cool < (limits.coolMin ?? limits.min) ||
    cool > limits.max ||
    cool - heat + 1e-8 < limits.deadband
  ) {
    throw new Error('Setpoints exceed the device limits or minimum heat/cool separation');
  }
  return { heat, cool };
}
