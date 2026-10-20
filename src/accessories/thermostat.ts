import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { Coordinator } from '../coordinator.js';
import type { Commands } from '../api/commands.js';
import { celsius } from '../domain/temperature.js';
import { Bindings } from './bindings.js';
import { CloudError } from '../api/client.js';
import { addControls } from './controls.js';
import { addDiagnostics } from './diagnostics.js';
export class ThermostatAccessory {
  readonly bindings: Bindings;
  private listener: () => void;
  constructor(
    private api: API,
    public accessory: PlatformAccessory,
    private coordinator: Coordinator,
    private commands: Commands,
    private tid: string,
    private zid: string,
    log: Logger,
  ) {
    const t = coordinator.state?.thermostats.find((t) => t.id === tid);
    const z = t?.zones.find((z) => z.id === zid);
    if (!t || !z) throw new CloudError('Thermostat is not present in the current inventory');
    this.bindings = new Bindings(api, accessory, log);
    const b = this.bindings;
    const C = api.hap.Characteristic;
    const name = coordinator.config.names[`${tid}:${zid}`] ?? coordinator.config.names[tid] ?? z.name;
    accessory.displayName = name;
    accessory
      .getService(api.hap.Service.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Trane')
      .setCharacteristic(C.Model, t.model)
      .setCharacteristic(C.SerialNumber, `${tid}-${zid}`)
      .setCharacteristic(C.FirmwareRevision, t.firmware);
    const service = b.service(api.hap.Service.Thermostat, name, 'thermostat');
    service.setPrimaryService(true);
    const state = () => coordinator.get(tid, zid);
    const modeValues: Record<string, number> = { OFF: 0, HEAT: 1, COOL: 2, AUTO: 3 };
    b.bind(service, C.CurrentTemperature, () => {
      const s = state();
      return celsius(s.zone.temperature, s.thermostat.limits.unit);
    });
    b.bind(
      service,
      C.TargetHeatingCoolingState,
      () => modeValues[state().zone.mode]!,
      async (value) => {
        const mode = ['OFF', 'HEAT', 'COOL', 'AUTO'][Number(value)];
        if (!mode) throw new CloudError('Unsupported HVAC mode');
        await commands.mode(tid, zid, mode);
      },
    ).setProps({ validValues: z.modes.map((m) => modeValues[m]!) });
    b.bind(service, C.CurrentHeatingCoolingState, () => {
      const { zone, thermostat } = state();
      if (zone.mode === 'OFF' || !zone.calling) return 0;
      return thermostat.status.toLowerCase() === 'heating'
        ? 1
        : thermostat.status.toLowerCase() === 'cooling'
          ? 2
          : 0;
    });
    const props = {
      minValue: Math.ceil(celsius(t.limits.min, t.limits.unit) * 10) / 10,
      maxValue: Math.floor(celsius(t.limits.max, t.limits.unit) * 10) / 10,
      minStep: 0.1,
    };
    b.bind(
      service,
      C.TargetTemperature,
      () => {
        const { zone, thermostat } = state();
        const target =
          zone.mode === 'HEAT'
            ? zone.targets.heat
            : zone.mode === 'COOL'
              ? zone.targets.cool
              : (zone.targets.heat + zone.targets.cool) / 2;
        return celsius(target, thermostat.limits.unit);
      },
      async (value) => {
        const mode = state().zone.mode;
        if (mode !== 'HEAT' && mode !== 'COOL')
          throw new CloudError(
            'Use the low/high temperature range in Auto; select Heat/Cool for a single target',
          );
        await commands.targets(tid, zid, { [mode === 'HEAT' ? 'heat' : 'cool']: Number(value) });
      },
    ).setProps(props);
    b.bind(
      service,
      C.HeatingThresholdTemperature,
      () => {
        const s = state();
        return celsius(s.zone.targets.heat, s.thermostat.limits.unit);
      },
      async (value) => commands.targets(tid, zid, { heat: Number(value) }),
    ).setProps(props);
    b.bind(
      service,
      C.CoolingThresholdTemperature,
      () => {
        const s = state();
        return celsius(s.zone.targets.cool, s.thermostat.limits.unit);
      },
      async (value) => commands.targets(tid, zid, { cool: Number(value) }),
    ).setProps(props);
    b.bind(
      service,
      C.TemperatureDisplayUnits,
      () =>
        typeof accessory.context.displayUnits === 'number'
          ? accessory.context.displayUnits
          : t.limits.unit === 'F'
            ? 1
            : 0,
      async (value) => {
        accessory.context.displayUnits = Number(value);
      },
    );
    if (t.humidity !== undefined)
      b.bind(service, C.CurrentRelativeHumidity, () => {
        const humidity = state().thermostat.humidity;
        if (humidity === undefined) throw new CloudError('Humidity is unavailable');
        return humidity;
      });
    else if (service.testCharacteristic(C.CurrentRelativeHumidity))
      service.removeCharacteristic(service.getCharacteristic(C.CurrentRelativeHumidity));
    if (!coordinator.config.exposeHumidityTargets && service.testCharacteristic(C.TargetRelativeHumidity))
      service.removeCharacteristic(service.getCharacteristic(C.TargetRelativeHumidity));
    addControls(b, coordinator, commands, tid, zid, service);
    addDiagnostics(b, coordinator, commands, tid, zid);
    this.listener = () => this.update();
    coordinator.on('updated', this.listener);
    b.removeUnused();
    this.update();
  }
  update(): void {
    this.bindings.update();
  }
  destroy(): void {
    this.coordinator.off('updated', this.listener);
  }
}
