import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageManifest = JSON.parse(
  await readFile(join(desktopDirectory, 'package.json'), 'utf8'),
);
const appExecutable = join(
  desktopDirectory,
  'release-preview',
  'mac-universal',
  'Format Forge Preview.app',
  'Contents',
  'MacOS',
  'Format Forge Preview',
);
const productionManifest = join(
  homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome',
  'NativeMessagingHosts',
  'com.glossitylabs.formatforge.json',
);

async function optionalFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((_, rejectTimeout) => {
      const timeout = setTimeout(
        () => rejectTimeout(new Error('Packaged Preview did not exit cleanly.')),
        timeoutMs,
      );
      timeout.unref();
    }),
  ]);
}

const manifestBefore = await optionalFile(productionManifest);
const child = spawn(appExecutable, ['--engine-only'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => {
  if (stderr.length < 8_192) stderr += chunk.toString('utf8');
});

try {
  const deadline = Date.now() + 30_000;
  let health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged Preview exited before its engine was ready.\n${stderr}`);
    }
    try {
      const response = await fetch('http://127.0.0.1:43124/health', {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // The packaged app is still starting or detecting conversion tools.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  assert.ok(health, `Packaged Preview engine did not become ready.\n${stderr}`);
  assert.equal(health.service, 'format-forge-companion');
  assert.equal(health.version, packageManifest.version);
  assert.equal(health.apiVersion, 1);
  assert.equal(
    await optionalFile(productionManifest),
    manifestBefore,
    'Preview must not create or rewrite the production Chrome registration',
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await waitForExit(child);
}

process.stdout.write('Packaged Preview engine and production isolation smoke check passed.\n');
