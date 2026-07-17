import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRuntimeOptions } from './config.js';
import {
  loadOrCreatePairingToken,
  resolveConfiguredPairingToken,
} from './security.js';

/**
 * Explicit pairing-secret retrieval for the local user. Normal server startup
 * never calls this entry point and never writes the secret to its logs.
 */
export async function readPairingToken(): Promise<string> {
  const options = loadRuntimeOptions();
  return (
    resolveConfiguredPairingToken(options.pairingToken) ??
    (await loadOrCreatePairingToken(options.tokenFile))
  );
}

async function main(): Promise<void> {
  const token = await readPairingToken();
  process.stdout.write(`${token}\n`);
}

const isEntryPoint =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntryPoint) {
  void main().catch(() => {
    console.error('The companion pairing token could not be read.');
    process.exitCode = 1;
  });
}
