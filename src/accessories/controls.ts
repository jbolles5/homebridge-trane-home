import type { Service } from 'homebridge';
import type { Bindings } from './bindings.js';
import type { Coordinator } from '../coordinator.js';
import type { Commands, SettingCommand } from '../api/commands.js';
import type { Choice, Option } from '../api/models.js';
import { CloudError } from '../api/client.js';
import { celsius } from '../domain/temperature.js';

export function addControls(
  b: Bindings,
  c: Coordinator,
  commands: Commands,
  tid: string,
  zid: string,
  primary: Service,
): void {
  const C = b.api.hap.Characteristic;
  const S = b.api.hap.Service;
  const config = c.config;
  const state = () => c.get(tid, zid);
  const t = c.state!.thermostats.find((t) => t.id === tid)!;
  const z = t.zones.find((z) => z.id === zid)!;
  const name = b.accessory.displayName;
  const hold = b.service(S.Switch, `${name} Permanent Hold`, 'hold');
  b.bind(
    hold,
    C.On,
    () => state().zone.hold,
    async (value) => commands.hold(tid, zid, Boolean(value)),
  );
  function selectors(
    key: string,
    choice: Choice | undefined,
    read: () => Choice | undefined,
    write: (value: Option['value']) => Promise<void>,
  ): void {
    for (const option of choice?.options ?? []) {
      const service = b.service(
        S.Switch,
        `${name} ${key === 'fan' ? 'Fan' : key === 'airCleaner' ? 'Air Cleaner' : 'Preset'} ${option.label}`,
        `${key}:${option.value}`,
      );
      b.bind(
        service,
        C.On,
        () => read()?.value === option.value,
        async (value) => {
          if (value) await write(option.value);
          else if (read()?.value === option.value)
            throw new CloudError('Select a different named mode; the selected mode cannot be turned off');
        },
      );
    }
  }
  if (config.exposePresets)
    selectors(
      'preset',
      z.preset,
      () => state().zone.preset,
      (value) => commands.preset(tid, zid, value),
    );
  // Thermostat-wide equipment belongs to one zone accessory only.
  if (t.zones[0]?.id !== zid) return;
  if (config.exposeFanModes)
    selectors(
      'fan',
      t.fan,
      () => state().thermostat.fan,
      (value) => commands.setting(tid, zid, 'fan', value),
    );
  if (config.exposeAirCleaner)
    selectors(
      'airCleaner',
      t.airCleaner,
      () => state().thermostat.airCleaner,
      (value) => commands.setting(tid, zid, 'airCleaner', value),
    );
  if (config.exposeEmergencyHeat && t.emergencyHeat) {
    const service = b.service(S.Switch, `${name} Emergency Heat`, 'emergencyHeat');
    b.bind(
      service,
      C.On,
      () => ['true', 'on', '1'].includes(String(state().thermostat.emergencyHeat?.value).toLowerCase()),
      async (value) => commands.setting(tid, zid, 'emergencyHeat', Boolean(value)),
    );
  }
  if (
    config.exposeFanSpeed &&
    t.fanSpeed &&
    t.fan?.options.some((o) => o.value === 'auto') &&
    t.fan.options.some((o) => o.value === 'on')
  ) {
    const service = b.service(S.Fanv2, `${name} Blower`, 'fan-speed');
    b.bind(
      service,
      C.Active,
      () => (state().thermostat.fan?.value === 'on' ? 1 : 0),
      async (value) => commands.setting(tid, zid, 'fan', Number(value) === 1 ? 'on' : 'auto'),
    );
    b.bind(
      service,
      C.RotationSpeed,
      () => Number(state().thermostat.fanSpeed?.value) * 100,
      async (value) => commands.setting(tid, zid, 'fanSpeed', Number(value)),
    );
    b.bind(service, C.CurrentFanState, () =>
      ['System Idle', 'System Off', 'Waiting...', 'Not Connected'].includes(state().thermostat.status)
        ? 0
        : 2,
    );
  }
  if (config.exposeOutdoorTemperature && t.outdoor !== undefined) {
    const service = b.service(S.TemperatureSensor, `${name} Outdoor`, 'outdoor');
    b.bind(service, C.CurrentTemperature, () => {
      const value = state().thermostat.outdoor;
      if (value === undefined) throw new CloudError('Outdoor temperature is unavailable');
      return celsius(value, state().thermostat.limits.unit);
    });
  }
  if (config.exposeHumidityTargets && (t.humidify || t.dehumidify)) {
    const selected = (): Choice | undefined => {
      const { zone, thermostat } = state();
      return zone.mode === 'HEAT' && thermostat.humidify
        ? thermostat.humidify
        : (thermostat.dehumidify ?? thermostat.humidify);
    };
    b.bind(
      primary,
      C.TargetRelativeHumidity,
      () => Number(selected()?.value) * 100,
      async (value) => {
        const { zone, thermostat } = state();
        let keys: SettingCommand[] = [];
        if (zone.mode === 'HEAT') {
          if (thermostat.humidify) keys = ['humidify'];
        } else if (zone.mode === 'COOL') {
          if (thermostat.dehumidify) keys = ['dehumidify'];
        } else
          keys = [
            ...(thermostat.humidify ? ['humidify' as const] : []),
            ...(thermostat.dehumidify ? ['dehumidify' as const] : []),
          ];
        if (!keys.length) throw new CloudError('Humidity control is unavailable in this HVAC mode');
        for (const key of keys) await commands.setting(tid, zid, key, Number(value));
      },
    );
  }
}
