# Homebridge Trane Home

Homebridge platform for Trane Home XL1050 thermostats. Connects thermostats on one account using one shared cloud connection and one
HomeKit thermostat accessory per zone. It does not require Home Assistant.

Target environment: **Homebridge 2.4.x and Node.js 24**, including Homebridge OS on
Raspberry Pi. The package contains JavaScript only and no production npm
dependencies. No compiling or Docker is needed on the Raspberry Pi.

Version **0.1.0** is the first public source release. The owner reports successful
operation and continued stability with **two XL1050 thermostats, one zone each,
on the same Trane Home account**, using Homebridge **2.4.0**, Node.js **24.20.0**,
and Raspberry Pi / Homebridge OS. The named Hold and Fan controls have also been
confirmed in Apple Home. See the [verification record](docs/testing.md) for scope.

## Installation

Download the compiled package from the [v0.1.0 release](https://github.com/jbolles5/homebridge-trane-home/releases/tag/v0.1.0).
Follow [Homebridge OS installation](docs/installation.md) to install the tarball,
configure a child bridge, and pair it in Apple Home. **Start with `readOnly: true`**
to verify discovery before enabling control.

The npm package is prepared for submission; **npm publication is pending**.
Once published, search the Homebridge UI for `homebridge-trane-home`. Until then,
use the GitHub release tarball. This project is independent of Trane and Apple
and is not a Homebridge Verified plugin.

Upgrading from the beta preserves accessory and service identities. The four
default switches are **Permanent Hold**, **Fan Auto**, **Fan On**, and **Fan
Circulate**, prefixed with the thermostat name. No bridge reset is required.

## Features

- Independent zone temperature, Heat/Cool targets, Auto ranges, and HVAC state.
- Thermostat humidity and Permanent Hold / Resume Schedule.
- Fan Auto/On/Circulate selectors, subject to advertised capabilities.
- Optional presets, variable fan speed, emergency heat, outdoor temperature,
  humidity targets, and air cleaner modes.
- Optional RoomIQ temperature/humidity/battery sensors and debounced inclusion
  switches. Extra polling is disabled by default.
- Optional Trane automations as momentary switches.
- Optional custom diagnostic and separate humidify/dehumidify characteristics
  for compatible third-party HomeKit apps.
- Stable accessory identities, private persistent device UUID, conditional
  polling, bounded requests, and no automatic replay of failed writes.

## Basic configuration

Configure in the plugin's Homebridge UI settings. Minimal platform block:

```json
{
  "platform": "TraneHome",
  "name": "Trane Home",
  "username": "YOUR_TRANE_ACCOUNT_EMAIL",
  "password": "YOUR_TRANE_ACCOUNT_PASSWORD",
  "brand": "trane",
  "readOnly": true,
  "pollIntervalSeconds": 120,
  "staleAfterSeconds": 360,
  "exposeFanModes": true
}
```

Never commit a configuration containing real credentials. Password masking is a
UI convenience, not encryption. Homebridge stores credentials in its config and
backups; restrict access accordingly. Device UUID state lives under the Homebridge
storage directory in `trane-home/`, with mode 0600. Preserve it across restarts.
API keys are held in memory and never placed in accessory context or logs.

## Behavior to know before enabling control

- HomeKit temperatures use Celsius internally even when Apple Home displays °F.
  Writes are converted, rounded to the device's native increment, and validated
  against limits/deadband. A one-sided change can move the opposite setpoint to
  preserve minimum separation; impossible ranges are rejected.
- Heat/Cool/Off mode selections establish permanent hold. Auto changes the HVAC
  mode while preserving hold. Turn the Permanent Hold switch **off** to resume
  the Trane schedule. These are separate controls.
- Changing temperature preserves existing schedule/hold state unless
  `holdOnSetpointChange` is enabled. Trane schedules may later change a setpoint.
- In Auto, use the low/high range. Single-target writes in Auto or Off are
  rejected. Client-specific Siri write sequences should be checked during each new
  installation.
- Fan/preset/air-cleaner switches are selectors: turn on the desired mode. Turning
  off the currently selected selector is rejected; choose another mode instead.
  Fan Auto does not turn the HVAC system off. The optional Blower accessory's
  Active state means continuous fan is requested; actual blower operation is a
  separate diagnostic.
- Shared polling defaults to two minutes. A sparse cloud write response causes a
  seven-second settling period and fresh house read before a later command uses
  cached state. The plugin may show delayed responses during these operations.
- Offline/stale data returns HomeKit communication errors. A temporary cloud
  failure does not remove accessories. Cached accessories absent from inventory
  are retained as unavailable; the plugin does not automatically delete them.
- Optional accessories disabled after being registered are retained as unavailable
  until removed through Homebridge's cached-accessory management. Individual
  optional services on thermostat accessories are reconciled automatically.
- RoomIQ readings stay unavailable until a current sensor refresh finishes.
  Selection is debounced four seconds; the cloud job may take 5–40 seconds.
  The switch write acknowledges acceptance, then confirmation happens in the
  background. A later failure restores confirmed state and logs a warning. At
  least one sensor must remain selected; add a replacement before removing the
  last active sensor. Selection changes while a job completes are rejected.
- A vendor automation switch activates once and resets locally. It is not an
  Apple Home scene, and failed/uncertain activations are never replayed.
- Humidity target follows mode: heating selects humidify, cooling dehumidify,
  Auto/Off changes both supported targets. Apple Home may not display every
  optional characteristic; separate targets and text diagnostics require a
  compatible HomeKit app. Requested compressor speed mirrors reported speed,
  matching the upstream mobile API; it is not an independent measurement.
- Other brands/thermostat models are untested. The cloud protocol is unofficial
  and can change; this is not a local-LAN control protocol.

## Development

Docker is required for dependencies, tests, and running this repository. Do not
install Node or npm on the development host to work around Docker failures.

```sh
docker compose run --rm dev npm ci
docker compose run --rm dev npm test
docker compose run --rm dev npm run lint
docker compose run --rm dev npm run build
docker compose run --rm dev npm pack --pack-destination artifacts
docker build -t trane-homebridge-dev .
docker run --rm trane-homebridge-dev npm test
```

Create the `artifacts` directory before packing. The dev compose service uses a
named dependency volume. CI uses the Dockerfile and lockfile for clean builds.
See [testing](docs/testing.md), the [changelog](CHANGELOG.md), and the
[npm release procedure](docs/publishing.md).

## Support

Report reproducible problems through [GitHub Issues](https://github.com/jbolles5/homebridge-trane-home/issues).
Include plugin, Homebridge, and Node versions with sanitized logs. Do not attach
credentials, full configuration files, or raw account responses.

## License and source

Apache-2.0; see LICENSE and NOTICE. Protocol and response formats were adapted
from [hvaclibs/nexia](https://github.com/hvaclibs/nexia). Feature behavior was
reviewed against [Home Assistant Nexia](https://www.home-assistant.io/integrations/nexia/).
Pinned references and fixture provenance are in `docs/reference/upstream.md`.
