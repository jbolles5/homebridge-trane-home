import { EventEmitter } from 'node:events';
import type { Config } from './config.js';
import { parseHouse, object, type House, type Thermostat, type Zone, type Wire } from './api/models.js';
import { AuthError, CloudError } from './api/client.js';
export interface CloudClient {
  house(etag?: string): Promise<{ data?: unknown; etag?: string }>;
  request(path: string, method?: string, body?: unknown): Promise<unknown>;
  close(): void;
}
export class Coordinator extends EventEmitter {
  state?: House;
  lastSuccess = 0;
  private etag?: string;
  private tail: Promise<unknown> = Promise.resolve();
  private refreshing?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private reconciliation?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private failures = 0;
  private dirtyAt?: number;
  private shutdown = new AbortController();
  constructor(
    public config: Config,
    public client: CloudClient,
  ) {
    super();
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(() => {
      if (this.stopped) throw new CloudError('Plugin is shutting down');
      return operation();
    });
    this.tail = pending.catch(() => {});
    return pending;
  }
  readTask<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(operation);
  }
  async refresh(force = false): Promise<void> {
    if (!this.refreshing)
      this.refreshing = this.enqueue(async () => {
        await this.settle();
        await this.fetchHouse(force || this.dirtyAt !== undefined);
      }).finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  private async fetchHouse(force = false): Promise<void> {
    const response = await this.client.house(force ? undefined : this.etag);
    if (this.stopped) return;
    if (response.data !== undefined) {
      const next = parseHouse(response.data);
      this.state = next;
      this.etag = response.etag;
      this.dirtyAt = undefined;
    } else if (!this.state || (force && this.dirtyAt !== undefined))
      throw new CloudError('Cloud returned no fresh house state');
    this.lastSuccess = Date.now();
    this.emit('updated');
  }
  private async settle(): Promise<void> {
    if (this.dirtyAt === undefined) return;
    const wait = Math.max(0, this.dirtyAt + 7000 - Date.now());
    if (!wait) return;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        this.shutdown.signal.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(finish, wait);
      const abort = () => {
        clearTimeout(timer);
        reject(new CloudError('Plugin is shutting down'));
      };
      this.shutdown.signal.addEventListener('abort', abort, { once: true });
    });
  }
  notePendingWrite(): void {
    this.dirtyAt = Date.now();
  }
  async mutate(operation: () => Promise<void>): Promise<void> {
    if (this.config.readOnly)
      throw new CloudError('Plugin is in read-only mode; disable readOnly in settings to enable control');
    return this.enqueue(async () => {
      if (this.dirtyAt !== undefined) {
        await this.settle();
        await this.fetchHouse(true);
      }
      try {
        await operation();
      } finally {
        this.etag = undefined;
        this.reconcileSoon();
      }
    });
  }
  get(thermostatId: string, zoneId: string): { thermostat: Thermostat; zone: Zone } {
    if (this.stopped || !this.state || Date.now() - this.lastSuccess > this.config.staleAfterSeconds * 1000)
      throw new CloudError('Trane state is stale or unavailable');
    const thermostat = this.state.thermostats.find((t) => t.id === thermostatId);
    const zone = thermostat?.zones.find((z) => z.id === zoneId);
    if (!thermostat || !zone) throw new CloudError('Thermostat or zone no longer exists');
    if (!thermostat.online) throw new CloudError('Thermostat is offline');
    return { thermostat, zone };
  }
  acceptUpdate(thermostatId: string, zoneId: string | undefined, response: unknown): void {
    if (!this.state || this.stopped) return;
    const result = object(object(response).result);
    if (Object.keys(result).length < 3) return;
    const target = this.state.thermostats.find((t) => t.id === thermostatId);
    const rawTarget = zoneId === undefined ? target?.raw : target?.zones.find((z) => z.id === zoneId)?.raw;
    if (!rawTarget || String(result.id) !== String(rawTarget.id)) return;
    // Parse a copy first: malformed write responses must not corrupt the good cache.
    const devices = this.state.thermostats.map((t) => {
      if (t.id !== thermostatId) return t.raw;
      if (zoneId === undefined) return { ...t.raw, ...result };
      return { ...t.raw, zones: t.zones.map((z) => (z.id === zoneId ? { ...z.raw, ...result } : z.raw)) };
    });
    const envelope: Wire = {
      result: {
        id: this.state.id,
        name: this.state.name,
        _links: {
          child: [
            { href: '/devices', data: { items: devices } },
            { href: '/automations', data: { items: this.state.automations.map((a) => a.raw) } },
          ],
        },
      },
    };
    this.state = parseHouse(envelope);
    this.dirtyAt = undefined;
    this.emit('updated');
  }
  reconcileSoon(delay = 7000): void {
    if (this.stopped || this.reconciliation) return;
    this.reconciliation = setTimeout(() => {
      this.reconciliation = undefined;
      void this.refresh(true).catch((e) => this.emit('failure', e));
    }, delay);
    this.reconciliation.unref();
  }
  start(initialDelaySeconds = 0): void {
    this.stopped = false;
    clearTimeout(this.timer);
    const poll = async () => {
      let delay = this.config.pollIntervalSeconds;
      try {
        await this.refresh();
        this.failures = 0;
      } catch (error) {
        if (this.stopped) return;
        this.failures++;
        this.emit('failure', error);
        if (error instanceof AuthError) return;
        delay = Math.max(
          Math.min(this.config.pollIntervalSeconds * 2 ** Math.min(this.failures, 4), 1800),
          error instanceof CloudError ? (error.retryAfterSeconds ?? 0) : 0,
        );
      }
      if (!this.stopped) {
        this.timer = setTimeout(() => void poll(), delay * 1000 * (1 + Math.random() * 0.05));
        this.timer.unref();
      }
    };
    if (initialDelaySeconds > 0) {
      this.timer = setTimeout(() => void poll(), initialDelaySeconds * 1000);
      this.timer.unref();
    } else void poll();
  }
  stop(): void {
    this.stopped = true;
    this.shutdown.abort();
    clearTimeout(this.timer);
    clearTimeout(this.reconciliation);
    this.client.close();
  }
}
