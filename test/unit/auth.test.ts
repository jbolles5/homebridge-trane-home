import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { NexiaClient, AuthError } from '../../src/api/client.js';
import { loadDeviceId } from '../../src/api/session-store.js';
import { parseConfig } from '../../src/config.js';

const config = () => parseConfig({ username: 'private@example.test', password: 'private-password' });
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers });
export function fakeCloud() {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/sign_in'))
      return json({ success: true, result: { mobile_id: 123, api_key: 'secret-token' } }, 200, {
        'set-cookie': 'session=private-cookie; Path=/; Secure; HttpOnly',
      });
    if (url.endsWith('/session'))
      return json({
        result: {
          _links: {
            child: [
              { href: 'https://www.mynexia.com/mobile/houses/100000', data: { id: 100000, name: 'Home' } },
              { href: '/mobile/news', data: { items: [] } },
            ],
          },
        },
      });
    return json({ success: true, result: {} });
  };
  return { calls, transport };
}
it('signs in once concurrently, discovers the house, and sends private authentication only to the brand origin', async () => {
  const cloud = fakeCloud();
  const client = new NexiaClient(config(), 'stable-device-id', cloud.transport);
  await Promise.all([client.login(), client.login()]);
  expect(cloud.calls.filter((c) => c.url.endsWith('/sign_in'))).toHaveLength(1);
  expect(JSON.parse(String(cloud.calls[0]?.init.body))).toMatchObject({
    login: 'private@example.test',
    password: 'private-password',
    device_uuid: 'stable-device-id',
    app_version: '6.0.0',
  });
  expect(client.houseId).toBe('100000');
  await client.request('/mobile/xxl_zones/100101/setpoints', 'POST', { heat: 68, cool: 74 });
  expect(new Headers(cloud.calls.at(-1)?.init.headers).get('X-ApiKey')).toBe('secret-token');
  expect(new Headers(cloud.calls.at(-1)?.init.headers).get('Cookie')).toContain('session=private-cookie');
  expect(cloud.calls.every((c) => new URL(c.url).origin === 'https://www.tranehome.com')).toBe(true);
  await expect(client.request('https://attacker.test/steal')).rejects.toThrow('origin');
});
it('stops repeated login after invalid credentials without leaking server error bodies', async () => {
  let calls = 0;
  const client = new NexiaClient(config(), 'device', async () => {
    calls++;
    return json({ success: false, error: 'private-password' }, 200);
  });
  await expect(client.login()).rejects.toBeInstanceOf(AuthError);
  await expect(client.login()).rejects.not.toThrow('private-password');
  expect(calls).toBe(1);
});
it('keeps cached data on 304 and sends the ETag', async () => {
  const cloud = fakeCloud();
  const client = new NexiaClient(config(), 'device', async (url, init) =>
    url.includes('/houses/') ? new Response(null, { status: 304 }) : cloud.transport(url, init),
  );
  await client.login();
  expect(await client.house('old-tag')).toEqual({});
});
it('does not silently choose a house when multiple houses exist', async () => {
  const cloud = fakeCloud();
  const client = new NexiaClient(config(), 'device', async (url, init) =>
    url.endsWith('/session')
      ? json({
          result: { _links: { child: [1, 2].map((id) => ({ href: `/mobile/houses/${id}`, data: { id } })) } },
        })
      : cloud.transport(url, init),
  );
  await expect(client.login()).rejects.toThrow('houseId');
});
it('reuses a private device UUID and refuses corrupt state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trane-test-'));
  const path = join(directory, 'state.json');
  try {
    const first = await loadDeviceId(path);
    expect(await loadDeviceId(path)).toBe(first);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ deviceUuid: first });
    await writeFile(path, 'broken');
    await expect(loadDeviceId(path)).rejects.toThrow('state');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
