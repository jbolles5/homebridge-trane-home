# Upstream reference

Implementation target: two XL1050 thermostats on one Trane account, one zone each.

Retrieved October 19, 2026:

- Nexia master SHA: `3a2b7d8461cecaba45ce35ba34c79b0173f426d9`.
- Nexia constants identify version `2.13.0`.
- Home Assistant dev SHA: `4f8f886a0b852e415c179aaf718b19c8906edb64`.
- Development Homebridge: `2.4.0`, matching the owner's server.

The initial review used browser snapshots. Implementation also retrieved direct
source for Nexia `home.py`, `zone.py`, `thermostat.py`, `roomiq.py`, `sensor.py`,
`automation.py`, and `const.py`, plus HA service registration. Those source files
were fetched from mutable master/dev branches after recording their heads; the
XL1050 fixtures and license were fetched using the pinned Nexia SHA above.

Fixture provenance:
`tests/fixtures/single_zone_xl1050.json` at the pinned Nexia revision. Our
`test/fixtures/two-xl1050.json` retains a reduced protocol structure, substitutes
synthetic IDs/names/readings, removes advanced device identifiers and unrelated
metadata, and clones a second thermostat to test independent control.

Protocol notes:

- Trane root: `https://www.tranehome.com`; mobile paths under `/mobile`.
- Sign in: `POST /mobile/accounts/sign_in`; persistent device UUID.
- Session discovery: `POST /mobile/session`; house reads with conditional GET.
- Thermostat/zone actions use advertised POST/PUT links when available.
- Action links may contain a legacy Nexia brand origin; only known brand origins
  are accepted and links are rewritten to the configured account origin.
- Requested compressor speed is an alias of reported compressor speed in the
  upstream mobile implementation; it is not an independent measurement.
- RoomIQ selection copies the sensor array, distributes weights equally among
  selected sensors, and polls the returned announcement URL for completion.
- Sparse successful writes trigger a delayed fresh house read before later
  mutations are allowed to use cache-based comparisons.

No knowledge graph project matched this repository in the review session.
The graph tools were unavailable during implementation. Source inspection and
behavior tests were used; no graph coverage or exhaustive upstream audit is claimed.
