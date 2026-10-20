import type { CharacteristicValue, CharacteristicProps } from 'homebridge';
import type { Bindings } from './bindings.js';
import type { Coordinator } from '../coordinator.js';
import type { Commands } from '../api/commands.js';
import { feature, number } from '../api/models.js';
import { CloudError } from '../api/client.js';

export function addDiagnostics(
  b: Bindings,
  c: Coordinator,
  commands: Commands,
  tid: string,
  zid: string,
): void {
  if (!c.config.exposeAdvancedCharacteristics) return;
  const S = b.api.hap.Service;
  const C = b.api.hap.Characteristic;
  const { Formats, Perms } = b.api.hap;
  class Diagnostics extends S {
    static readonly UUID = b.api.hap.uuid.generate('homebridge-trane-home:diagnostics-service:v1');
    constructor(name?: string, subtype?: string) {
      super(name ?? 'Trane diagnostics', Diagnostics.UUID, subtype);
    }
  }
  const service = b.service(Diagnostics, `${b.accessory.displayName} Diagnostics`, 'diagnostics');
  const state = () => c.get(tid, zid);
  function attribute(
    key: string,
    label: string,
    format: CharacteristicProps['format'],
    read: () => CharacteristicValue,
    write?: (value: CharacteristicValue) => Promise<void>,
  ): void {
    class Attribute extends C {
      static readonly UUID = b.api.hap.uuid.generate(`homebridge-trane-home:${key}:v1`);
      constructor() {
        super(label, Attribute.UUID, {
          format,
          perms: [Perms.PAIRED_READ, Perms.NOTIFY, ...(write ? [Perms.PAIRED_WRITE] : [])],
          ...(format === Formats.FLOAT ? { minValue: 0, maxValue: 100, minStep: 1 } : {}),
        });
      }
    }
    if (!service.testCharacteristic(Attribute)) service.addOptionalCharacteristic(Attribute);
    b.bind(service, Attribute, read, write);
  }
  attribute('system-status', 'Trane System Status', Formats.STRING, () => state().thermostat.status);
  attribute('zone-status', 'Trane Zone Status', Formats.STRING, () =>
    String(state().zone.raw.zone_status || 'Idle'),
  );
  attribute('setpoint-status', 'Trane Setpoint Status', Formats.STRING, () =>
    state().zone.hold
      ? 'Permanent Hold'
      : `Following Schedule${state().zone.preset ? ` - ${state().zone.preset!.options.find((o) => o.value === state().zone.preset!.value)?.label ?? ''}` : ''}`,
  );
  attribute(
    'blower',
    'Trane Blower Active',
    Formats.BOOL,
    () => !['System Idle', 'System Off', 'Waiting...', 'Not Connected'].includes(state().thermostat.status),
  );
  const initial = c.state!.thermostats.find((t) => t.id === tid)!;
  if (number(feature(initial.raw, 'thermostat_compressor_speed').compressor_speed) !== undefined) {
    const speed = () => {
      const v = number(feature(state().thermostat.raw, 'thermostat_compressor_speed').compressor_speed);
      if (v === undefined) throw new CloudError('Compressor speed unavailable');
      return v * 100;
    };
    attribute('compressor-speed', 'Trane Compressor Speed', Formats.FLOAT, speed);
    // The upstream mobile API uses the same reported value for both properties.
    attribute('requested-compressor-speed', 'Trane Requested Compressor Speed', Formats.FLOAT, speed);
  }
  if (initial.airCleaner)
    attribute('air-cleaner', 'Trane Air Cleaner Mode', Formats.STRING, () =>
      String(state().thermostat.airCleaner?.value ?? 'Unknown'),
    );
  for (const key of ['humidify', 'dehumidify'] as const)
    if (initial[key]) {
      attribute(
        `${key}-target`,
        key === 'humidify' ? 'Trane Humidify Target' : 'Trane Dehumidify Target',
        Formats.FLOAT,
        () => Number(state().thermostat[key]?.value) * 100,
        async (value) => commands.setting(tid, zid, key, Number(value)),
      );
    }
}
