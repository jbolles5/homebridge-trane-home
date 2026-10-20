# Install Trane Home on Homebridge OS

Tested by the owner on Raspberry Pi / Homebridge OS with Homebridge 2.4.0 and
Node.js 24.20.0. The usual Homebridge UI address is `http://homebridge.local:8581/`.
Use your server's address if different. See [testing](testing.md) for verification.

## What you need

**Updating from a beta:** install version 0.1.0 using the command below and
restart the Trane child bridge. Existing accessories and service IDs are
preserved. Permanent Hold, Fan Auto, Fan On, and Fan Circulate have explicit
labels prefixed by the thermostat name. Reopen Apple Home to refresh its display.
No bridge reset or re-pairing is required.

- Download `homebridge-trane-home-0.1.0.tgz` from the
  [GitHub release](https://github.com/jbolles5/homebridge-trane-home/releases/tag/v0.1.0).
  The npm submission is prepared but has not yet been published.
- Administrator access to your Homebridge UI, and a way to copy a file to the
  Raspberry Pi: SSH/SCP or SFTP. The Pi OS username is separate from the UI login.
- Your Trane Home account email/password, entered directly in the plugin UI.
  Do not paste credentials into chat, shell commands, logs, or this repository.
- The phone with Apple Home for pairing and comparing readings.

## 1. Copy the package to the Raspberry Pi

From a terminal in the directory containing your download, substitute your Pi OS username:

```sh
scp ./homebridge-trane-home-0.1.0.tgz YOUR_PI_USER@homebridge.local:/tmp/
```

SFTP to `/tmp/` is equivalent. If `.local` resolution is unavailable on your
network, substitute the Pi's LAN IP. Do not use your Homebridge UI credentials
as an assumed SSH account.

## 2. Install into the Homebridge OS plugin directory

Run the following on the Raspberry Pi, through SSH or the Homebridge UI terminal,
not in the Mac's terminal. Some shells do not include Homebridge's bundled
runtime in PATH. Add its existing directory before verifying:

```sh
export PATH="/opt/homebridge/bin:$PATH"
node --version
npm --version
```

If npm still cannot be found, check `ls -l /opt/homebridge/bin/node
/opt/homebridge/bin/npm` and inspect the result before continuing. Do not install
a second Node/npm runtime to work around this.

Install the local tarball:

```sh
npm --prefix /var/lib/homebridge install --omit=dev --ignore-scripts /tmp/homebridge-trane-home-0.1.0.tgz
```

If using SSH instead of the UI terminal, enter the managed shell first with
`sudo hb-shell`, then run the same npm command. If permissions are denied in
that shell, use an administrator shell with the Homebridge-managed runtime;
do not install a different Node version or redirect installation to a random
global prefix. The standard Homebridge OS plugin directory is
`/var/lib/homebridge/node_modules`.

The plugin has no production dependencies or install scripts and includes its
compiled JavaScript. The command installs this plugin using the existing Pi
runtime; it does not build the project on the Pi.

Homebridge's official [Raspberry Pi installation reference](https://github.com/homebridge/homebridge/wiki/Install-Homebridge-on-Raspbian#configuration-reference)
documents the storage/plugin paths and managed shell. `hb-service add` validates
registry package names, so use the local npm tarball command above for this release tarball.

## 3. Configure an isolated child bridge

1. In the Homebridge UI, confirm **Trane Home / homebridge-trane-home** appears
   among installed plugins. Refresh the page or restart Homebridge if needed.
2. Open its settings. Enter your Trane email and password and leave brand Trane.
3. Keep **Read-only discovery** enabled. Leave RoomIQ, automations, emergency heat,
   and other optional equipment controls off for the first test.
4. Enable the plugin's child bridge through Homebridge's bridge settings and save.
   Let the UI allocate its identity/port; do not copy another bridge's identity.
5. Restart the child bridge, or Homebridge if needed to load the new plugin.

If the settings form is unavailable, add the minimal platform block from the
README to the existing `platforms` array. Do not replace the entire config.

## 4. First live test: credentials and read-only discovery

Watch the Homebridge logs. Expected first run:

- Plugin loads without engine/module errors.
- `Read-only discovery enabled; thermostat commands are blocked`.
- A zone registration message for each discovered thermostat, on first discovery.
  A later restart restores them without creating duplicates.

Confirm both controls show the correct current temperatures and humidity when
available. Pair the child bridge in Apple Home using its QR code and assign each
thermostat to its room. Pairing and reading do not change HVAC settings.

Change a thermostat's temperature through the Trane app and confirm Apple Home
reflects it after the next poll, normally about two minutes. A HomeKit write
attempt during this pilot should fail with a communication error because
read-only mode deliberately rejects control.

If login is rejected, the plugin stops automatic authentication attempts.
Check credentials by signing into the Trane app/website, correct the plugin
settings, and restart the child bridge. Account challenges/MFA flows are not
implemented. For multiple houses, set the numeric house ID explicitly. Never
publish raw cloud responses or a Homebridge config containing credentials.

## 5. Second live test: controlled writes

1. Record both thermostats' operating mode, heat/cool targets, and hold state.
2. Disable **Read-only discovery**, save, and restart the child bridge.
3. Change only thermostat 1 by one native degree from Apple Home. Verify the
   change on the wall thermostat and in Trane Home, then restore it.
4. Repeat for thermostat 2; verify the other thermostat did not change.
5. Test Heat/Cool/Auto/Off, Auto low/high thresholds, Permanent Hold and Resume
   Schedule. Restore the original settings. Mode selection can establish hold;
   merely selecting Auto does not resume the Trane schedule.
6. Test Siri and confirm the client sends supported target/range sequences.
7. Add optional equipment controls individually after checking the hardware
   supports them. RoomIQ and vendor automations should be a separate test.
8. Restart Homebridge and verify accessories retain their Apple Home identities
   and rooms. Leave the bridge running for 24 hours and check reconnection and
   update latency before relying on it routinely.

For sparse cloud replies, a later command may wait around seven seconds plus a
fresh read. Do not repeatedly tap controls while a request is completing. Report
consistent slow-write warnings with redacted logs so the behavior can be tuned.

## Troubleshooting and rollback

- **No devices:** verify the account/brand/house and device allowlist; both units
  must appear in Trane Home. Do not remove/re-pair the Homebridge bridge first.
- **No Response:** check read-only mode, connectivity, device online status, and
  freshness. HomeKit reads do not each force a new cloud poll.
- **Auto/Siri target errors:** use the heat/cool range; the plugin intentionally
  rejects single-target Auto writes because Auto uses the low/high range.
- **Unexpected optional tiles:** turn options off and restart. Optional services
  on thermostat accessories are removed; separately registered sensor/automation
  accessories are retained unavailable and may need explicit cached-accessory
  removal in the UI.
- **Stop testing:** enable read-only or stop the child bridge. Restore any
  thermostat settings changed during the pilot using Trane Home.
- **Uninstall:** disable/remove this plugin's platform configuration and uninstall
  `homebridge-trane-home` through the UI. Remove its child bridge from Apple Home
  only if you intend to discard those HomeKit accessories. Preserve the private
  `trane-home` storage files for a later reinstall.

Share the plugin version, Homebridge/Node versions, whether two devices were
discovered, and sanitized error messages. Credentials, API keys, cookies, and full
configuration files are not needed for troubleshooting.
