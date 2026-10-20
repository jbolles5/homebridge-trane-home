# Release verification record

Target: Homebridge 2.4.0 / Node.js 24.20.0, matching the supplied Raspberry Pi.
All development dependencies and execution use Docker. No host runtime was installed.

Version 0.1.0 carries forward the tested beta 2 functionality. Release checks use
Node.js 24.20.0 and Homebridge 2.4.0. The suite contains **52 tests in 12 files**,
including switch naming and cached-name migration regression coverage. The
October 20 release checks passed: all 52 tests, lint, TypeScript compilation, a
clean tarball install, and the actual Homebridge plugin-loader smoke check. npm
audit reported zero vulnerabilities, and publication of the exact tarball passed
a dry run. The dry run did not publish to npm.

## Owner-reported live validation

On October 19–20, 2026, the owner reported successful installation and operation
with two actual XL1050 thermostats on one Trane Home account, one zone each,
using Raspberry Pi / Homebridge OS, Homebridge 2.4.0, and Node.js 24.20.0.
Readings worked, the four generic switch labels were corrected and confirmed,
and the owner subsequently reported all their checks passed and continued
stability. This is the basis for the public release.

The report does not enumerate individual Siri sequences or every optional
hardware capability. RoomIQ, emergency heat, humidity equipment, and other
optional functions need validation on installations that use them. Automated
fixtures do not establish physical behavior for equipment absent from this pilot.

## Automated coverage

The test suite exercises:

- Trane sign-in payload/headers, shared login, private UUID persistence, invalid
  credentials, brand-origin restrictions, ETags, and multi-house ambiguity.
- Sanitized real-format XL1050 responses: two thermostats, NativeZone mapping,
  capabilities, grouped inventory, missing readings, null inactive setpoints,
  offline state, and status fallbacks.
- Fahrenheit/Celsius conversion, native rounding, heat/cool deadband, paired
  writes, separate device limits, no-op fan/humidity writes, and advertised PUT.
- Shared polling, cache freshness, 304 handling, offline isolation, serial
  mutations, read-only control blocking, delayed sparse response reconciliation,
  slow-response timing, response identity validation, and shutdown.
- Actual Homebridge HAP thermostat services, capability-gated equipment controls,
  custom diagnostics, optional RoomIQ jobs/readings/batteries, automation
  rejection/no-replay, and stable accessories across rename/reorder/restart.

Release verification commands:

```sh
docker build -t trane-homebridge-dev .
docker run --rm trane-homebridge-dev npm test
docker run --rm trane-homebridge-dev npm run lint
docker run --rm trane-homebridge-dev npm run build
docker compose run --rm dev npm audit
docker compose run --rm dev npm pack --pack-destination artifacts
docker compose run --rm dev node test/package-smoke.mjs
```

The package is also installed into an empty temporary npm prefix inside Docker
with dev dependencies and install scripts omitted. Its entry point is imported
without a local Homebridge runtime dependency; registration is verified. A
Homebridge CLI smoke run checks discovery of the packaged plugin without Trane
credentials or cloud calls. `test/package-smoke.mjs` implements this check.

## Review

An independent source review identified sparse-response command ordering, null
inactive setpoints, empty status fallback, automation failure envelopes, and
post-response settling timing. These were reproduced with failing tests and
fixed. No real Trane credentials were used for automated checks.

## Acceptance for new installations

Follow [installation and live testing](installation.md) to compare readings,
verify control of each thermostat independently, check hold and schedule behavior,
and confirm stable identities after restart. Test Siri and optional equipment
only where used. Cloud behavior may differ across accounts and firmware.
