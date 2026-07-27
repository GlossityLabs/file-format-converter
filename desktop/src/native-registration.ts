import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { NATIVE_HOST_NAME } from './native-protocol.js';

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export interface NativeHostManifest {
  name: string;
  description: string;
  path: string;
  type: 'stdio';
  allowed_origins: string[];
}

export interface NativeHostRegistration {
  registered: boolean;
  manifestPath: string;
  extensionId?: string;
  extensionIds?: string[];
  executableMatches: boolean;
  canRegister?: boolean;
  reason?: string;
}

export function isValidExtensionId(value: string): boolean {
  return EXTENSION_ID_PATTERN.test(value.trim());
}

export function nativeHostManifestPath(homeDirectory = homedir()): string {
  return join(
    homeDirectory,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts',
    `${NATIVE_HOST_NAME}.json`,
  );
}

export function isInstalledApplicationExecutable(
  executablePath: string,
  homeDirectory = homedir(),
): boolean {
  const normalizedExecutable = resolve(executablePath);
  const expectedExecutables = [
    join('/Applications', 'Format Forge.app', 'Contents', 'MacOS', 'Format Forge'),
    join(homeDirectory, 'Applications', 'Format Forge.app', 'Contents', 'MacOS', 'Format Forge'),
  ].map((path) => resolve(path));
  return expectedExecutables.includes(normalizedExecutable);
}

export function createNativeHostManifest(
  executablePath: string,
  extensionIds: string | readonly string[],
): NativeHostManifest {
  const normalizedIds = [
    ...new Set(
      (typeof extensionIds === 'string' ? [extensionIds] : extensionIds)
        .map((extensionId) => extensionId.trim())
        .filter(Boolean),
    ),
  ];
  if (normalizedIds.length === 0 || normalizedIds.some((extensionId) => !isValidExtensionId(extensionId))) {
    throw new Error('Chrome extension IDs contain exactly 32 letters from a through p.');
  }
  if (!executablePath.startsWith('/')) {
    throw new Error('The native host executable path must be absolute.');
  }
  return {
    name: NATIVE_HOST_NAME,
    description: 'Starts the private Format Forge conversion engine for Chrome.',
    path: executablePath,
    type: 'stdio',
    allowed_origins: normalizedIds.map((extensionId) => `chrome-extension://${extensionId}/`),
  };
}

export async function readNativeHostRegistration(
  executablePath: string,
  manifestPath = nativeHostManifestPath(),
): Promise<NativeHostRegistration> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<NativeHostManifest>;
    const origins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
    const extensionIds = origins.flatMap((origin) => {
      const match = /^chrome-extension:\/\/([a-p]{32})\/$/.exec(origin);
      return match ? [match[1]] : [];
    });
    const valid =
      manifest.name === NATIVE_HOST_NAME &&
      manifest.type === 'stdio' &&
      typeof manifest.path === 'string' &&
      extensionIds.length > 0 &&
      extensionIds.length === origins.length;
    return {
      registered: valid,
      manifestPath,
      extensionId: extensionIds[0],
      extensionIds,
      executableMatches: manifest.path === executablePath,
      reason: valid
        ? manifest.path === executablePath
          ? undefined
          : 'Chrome is pointing at another copy of Format Forge. Register this installed app to repair it.'
        : 'The installed native-host manifest is invalid.',
    };
  } catch (error) {
    return {
      registered: false,
      manifestPath,
      executableMatches: false,
      reason:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'The Chrome connection has not been registered yet.'
          : 'The Chrome connection manifest could not be read.',
    };
  }
}

export async function registerNativeHost(
  executablePath: string,
  extensionIds: string | readonly string[],
  manifestPath = nativeHostManifestPath(),
): Promise<NativeHostRegistration> {
  const manifest = createNativeHostManifest(executablePath, extensionIds);
  await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, manifestPath);
  return await readNativeHostRegistration(executablePath, manifestPath);
}
