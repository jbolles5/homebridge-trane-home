// Run inside Docker after packing; this test never supplies cloud credentials.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const prefix = '/tmp/trane-package-smoke';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const packageFile = resolve(`artifacts/homebridge-trane-home-${version}.tgz`);
const install = spawn(
  'npm',
  ['install', '--prefix', prefix, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', packageFile],
  { stdio: 'inherit' },
);
assert.equal(await new Promise((resolve) => install.on('close', resolve)), 0, 'tarball installation');
const entry = await import(pathToFileURL(`${prefix}/node_modules/homebridge-trane-home/dist/index.js`).href);
let registration;
entry.default({
  registerPlatform: (...args) => {
    registration = args;
  },
});
assert.equal(registration[0], 'homebridge-trane-home');
assert.equal(registration[1], 'TraneHome');
assert.equal(typeof registration[2], 'function');

const storage = '/tmp/trane-homebridge-smoke';
await mkdir(storage, { recursive: true });
await writeFile(
  `${storage}/config.json`,
  JSON.stringify({
    bridge: { name: 'Trane Package Smoke', username: '0E:00:00:00:00:91', port: 51991, pin: '031-45-154' },
    platforms: [{ platform: 'TraneHome', name: 'Trane Home' }],
  }),
);
const child = spawn(process.execPath, [
  'node_modules/homebridge/bin/homebridge.js',
  '-U',
  storage,
  '-P',
  `${prefix}/node_modules`,
  '--strict-plugin-resolution',
  '--no-qrcode',
]);
let output = '';
let sawStartup = false;
const collect = (chunk) => {
  output += chunk.toString();
  if (output.includes('homebridge-trane-home.TraneHome') && output.includes('Configure username')) {
    sawStartup = true;
    child.kill('SIGTERM');
  }
};
child.stdout.on('data', collect);
child.stderr.on('data', collect);
const timeout = setTimeout(() => child.kill('SIGTERM'), 12000);
await new Promise((resolve) => child.on('close', resolve));
clearTimeout(timeout);
assert.ok(sawStartup, `Packaged Homebridge plugin did not register cleanly:\n${output}`);
console.log(
  'PASS: clean tarball install, dependency-free entry point, and Homebridge 2.4.0 plugin loading. No cloud credentials or commands used.',
);
