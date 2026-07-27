import assert from 'node:assert/strict';
import { createHash, createPublicKey } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NATIVE_HOST_NAME,
  NativeMessageDecoder,
  encodeNativeMessage,
} from '../dist/native-protocol.js';
import {
  createNativeHostManifest,
  isInstalledApplicationExecutable,
  readNativeHostRegistration,
  registerNativeHost,
} from '../dist/native-registration.js';
import {
  compareReleaseVersions,
  isNewerRelease,
} from '../dist/version-policy.js';

const desktopDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryDirectory = resolve(desktopDirectory, '..');
const extensionIds = (await readFile(join(desktopDirectory, 'assets', 'extension-id.txt'), 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));
const storeExtensionId = 'hepepnceipleliodfnmfkmbcmfkbmpan';

const request = { type: 'bootstrap', protocolVersion: 1 };
const frame = encodeNativeMessage(request);
const decoder = new NativeMessageDecoder();
assert.deepEqual(decoder.push(frame.subarray(0, 3)), []);
assert.deepEqual(decoder.push(frame.subarray(3, 9)), []);
assert.deepEqual(decoder.push(frame.subarray(9)), [request]);
decoder.finish();

const wrapperPath = join(desktopDirectory, 'assets', 'format-forge-native-host');
const wrapperMode = (await stat(wrapperPath)).mode;
assert.notEqual(wrapperMode & 0o111, 0, 'native-host wrapper must be executable');
const wrapperSource = await readFile(wrapperPath, 'utf8');
assert.match(wrapperSource, /CFBundleExecutable/, 'native-host wrapper must discover the packaged executable');
assert.doesNotMatch(
  wrapperSource,
  /MacOS\/Format Forge\b/,
  'native-host wrapper must not hard-code the production executable name',
);

const manifest = createNativeHostManifest(wrapperPath, extensionIds);
assert.equal(manifest.name, NATIVE_HOST_NAME);
assert.equal(manifest.path, wrapperPath);
assert.deepEqual(
  manifest.allowed_origins,
  extensionIds.map((extensionId) => `chrome-extension://${extensionId}/`),
);
assert.equal(
  isInstalledApplicationExecutable('/Applications/Format Forge.app/Contents/MacOS/Format Forge', '/Users/test'),
  true,
);
assert.equal(
  isInstalledApplicationExecutable('/Users/test/Applications/Format Forge.app/Contents/MacOS/Format Forge', '/Users/test'),
  true,
);
assert.equal(
  isInstalledApplicationExecutable('/Volumes/Format Forge/Format Forge.app/Contents/MacOS/Format Forge', '/Users/test'),
  false,
);
assert.equal(
  isInstalledApplicationExecutable('/Applications/Other.app/Contents/MacOS/Other', '/Users/test'),
  false,
);
assert.equal(
  isInstalledApplicationExecutable('/Applications/Format Forge Preview.app/Contents/MacOS/Format Forge Preview', '/Users/test'),
  false,
);
assert.equal(compareReleaseVersions('0.1.2', '0.1.1'), 1);
assert.equal(compareReleaseVersions('0.1.2', '0.1.2'), 0);
assert.equal(compareReleaseVersions('0.1.2-beta.1', '0.1.2'), -1);
assert.equal(isNewerRelease('0.2.0', '0.1.9'), true);
assert.equal(isNewerRelease('not-a-version', '0.1.9'), false);

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'format-forge-native-host-'));
try {
  const manifestPath = join(temporaryDirectory, 'host.json');
  const registered = await registerNativeHost(wrapperPath, extensionIds, manifestPath);
  assert.equal(registered.registered, true);
  assert.equal(registered.executableMatches, true);
  assert.equal(registered.extensionId, extensionIds[0]);
  assert.deepEqual(registered.extensionIds, extensionIds);
  assert.deepEqual(await readNativeHostRegistration(wrapperPath, manifestPath), registered);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const extensionManifest = JSON.parse(
  await readFile(join(repositoryDirectory, 'public', 'manifest.json'), 'utf8'),
);
assert.equal(typeof extensionManifest.key, 'string', 'extension manifest must contain a stable public key');
const publicKey = createPublicKey({
  key: Buffer.from(extensionManifest.key, 'base64'),
  format: 'der',
  type: 'spki',
});
const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
const hexadecimalId = createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 32);
const calculatedId = [...hexadecimalId]
  .map((character) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(character, 16)))
  .join('');
assert.ok(
  extensionIds.includes(calculatedId),
  'desktop extension IDs must include the unpacked ID derived from the manifest public key',
);
assert.ok(
  extensionIds.includes(storeExtensionId),
  'desktop extension IDs must include the Chrome Web Store production ID',
);

const rootPackage = JSON.parse(await readFile(join(repositoryDirectory, 'package.json'), 'utf8'));
const desktopPackage = JSON.parse(await readFile(join(desktopDirectory, 'package.json'), 'utf8'));
assert.equal(desktopPackage.version, rootPackage.version, 'desktop and extension versions must match');
assert.equal(
  typeof desktopPackage.dependencies?.['electron-updater'],
  'string',
  'desktop app must include electron-updater as a production dependency',
);
assert.equal(desktopPackage.build.publish?.provider, 'github');
assert.deepEqual(
  desktopPackage.build.mac.target.map((target) => target.target),
  ['dmg', 'zip'],
  'signed releases must produce both the installable DMG and updater ZIP',
);
assert.match(desktopPackage.scripts['package:mac:qa'], /formatforge\.preview/);
assert.match(desktopPackage.scripts['package:mac:qa'], /Format Forge Preview/);

const compiledCapabilities = await readFile(
  join(repositoryDirectory, 'dist-companion', 'capabilities.js'),
  'utf8',
);
for (const executable of [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/opt/local/bin/ffmpeg',
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/opt/local/bin/ffprobe',
]) {
  assert.equal(
    compiledCapabilities.includes(executable),
    true,
    `compiled companion must probe ${executable}`,
  );
}

process.stdout.write('Desktop native-host protocol and registration smoke check passed.\n');
