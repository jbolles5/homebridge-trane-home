import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import type { CloudClient } from './coordinator.js';
import type { Config } from './config.js';
import { parseConfig } from './config.js';
import { Coordinator } from './coordinator.js';
import { NexiaClient, AuthError, CloudError } from './api/client.js';
import { Commands } from './api/commands.js';
import { loadDeviceId } from './api/session-store.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ThermostatAccessory } from './accessories/thermostat.js';
import { PLUGIN_NAME, PLATFORM_NAME } from './settings.js';
import { RoomIQ } from './roomiq.js';
import { AutomationAccessory, SensorAccessory } from './accessories/sensors.js';
export interface Dependencies {
  client: (config: Config, uuid: string) => CloudClient;
  deviceId: (path: string) => Promise<string>;
}
export class TranePlatform implements DynamicPlatformPlugin {
  private config?: Config;
  private cached = new Map<string, PlatformAccessory>();
  private adapters = new Map<string, ThermostatAccessory | SensorAccessory | AutomationAccessory>();
  private coordinator?: Coordinator;
  private commands?: Commands;
  private stopped = false;
  private launched = false;
  private roomiq?: RoomIQ;
  private roomTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private log: Logger,
    input: PlatformConfig,
    private api: API,
    private dependencies: Dependencies = {
      client: (config, uuid) => new NexiaClient(config, uuid),
      deviceId: loadDeviceId,
    },
  ) {
    try {
      this.config = parseConfig(input);
    } catch (error) {
      log.error(error instanceof Error ? error.message : 'Invalid Trane configuration');
    }
    api.on('didFinishLaunching', () => {
      void this.launch().catch(() =>
        log.error('Trane initialization failed; check the storage directory and configuration'),
      );
    });
    api.on('shutdown', () => this.stop());
  }
  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
    // Cached values are unavailable until a successful authenticated discovery.
    for (const service of accessory.services)
      if (service.UUID !== this.api.hap.Service.AccessoryInformation.UUID)
        for (const ch of service.characteristics) {
          ch.onGet(() => {
            throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          });
          if (ch.props.perms.includes(this.api.hap.Perms.PAIRED_WRITE))
            ch.onSet(() => {
              throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
            });
        }
  }
  async launch(): Promise<void> {
    if (this.launched || this.stopped || !this.config) return;
    this.launched = true;
    const config = this.config;
    const accountHash = createHash('sha256')
      .update(`${config.brand}:${config.username.toLowerCase()}:${config.houseId ?? 'default'}`)
      .digest('hex')
      .slice(0, 24);
    const uuid = await this.dependencies.deviceId(
      join(this.api.user.storagePath(), 'trane-home', `${accountHash}.json`),
    );
    if (this.stopped) return;
    const coordinator = new Coordinator(config, this.dependencies.client(config, uuid));
    this.coordinator = coordinator;
    this.commands = new Commands(coordinator);
    this.roomiq = new RoomIQ(coordinator);
    coordinator.on('updated', () => this.discover());
    coordinator.on('failure', (error) =>
      this.log.warn(
        error instanceof CloudError ? error.message : 'Trane refresh failed; cached accessories are retained',
      ),
    );
    this.log.info(
      config.readOnly
        ? 'Read-only discovery enabled; thermostat commands are blocked'
        : 'Thermostat control enabled',
    );
    try {
      await coordinator.refresh();
    } catch (error) {
      this.log.warn(
        error instanceof CloudError ? error.message : 'Trane discovery failed; check account and network',
      );
      if (error instanceof AuthError) return;
    }
    if (!this.stopped) coordinator.start(config.pollIntervalSeconds);
    if (config.enableRoomIQ && !this.stopped) {
      const refreshRoomIQ = async () => {
        try {
          await this.roomiq!.refreshSensors();
        } catch {
          if (!this.stopped) this.log.warn('RoomIQ refresh failed; thermostat controls remain available');
        }
        if (!this.stopped) {
          this.roomTimer = setTimeout(() => void refreshRoomIQ(), config.pollIntervalSeconds * 1000);
          this.roomTimer.unref();
        }
      };
      void refreshRoomIQ();
    }
  }
  private discover(): void {
    const state = this.coordinator?.state;
    if (!state || !this.config || !this.commands || this.stopped) return;
    const selected = state.thermostats.filter(
      (t) => !this.config!.thermostatIds.length || this.config!.thermostatIds.includes(t.id),
    );
    for (const t of selected)
      for (const z of t.zones) {
        const uuid = this.api.hap.uuid.generate(
          `${PLUGIN_NAME}:${this.config.brand}:${state.id}:${t.id}:${z.id}`,
        );
        let accessory = this.cached.get(uuid);
        const isNew = !accessory;
        if (!accessory) accessory = new this.api.platformAccessory(z.name, uuid);
        accessory.context = {
          ...accessory.context,
          kind: 'thermostat',
          houseId: state.id,
          thermostatId: t.id,
          zoneId: z.id,
        };
        // Rebind on new capability snapshots without changing the cached accessory identity.
        this.adapters.get(uuid)?.destroy();
        this.adapters.set(
          uuid,
          new ThermostatAccessory(
            this.api,
            accessory,
            this.coordinator!,
            this.commands,
            t.id,
            z.id,
            this.log,
          ),
        );
        this.cached.set(uuid, accessory);
        if (isNew) {
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.log.info('Discovered XL thermostat zone (%s); accessory registered', t.model);
        } else this.api.updatePlatformAccessories([accessory]);
        if (this.config.enableRoomIQ && z.sensors.length > 1)
          for (const sensor of z.sensors) {
            const sensorUuid = this.api.hap.uuid.generate(
              `${PLUGIN_NAME}:${this.config.brand}:${state.id}:${t.id}:${z.id}:sensor:${sensor.id}`,
            );
            this.extra(
              sensorUuid,
              sensor.name,
              (accessory) =>
                new SensorAccessory(
                  this.api,
                  accessory,
                  this.coordinator!,
                  this.roomiq!,
                  t.id,
                  z.id,
                  sensor.id,
                  this.log,
                ),
            );
          }
      }
    if (this.config.exposeAutomations)
      for (const automation of state.automations) {
        const uuid = this.api.hap.uuid.generate(
          `${PLUGIN_NAME}:${this.config.brand}:${state.id}:automation:${automation.id}`,
        );
        this.extra(
          uuid,
          automation.name,
          (accessory) =>
            new AutomationAccessory(
              this.api,
              accessory,
              this.coordinator!,
              this.commands!,
              automation.id,
              this.log,
            ),
        );
      }
  }
  private extra(
    uuid: string,
    name: string,
    create: (accessory: PlatformAccessory) => SensorAccessory | AutomationAccessory,
  ): void {
    let accessory = this.cached.get(uuid);
    const isNew = !accessory;
    if (!accessory) accessory = new this.api.platformAccessory(name, uuid);
    this.adapters.get(uuid)?.destroy();
    this.adapters.set(uuid, create(accessory));
    this.cached.set(uuid, accessory);
    if (isNew) this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    else this.api.updatePlatformAccessories([accessory]);
  }
  stop(): void {
    this.stopped = true;
    clearTimeout(this.roomTimer);
    this.roomiq?.stop();
    this.commands?.stop();
    this.coordinator?.stop();
    for (const adapter of this.adapters.values()) adapter.destroy();
    this.adapters.clear();
  }
}
