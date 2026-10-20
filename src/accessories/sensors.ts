import type { API, Logger, PlatformAccessory } from 'homebridge';
import type { Coordinator } from '../coordinator.js';
import type { RoomIQ } from '../roomiq.js';
import type { Commands } from '../api/commands.js';
import { Bindings } from './bindings.js';
import { celsius } from '../domain/temperature.js';
import { CloudError } from '../api/client.js';
export class SensorAccessory {
  private bindings: Bindings;
  private listener: () => void;
  constructor(
    api: API,
    accessory: PlatformAccessory,
    private c: Coordinator,
    iq: RoomIQ,
    tid: string,
    zid: string,
    sid: string,
    log: Logger,
  ) {
    const t = c.state!.thermostats.find((t) => t.id === tid)!;
    const z = t.zones.find((z) => z.id === zid)!;
    const initial = z.sensors.find((s) => s.id === sid)!;
    accessory.displayName = `${z.name} ${initial.name}`;
    const C = api.hap.Characteristic;
    const S = api.hap.Service;
    const b = (this.bindings = new Bindings(api, accessory, log));
    accessory
      .getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Trane')
      .setCharacteristic(C.Model, 'RoomIQ')
      .setCharacteristic(C.SerialNumber, `${tid}-${zid}-${sid}`);
    const state = () => {
      const { thermostat, zone } = c.get(tid, zid);
      const sensor = zone.sensors.find((s) => s.id === sid);
      if (!sensor || !sensor.online || !iq.fresh(tid, zid))
        throw new CloudError('RoomIQ sensor is offline, stale, or refreshing');
      return { thermostat, sensor };
    };
    const reading = (key: 'temperature' | 'humidity' | 'battery'): number => {
      const value = state().sensor[key];
      if (value === undefined) throw new CloudError('RoomIQ measurement is unavailable');
      return value;
    };
    if (initial.temperature !== undefined || initial.raw.temperature !== undefined)
      b.bind(b.service(S.TemperatureSensor, accessory.displayName, 'temperature'), C.CurrentTemperature, () =>
        celsius(reading('temperature'), t.limits.unit),
      );
    if (initial.humidity !== undefined || initial.raw.humidity !== undefined)
      b.bind(
        b.service(S.HumiditySensor, `${accessory.displayName} Humidity`, 'humidity'),
        C.CurrentRelativeHumidity,
        () => reading('humidity'),
      );
    if (initial.battery !== undefined || initial.raw.has_battery === true) {
      const battery = b.service(S.Battery, `${accessory.displayName} Battery`, 'battery');
      b.bind(battery, C.BatteryLevel, () => reading('battery'));
      b.bind(battery, C.StatusLowBattery, () => (state().sensor.lowBattery ? 1 : 0));
      battery.setCharacteristic(C.ChargingState, C.ChargingState.NOT_CHARGEABLE);
    }
    const include = b.service(S.Switch, `Include ${initial.name}`, 'include');
    b.bind(
      include,
      C.On,
      () => {
        c.get(tid, zid);
        return iq.selected(tid, zid, sid);
      },
      async (value) => iq.include(tid, zid, sid, Boolean(value)),
    );
    b.removeUnused();
    this.listener = () => this.update();
    c.on('updated', this.listener);
    this.update();
  }
  update(): void {
    this.bindings.update();
  }
  destroy(): void {
    this.c.off('updated', this.listener);
  }
}
export class AutomationAccessory {
  private bindings: Bindings;
  private listener: () => void;
  private reset?: ReturnType<typeof setTimeout>;
  constructor(
    api: API,
    accessory: PlatformAccessory,
    private c: Coordinator,
    commands: Commands,
    id: string,
    log: Logger,
  ) {
    const C = api.hap.Characteristic;
    const S = api.hap.Service;
    const b = (this.bindings = new Bindings(api, accessory, log));
    const automation = c.state!.automations.find((a) => a.id === id)!;
    accessory.displayName = automation.name;
    accessory
      .getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Trane')
      .setCharacteristic(C.Model, 'Cloud automation')
      .setCharacteristic(C.SerialNumber, `automation-${id}`);
    const service = b.service(S.Switch, automation.name, 'activate');
    b.bind(
      service,
      C.On,
      () => {
        if (
          Date.now() - c.lastSuccess > c.config.staleAfterSeconds * 1000 ||
          !c.state?.automations.some((a) => a.id === id)
        )
          throw new CloudError('Automation state is unavailable');
        return false;
      },
      async (value) => {
        if (value) await commands.automation(id);
        this.reset = setTimeout(() => service.updateCharacteristic(C.On, false), 100);
        this.reset.unref();
      },
    );
    b.removeUnused();
    this.listener = () => this.update();
    c.on('updated', this.listener);
    this.update();
  }
  update(): void {
    this.bindings.update();
  }
  destroy(): void {
    clearTimeout(this.reset);
    this.c.off('updated', this.listener);
  }
}
