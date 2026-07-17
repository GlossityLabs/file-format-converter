import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fileNameMatchesFormat,
  isOriginAllowed,
  loadOrCreatePairingToken,
  magicMatchesFormat,
  resolveConfiguredPairingToken,
  sanitizeFileName,
  tokensMatch,
} from './security.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('pairing token security', () => {
  it('creates one random persisted token with private permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'format-forge-security-'));
    temporaryDirectories.push(directory);
    const tokenFile = join(directory, 'nested', 'pairing-token');

    const first = await loadOrCreatePairingToken(tokenFile);
    const second = await loadOrCreatePairingToken(tokenFile);

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toBe(first);
    expect((await readFile(tokenFile, 'utf8')).trim()).toBe(first);
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    expect(tokensMatch(first, second)).toBe(true);
    expect(tokensMatch(`${first.slice(0, -1)}x`, second)).toBe(false);
  });

  it('only accepts long URL-safe explicit secrets', () => {
    const valid = 'a'.repeat(32);
    expect(resolveConfiguredPairingToken(valid)).toBe(valid);
    expect(() => resolveConfiguredPairingToken('short')).toThrow();
    expect(() => resolveConfiguredPairingToken(`${valid} with-space`)).toThrow();
  });
});

describe('request boundary validation', () => {
  it('sanitizes paths and verifies declared extensions', () => {
    expect(sanitizeFileName(encodeURIComponent('../../Quarter:1.docx'))).toBe('Quarter-1.docx');
    expect(fileNameMatchesFormat('photo.jpeg', 'jpg')).toBe(true);
    expect(fileNameMatchesFormat('report.pdf', 'docx')).toBe(false);
    expect(fileNameMatchesFormat('no-extension', 'docx')).toBe(false);
  });

  it('allows only configured browser origins', () => {
    const extensionId = 'a'.repeat(32);
    expect(
      isOriginAllowed(
        `chrome-extension://${extensionId}`,
        new Set([extensionId]),
        new Set(['http://localhost:5173']),
      ),
    ).toBe(true);
    expect(
      isOriginAllowed(
        `chrome-extension://${'b'.repeat(32)}`,
        new Set([extensionId]),
        new Set(['http://localhost:5173']),
      ),
    ).toBe(false);
    expect(
      isOriginAllowed('https://attacker.example', new Set(['*']), new Set()),
    ).toBe(false);
  });

  it('checks reliable file signatures without guessing text formats', () => {
    expect(magicMatchesFormat(Buffer.from('PK\x03\x04archive'), 'docx')).toBe(true);
    expect(magicMatchesFormat(Buffer.from('%PDF-1.7'), 'docx')).toBe(false);
    expect(magicMatchesFormat(Buffer.from('plain,text'), 'csv')).toBeUndefined();
    expect(magicMatchesFormat(Buffer.from('OggSdata'), 'opus')).toBe(true);
  });
});
