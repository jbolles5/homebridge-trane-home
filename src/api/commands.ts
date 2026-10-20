import type { Coordinator } from '../coordinator.js';
import type { Range } from '../domain/temperature.js';
import { native, normalize } from '../domain/temperature.js';
import { feature, object, type Wire, type Choice, type Option } from './models.js';
import { CloudError } from './client.js';
export type SettingCommand = 'fan' | 'fanSpeed' | 'emergencyHeat' | 'humidify' | 'dehumidify' | 'airCleaner';
export class Commands {
  private batches = new Map<
    string,
    {
      timer: ReturnType<typeof setTimeout>;
      change: Partial<Range>;
      waiters: { resolve: () => void; reject: (error: unknown) => void }[];
    }
  >();
  constructor(public coordinator: Coordinator) {}
  private async write(
    tid: string,
    zid: string | undefined,
    raw: Wire,
    action: string,
    fallback: string,
    payload: unknown,
  ): Promise<void> {
    const actions = object(raw.actions);
    const link = object(actions.self ?? actions[action]);
    const path = typeof link.href === 'string' ? link.href : fallback;
    const method = typeof link.method === 'string' ? link.method.toUpperCase() : 'POST';
    this.coordinator.notePendingWrite();
    let response: unknown;
    try {
      response = await this.coordinator.client.request(path, method, payload);
    } finally {
      // Vendor propagation starts after completion, including ambiguous timeouts.
      this.coordinator.notePendingWrite();
    }
    if (object(response).success === false) throw new CloudError('Trane rejected the requested change');
    this.coordinator.acceptUpdate(tid, zid, response);
  }
  private async writeHold(tid: string, zid: string, hold: boolean): Promise<void> {
    const { zone } = this.coordinator.get(tid, zid);
    if (zone.hold === hold) return;
    if (!zone.runMode) {
      if (!hold) await this.write(tid, zid, {}, '', `/mobile/xxl_zones/${zone.apiId}/return_to_schedule`, {});
      return;
    }
    const values = hold ? ['permanent_hold', 'hold'] : ['run_schedule', 'schedule'];
    const value = zone.runMode.options.find((o) => values.includes(String(o.value)))?.value ?? values[0];
    await this.write(
      tid,
      zid,
      zone.runMode.raw,
      'update_thermostat_run_mode',
      `/mobile/xxl_zones/${zone.apiId}/run_mode`,
      { value },
    );
  }
  async mode(tid: string, zid: string, mode: string): Promise<void> {
    await this.coordinator.mutate(async () => {
      let { zone } = this.coordinator.get(tid, zid);
      if (!zone.modes.includes(mode)) throw new CloudError('Unsupported HVAC mode');
      if (mode !== 'AUTO') await this.writeHold(tid, zid, true);
      ({ zone } = this.coordinator.get(tid, zid));
      if (zone.mode === mode) return;
      await this.write(
        tid,
        zid,
        feature(zone.raw, 'thermostat_mode'),
        'update_thermostat_mode',
        `/mobile/xxl_zones/${zone.apiId}/zone_mode`,
        { value: mode },
      );
    });
  }
  async hold(tid: string, zid: string, hold: boolean): Promise<void> {
    return this.coordinator.mutate(() => this.writeHold(tid, zid, hold));
  }
  async targets(tid: string, zid: string, change: Partial<Range>): Promise<void> {
    if (this.coordinator.config.readOnly) throw new CloudError('Plugin is in read-only mode');
    const key = `${tid}:${zid}`;
    return new Promise<void>((resolve, reject) => {
      let batch = this.batches.get(key);
      if (!batch) {
        batch = { timer: setTimeout(() => {}, 0), change: {}, waiters: [] };
        this.batches.set(key, batch);
      }
      clearTimeout(batch.timer);
      Object.assign(batch.change, change);
      batch.waiters.push({ resolve, reject });
      const pending = batch;
      pending.timer = setTimeout(() => {
        this.batches.delete(key);
        void this.coordinator
          .mutate(async () => {
            const { thermostat, zone } = this.coordinator.get(tid, zid);
            if (zone.mode === 'OFF')
              throw new CloudError('Select Heat, Cool or Auto before changing temperature');
            const nativeChange: Partial<Range> = {};
            if (pending.change.heat !== undefined)
              nativeChange.heat = native(pending.change.heat, thermostat.limits.unit);
            if (pending.change.cool !== undefined)
              nativeChange.cool = native(pending.change.cool, thermostat.limits.unit);
            const pair = normalize(zone.targets, nativeChange, thermostat.limits);
            if (this.coordinator.config.holdOnSetpointChange) await this.writeHold(tid, zid, true);
            if (pair.heat === zone.targets.heat && pair.cool === zone.targets.cool) return;
            await this.write(
              tid,
              zid,
              feature(zone.raw, 'thermostat'),
              'set_setpoints',
              `/mobile/xxl_zones/${zone.apiId}/setpoints`,
              pair,
            );
          })
          .then(
            () => pending.waiters.forEach((w) => w.resolve()),
            (e) => pending.waiters.forEach((w) => w.reject(e)),
          );
      }, 250);
    });
  }
  async setting(tid: string, zid: string, key: SettingCommand, value: Option['value']): Promise<void> {
    return this.coordinator.mutate(async () => {
      const { thermostat } = this.coordinator.get(tid, zid);
      const selected: Choice | undefined = thermostat[key];
      if (!selected) throw new CloudError('Unsupported thermostat feature');
      let target = value;
      if (['humidify', 'dehumidify', 'fanSpeed'].includes(key)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || !selected.values.length)
          throw new CloudError('Unsupported numeric setpoint');
        const fraction = value / 100;
        target = selected.values.reduce(
          (best, v) => (Math.abs(v - fraction) < Math.abs(best - fraction) ? v : best),
          selected.values[0]!,
        );
      } else if (!selected.options.some((o) => String(o.value) === String(target)))
        throw new CloudError('Unsupported setting value');
      if (String(selected.value) === String(target)) return;
      const map: Record<SettingCommand, [string, string]> = {
        fan: ['fan_mode', 'update_thermostat_fan_mode'],
        fanSpeed: ['fan_speed', 'fan_speed'],
        emergencyHeat: ['emergency_heat', 'emergency_heat'],
        humidify: ['humidify', 'humidify'],
        dehumidify: ['dehumidify', 'dehumidify'],
        airCleaner: ['air_cleaner_mode', 'air_cleaner_mode'],
      };
      const [endpoint, action] = map[key];
      const raw = key === 'fan' ? feature(thermostat.raw, 'thermostat_fan_mode') : selected.raw;
      const payloadValue =
        key === 'emergencyHeat'
          ? String(target)
          : key === 'humidify' || key === 'dehumidify'
            ? String(target)
            : target;
      await this.write(tid, undefined, raw, action, `/mobile/xxl_thermostats/${thermostat.id}/${endpoint}`, {
        value: payloadValue,
      });
    });
  }
  async preset(tid: string, zid: string, value: Option['value']): Promise<void> {
    return this.coordinator.mutate(async () => {
      const { zone } = this.coordinator.get(tid, zid);
      const choice = zone.preset;
      if (!choice || !choice.options.some((o) => o.value === value))
        throw new CloudError('Unsupported preset');
      if (choice.value === value) return;
      await this.write(tid, zid, choice.raw, 'type', `/mobile/xxl_zones/${zone.apiId}/preset_selected`, {
        value,
      });
    });
  }
  async automation(id: string): Promise<void> {
    return this.coordinator.mutate(async () => {
      if (!this.coordinator.state?.automations.some((a) => a.id === id))
        throw new CloudError('Unknown automation');
      this.coordinator.notePendingWrite();
      let response: unknown;
      try {
        response = await this.coordinator.client.request(`/mobile/automations/${id}/activate`, 'POST', '');
      } finally {
        this.coordinator.notePendingWrite();
      }
      if (object(response).success === false) throw new CloudError('Trane rejected the automation');
    });
  }
  stop(): void {
    for (const batch of this.batches.values()) {
      clearTimeout(batch.timer);
      batch.waiters.forEach((w) => w.reject(new CloudError('Plugin is shutting down')));
    }
    this.batches.clear();
  }
}
