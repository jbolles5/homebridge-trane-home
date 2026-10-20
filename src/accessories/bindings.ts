import type {
  API,
  Characteristic,
  CharacteristicValue,
  Logger,
  PlatformAccessory,
  Service,
  WithUUID,
} from 'homebridge';
import { CloudError } from '../api/client.js';
export class Bindings {
  private reads: { characteristic: Characteristic; read: () => CharacteristicValue }[] = [];
  readonly used = new Set<Service>();
  constructor(
    public api: API,
    public accessory: PlatformAccessory,
    private log: Logger,
  ) {}
  service(type: WithUUID<typeof Service>, name: string, subtype: string): Service {
    const service =
      this.accessory.getServiceById(type, subtype) ?? this.accessory.addService(type, name, subtype);
    this.used.add(service);
    service.displayName = name;
    service.setCharacteristic(this.api.hap.Characteristic.Name, name);
    service.getCharacteristic(this.api.hap.Characteristic.Name).onGet(() => name);
    if (type.UUID === this.api.hap.Service.Switch.UUID) {
      const C = this.api.hap.Characteristic;
      if (!service.testCharacteristic(C.ConfiguredName)) service.addOptionalCharacteristic(C.ConfiguredName);
      const configured = service.getCharacteristic(C.ConfiguredName);
      const defaults: Record<string, string> = this.accessory.context.defaultSwitchNames ?? {};
      const current = typeof configured.value === 'string' ? configured.value : '';
      if (!current || current === defaults[subtype] || /^switch\s+\d+$/i.test(current)) {
        configured.updateValue(name);
      }
      // Replace the cached-accessory availability guards for this local metadata.
      // HomeKit applies user edits to the characteristic and persists them in its cache.
      configured.onGet(() => configured.value ?? name);
      configured.onSet(() => {});
      defaults[subtype] = name;
      this.accessory.context.defaultSwitchNames = defaults;
    }
    return service;
  }
  bind(
    service: Service,
    type: WithUUID<new () => Characteristic>,
    read: () => CharacteristicValue,
    write?: (value: CharacteristicValue) => Promise<void>,
  ): Characteristic {
    const characteristic = service.getCharacteristic(type);
    // Initialize before setProps validates the existing value against device-specific limits.
    try {
      characteristic.value = read();
    } catch {
      /* Availability is reported through the handlers. */
    }
    characteristic.onGet(() => {
      try {
        return read();
      } catch {
        throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });
    if (write)
      characteristic.onSet(async (value) => {
        try {
          await write(value);
        } catch (error) {
          this.log.warn(
            error instanceof CloudError
              ? error.message
              : 'Thermostat command failed; state will be refreshed',
          );
          throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
      });
    this.reads.push({ characteristic, read });
    return characteristic;
  }
  update(): void {
    for (const { characteristic, read } of this.reads) {
      try {
        characteristic.updateValue(read());
      } catch {
        characteristic.updateValue(
          new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE),
        );
      }
    }
  }
  removeUnused(): void {
    for (const service of [...this.accessory.services]) {
      if (service.UUID !== this.api.hap.Service.AccessoryInformation.UUID && !this.used.has(service))
        this.accessory.removeService(service);
    }
  }
}
