import type { Coordinator } from './coordinator.js';
import { object } from './api/models.js';
import { CloudError } from './api/client.js';
interface Selection {
  ids: Set<string>;
  timer: ReturnType<typeof setTimeout>;
  waiters: { resolve: () => void; reject: (e: unknown) => void }[];
  busy: boolean;
}
export class RoomIQ {
  private selections = new Map<string, Selection>();
  private freshness = new Map<string, number>();
  private abort = new AbortController();
  private refreshing?: Promise<void>;
  constructor(private coordinator: Coordinator) {}
  private key(tid: string, zid: string): string {
    return `${tid}:${zid}`;
  }
  fresh(tid: string, zid: string): boolean {
    const timestamp = this.freshness.get(this.key(tid, zid));
    return (
      timestamp !== undefined && Date.now() - timestamp < this.coordinator.config.staleAfterSeconds * 1000
    );
  }
  selected(tid: string, zid: string, sensorId: string): boolean {
    const pending = this.selections.get(this.key(tid, zid));
    return pending
      ? pending.ids.has(sensorId)
      : (this.coordinator.get(tid, zid).zone.sensors.find((s) => s.id === sensorId)?.selected ?? false);
  }
  private async pause(ms: number): Promise<void> {
    if (this.abort.signal.aborted) throw new CloudError('RoomIQ stopped');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.abort.signal.removeEventListener('abort', stop);
        resolve();
      }, ms);
      timer.unref();
      const stop = () => {
        clearTimeout(timer);
        reject(new CloudError('RoomIQ stopped'));
      };
      this.abort.signal.addEventListener('abort', stop, { once: true });
    });
  }
  private async completion(response: unknown): Promise<void> {
    const path = object(object(response).result).polling_path;
    if (typeof path !== 'string') throw new CloudError('RoomIQ response has no completion URL');
    for (let i = 0; i < 8; i++) {
      await this.pause(5000);
      const result = await this.coordinator.readTask(() => this.coordinator.client.request(path));
      if (result === null) continue;
      if (object(result).status !== 'success') throw new CloudError('RoomIQ operation failed');
      return;
    }
    throw new CloudError('RoomIQ operation timed out');
  }
  async include(tid: string, zid: string, sensorId: string, enabled: boolean): Promise<void> {
    if (!this.coordinator.config.enableRoomIQ || this.coordinator.config.readOnly)
      throw new CloudError('RoomIQ selection is disabled or read-only');
    const { zone } = this.coordinator.get(tid, zid);
    const key = this.key(tid, zid);
    if (!zone.sensors.some((s) => s.id === sensorId)) throw new CloudError('Unknown RoomIQ sensor');
    let pending = this.selections.get(key);
    if (pending?.busy) throw new CloudError('RoomIQ selection is still completing; try again shortly');
    const ids = new Set(pending?.ids ?? zone.sensors.filter((s) => s.selected).map((s) => s.id));
    if (enabled) ids.add(sensorId);
    else ids.delete(sensorId);
    if (!ids.size) throw new CloudError('At least one sensor must remain selected');
    if (!pending) {
      pending = { ids, timer: setTimeout(() => {}, 0), waiters: [], busy: false };
      this.selections.set(key, pending);
    }
    pending.ids = ids;
    clearTimeout(pending.timer);
    const selection = pending;
    return new Promise<void>((resolve, reject) => {
      selection.waiters.push({ resolve, reject });
      selection.timer = setTimeout(() => {
        void this.sendSelection(tid, zid, selection);
      }, 4000);
    });
  }
  private async sendSelection(tid: string, zid: string, selection: Selection): Promise<void> {
    const key = this.key(tid, zid);
    selection.busy = true;
    try {
      let response: unknown;
      await this.coordinator.mutate(async () => {
        const { zone } = this.coordinator.get(tid, zid);
        const sensors = zone.sensors.map((s) => ({
          ...s.raw,
          weight: selection.ids.has(s.id) ? 1 / selection.ids.size : 0,
        }));
        this.coordinator.notePendingWrite();
        try {
          response = await this.coordinator.client.request(
            `/mobile/xxl_zones/${zone.apiId}/update_active_sensors`,
            'POST',
            { updated_sensors: sensors },
          );
        } finally {
          this.coordinator.notePendingWrite();
        }
        if (
          object(response).success === false ||
          typeof object(object(response).result).polling_path !== 'string'
        )
          throw new CloudError('Trane rejected RoomIQ selection');
      });
      selection.waiters.splice(0).forEach((w) => w.resolve());
      await this.completion(response);
      await this.coordinator.refresh(true);
    } catch (error) {
      selection.waiters.splice(0).forEach((w) => w.reject(error));
      if (!this.abort.signal.aborted) {
        this.coordinator.emit('failure', error);
        this.coordinator.reconcileSoon();
      }
    } finally {
      this.selections.delete(key);
      if (!this.abort.signal.aborted) this.coordinator.emit('updated');
    }
  }
  async refreshSensors(): Promise<void> {
    if (!this.coordinator.config.enableRoomIQ || this.abort.signal.aborted) return;
    if (!this.refreshing)
      this.refreshing = this.loadSensors().finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  private async loadSensors(): Promise<void> {
    const zones =
      this.coordinator.state?.thermostats
        .filter((t) => t.online)
        .flatMap((t) =>
          t.zones.filter((z) => z.sensors.length > 1).map((z) => ({ tid: t.id, zid: z.id, apiId: z.apiId })),
        ) ?? [];
    for (const { tid, zid, apiId } of zones) {
      if (this.selections.has(this.key(tid, zid))) continue;
      const response = await this.coordinator.readTask(() =>
        this.coordinator.client.request(
          `/mobile/xxl_zones/${apiId}/request_current_sensor_state`,
          'POST',
          {},
        ),
      );
      await this.completion(response);
      await this.coordinator.refresh(true);
      this.freshness.set(this.key(tid, zid), Date.now());
      this.coordinator.emit('updated');
    }
  }
  stop(): void {
    this.abort.abort();
    for (const pending of this.selections.values()) {
      clearTimeout(pending.timer);
      pending.waiters.forEach((w) => w.reject(new CloudError('RoomIQ stopped')));
    }
    this.selections.clear();
  }
}
