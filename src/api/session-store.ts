import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
export async function loadDeviceId(path: string): Promise<string> {
  try {
    const state: unknown = JSON.parse(await readFile(path, 'utf8'));
    const id = (state as { deviceUuid?: unknown })?.deviceUuid;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid device state');
    await chmod(path, 0o600);
    return id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Cannot read device state; preserve the file and repair it before restarting', {
        cause: error,
      });
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deviceUuid = randomUUID();
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ deviceUuid }), { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
  return deviceUuid;
}
