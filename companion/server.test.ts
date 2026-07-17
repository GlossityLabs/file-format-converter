import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompanionService } from './server.js';
import { createCompanionService } from './server.js';

const ENVIRONMENT_TOOL_KEYS = [
  'FORMAT_FORGE_FFMPEG_PATH',
  'FORMAT_FORGE_FFPROBE_PATH',
  'FORMAT_FORGE_SOFFICE_PATH',
  'FORMAT_FORGE_PDFTOPPM_PATH',
] as const;

const originalToolEnvironment = new Map(
  ENVIRONMENT_TOOL_KEYS.map((key) => [key, process.env[key]] as const),
);
const temporaryDirectories: string[] = [];
let activeService: CompanionService | undefined;

afterEach(async () => {
  await activeService?.close();
  activeService = undefined;
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  for (const key of ENVIRONMENT_TOOL_KEYS) {
    const original = originalToolEnvironment.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

async function fakeNativeTool(directory: string): Promise<string> {
  const command = join(directory, 'fake-native-tool');
  await writeFile(
    command,
    '#!/usr/bin/env node\nprocess.stdout.write("fake native tool 1.0\\n");\n',
    { mode: 0o700 },
  );
  await chmod(command, 0o700);
  return command;
}

describe('companion HTTP boundary', () => {
  it('enforces CORS/auth and cleans up a rejected streamed upload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'format-forge-server-'));
    temporaryDirectories.push(directory);
    const fakeTool = await fakeNativeTool(directory);
    for (const key of ENVIRONMENT_TOOL_KEYS) process.env[key] = fakeTool;

    const token = randomBytes(32).toString('base64url');
    const jobsDirectory = join(directory, 'jobs');
    activeService = await createCompanionService({
      host: '127.0.0.1',
      port: 0,
      pairingToken: token,
      tokenFile: join(directory, 'pairing-token'),
      tempDirectory: jobsDirectory,
      allowedExtensionIds: new Set(['a'.repeat(32)]),
      allowedDevOrigins: new Set(['http://localhost:5173']),
      limits: {
        maxUploadBytes: 1024 * 1024,
        maxConcurrentJobs: 1,
        maxRetainedJobs: 5,
        jobTtlMs: 5_000,
        processTimeoutMs: 5_000,
      },
    });
    await activeService.start();
    const baseUrl = `http://127.0.0.1:${activeService.port}`;

    const health = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(health.status).toBe(200);
    expect(health.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    await expect(health.json()).resolves.toMatchObject({
      service: 'format-forge-companion',
      status: 'ok',
    });

    const forbiddenOrigin = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://attacker.example' },
    });
    expect(forbiddenOrigin.status).toBe(403);
    expect(forbiddenOrigin.headers.has('access-control-allow-origin')).toBe(false);

    const unpairedCapabilities = await fetch(`${baseUrl}/v1/capabilities`);
    await expect(unpairedCapabilities.json()).resolves.toMatchObject({ paired: false });
    const pairedCapabilities = await fetch(`${baseUrl}/v1/capabilities`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expect(pairedCapabilities.json()).resolves.toMatchObject({
      paired: true,
      tools: {
        ffmpeg: { available: true },
        libreoffice: { available: true },
        poppler: { available: true },
      },
    });

    const unauthenticatedJob = await fetch(`${baseUrl}/v1/jobs`, {
      method: 'POST',
      body: new Uint8Array([1]),
    });
    expect(unauthenticatedJob.status).toBe(401);

    const rejectedUpload = await fetch(`${baseUrl}/v1/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent('spoofed.docx'),
        'X-Input-Format': 'docx',
        'X-Output-Format': 'pdf',
        'X-Quality-Preset': 'balanced',
      },
      body: Buffer.from('%PDF-1.7 definitely not an OOXML ZIP'),
    });
    expect(rejectedUpload.status).toBe(415);
    await expect(rejectedUpload.json()).resolves.toMatchObject({
      error: { code: 'content_mismatch' },
    });
    expect(await readdir(jobsDirectory)).toEqual([]);
  });
});
