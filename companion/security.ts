import { randomBytes, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, link, mkdir, open, readFile, rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

const GENERATED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONFIGURED_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/;
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/([a-p]{32})$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const UNSAFE_FILE_CHARACTERS = /[\\/:*?"<>|%]/g;

export async function loadOrCreatePairingToken(tokenFile: string): Promise<string> {
  await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 });

  try {
    const existing = (await readFile(tokenFile, 'utf8')).trim();
    if (!GENERATED_TOKEN_PATTERN.test(existing)) {
      throw new Error('The pairing token file is invalid. Move it aside and restart the companion.');
    }
    await chmod(tokenFile, 0o600);
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const token = randomBytes(32).toString('base64url');
  const temporaryFile = join(dirname(tokenFile), `.pairing-token-${process.pid}-${randomBytes(6).toString('hex')}`);
  const handle = await open(temporaryFile, 'wx', 0o600);
  try {
    await handle.writeFile(`${token}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await link(temporaryFile, tokenFile);
    await rm(temporaryFile, { force: true });
  } catch (error) {
    await rm(temporaryFile, { force: true });
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const winner = (await readFile(tokenFile, 'utf8')).trim();
      if (GENERATED_TOKEN_PATTERN.test(winner)) return winner;
    }
    throw error;
  }
  await chmod(tokenFile, 0o600);
  return token;
}

export function resolveConfiguredPairingToken(configured: string | undefined): string | undefined {
  if (configured === undefined || configured === '') return undefined;
  if (!CONFIGURED_TOKEN_PATTERN.test(configured)) {
    throw new Error(
      'FORMAT_FORGE_TOKEN must contain 32-256 URL-safe characters and must not contain whitespace.',
    );
  }
  return configured;
}

export function bearerTokenFromHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  return match?.[1];
}

export function tokensMatch(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedExtensionIds: ReadonlySet<string>,
  allowedDevOrigins: ReadonlySet<string>,
): boolean {
  if (origin === undefined) return true;
  if (allowedDevOrigins.has(origin)) return true;

  const extensionMatch = EXTENSION_ORIGIN_PATTERN.exec(origin);
  if (!extensionMatch) return false;
  return allowedExtensionIds.has('*') || allowedExtensionIds.has(extensionMatch[1]);
}

export function sanitizeFileName(value: string, fallback = 'converted-file'): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A literal filename is valid even if it contains a stray percent escape.
  }

  const originalExtension = extname(basename(decoded)).slice(0, 17);
  const stem = basename(decoded, extname(basename(decoded)))
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS, '')
    .replace(UNSAFE_FILE_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 96)
    .replace(/[. ]+$/, '');
  const extension = originalExtension
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS, '')
    .replace(UNSAFE_FILE_CHARACTERS, '')
    .replace(/[^.A-Za-z0-9_-]/g, '')
    .slice(0, 17);

  return `${stem || fallback}${extension}`.slice(0, 120);
}

export function makeOutputName(inputName: string, outputExtension: string): string {
  const safe = sanitizeFileName(inputName, 'converted-file');
  const stem = basename(safe, extname(safe)).replace(/[. ]+$/, '') || 'converted-file';
  return `${stem.slice(0, 96)}.${outputExtension}`;
}

const EXTENSION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  jpg: ['jpg', 'jpeg'],
};

export function fileNameMatchesFormat(fileName: string, format: string): boolean {
  const safe = sanitizeFileName(fileName);
  const extension = extname(safe).slice(1).toLowerCase();
  const accepted = EXTENSION_ALIASES[format] ?? [format];
  return extension.length > 0 && accepted.includes(extension);
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Buffer, offset: number, value: string): boolean {
  return bytes.subarray(offset, offset + value.length).toString('ascii') === value;
}

/**
 * Returns `undefined` for formats without a reliable short signature. That keeps
 * validation conservative while rejecting obvious format spoofing where possible.
 */
export function magicMatchesFormat(bytes: Buffer, format: string): boolean | undefined {
  if (bytes.length === 0) return false;
  switch (format) {
    case 'docx':
    case 'xlsx':
    case 'pptx':
    case 'odt':
    case 'ods':
    case 'odp':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case 'doc':
    case 'xls':
    case 'ppt':
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'rtf':
      return asciiAt(bytes, 0, '{\\rtf');
    case 'mp3':
      return asciiAt(bytes, 0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case 'wav':
      return asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WAVE');
    case 'flac':
      return asciiAt(bytes, 0, 'fLaC');
    case 'ogg':
    case 'opus':
      return asciiAt(bytes, 0, 'OggS');
    case 'aac':
      return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
    case 'mp4':
    case 'm4v':
    case 'm4a':
      return asciiAt(bytes, 4, 'ftyp');
    case 'mkv':
    case 'webm':
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'avi':
      return asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'AVI ');
    case 'gif':
      return asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a');
    default:
      return undefined;
  }
}

export function contentDisposition(fileName: string): string {
  const ascii = sanitizeFileName(fileName)
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
