import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  type RuntimeOptions,
  type ServiceLimits,
} from './contracts.js';

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function csvSet(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function configuredOrigins(): {
  extensionIds: ReadonlySet<string>;
  devOrigins: ReadonlySet<string>;
} | undefined {
  const origins = csvSet(process.env.FORMAT_FORGE_ALLOWED_ORIGINS);
  if (origins.size === 0) return undefined;

  const extensionIds = new Set<string>();
  const devOrigins = new Set<string>();
  for (const origin of origins) {
    const extension = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
    if (extension) extensionIds.add(extension[1]);
    else devOrigins.add(origin);
  }
  return { extensionIds, devOrigins };
}

export function loadRuntimeOptions(overrides: Partial<RuntimeOptions> = {}): RuntimeOptions {
  const configRoot = process.env.FORMAT_FORGE_CONFIG_DIR
    ? resolve(process.env.FORMAT_FORGE_CONFIG_DIR)
    : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'format-forge');

  const limits: ServiceLimits = {
    maxUploadBytes: positiveInteger(
      process.env.FORMAT_FORGE_MAX_UPLOAD_BYTES,
      1024 * 1024 * 1024,
      8 * 1024 * 1024 * 1024,
    ),
    maxConcurrentJobs: positiveInteger(process.env.FORMAT_FORGE_MAX_CONCURRENT_JOBS, 2, 16),
    maxRetainedJobs: positiveInteger(process.env.FORMAT_FORGE_MAX_RETAINED_JOBS, 100, 1_000),
    jobTtlMs: positiveInteger(
      process.env.FORMAT_FORGE_JOB_TTL_MS,
      30 * 60 * 1_000,
      24 * 60 * 60 * 1_000,
    ),
    processTimeoutMs: positiveInteger(
      process.env.FORMAT_FORGE_PROCESS_TIMEOUT_MS,
      2 * 60 * 60 * 1_000,
      8 * 60 * 60 * 1_000,
    ),
  };

  const allowedOrigins = configuredOrigins();
  const configuredDevOrigins = csvSet(process.env.FORMAT_FORGE_DEV_ORIGINS);
  const allowedDevOrigins =
    configuredDevOrigins.size > 0
      ? configuredDevOrigins
      : new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  const legacyExtensionIds = csvSet(process.env.FORMAT_FORGE_EXTENSION_IDS);

  return {
    host: overrides.host ?? DEFAULT_HOST,
    port:
      overrides.port ??
      positiveInteger(process.env.FORMAT_FORGE_PORT, DEFAULT_PORT, 65_535),
    tokenFile:
      overrides.tokenFile ??
      resolve(process.env.FORMAT_FORGE_TOKEN_FILE ?? join(configRoot, 'pairing-token')),
    pairingToken: overrides.pairingToken ?? process.env.FORMAT_FORGE_TOKEN,
    tempDirectory:
      overrides.tempDirectory ??
      resolve(process.env.FORMAT_FORGE_TEMP_DIR ?? join(tmpdir(), 'format-forge-companion')),
    allowedExtensionIds:
      overrides.allowedExtensionIds ??
      allowedOrigins?.extensionIds ??
      (legacyExtensionIds.size > 0 ? legacyExtensionIds : new Set(['*'])),
    allowedDevOrigins:
      overrides.allowedDevOrigins ?? allowedOrigins?.devOrigins ?? allowedDevOrigins,
    limits: { ...limits, ...overrides.limits },
  };
}
