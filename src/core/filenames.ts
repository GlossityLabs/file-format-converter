import type { FormatId } from './types';
import { getFormat } from './formats';

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

export function splitFileName(fileName: string): { stem: string; extension: string } {
  const safeLeaf = fileName.split(/[\\/]/).at(-1) ?? '';
  const dotIndex = safeLeaf.lastIndexOf('.');
  if (dotIndex <= 0) return { stem: safeLeaf, extension: '' };
  return { stem: safeLeaf.slice(0, dotIndex), extension: safeLeaf.slice(dotIndex + 1) };
}

export function sanitizeFileName(fileName: string, fallback = 'converted-file', maxLength = 180): string {
  const leaf = fileName.split(/[\\/]/).at(-1) ?? '';
  let sanitized = leaf
    .normalize('NFKC')
    .replace(INVALID_FILENAME_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[ .-]+|[ .-]+$/g, '');

  if (!sanitized || sanitized === '.' || sanitized === '..') sanitized = fallback;
  if (WINDOWS_RESERVED.test(sanitized)) sanitized = `_${sanitized}`;

  if (sanitized.length > maxLength) {
    const { stem, extension } = splitFileName(sanitized);
    const suffix = extension ? `.${extension}` : '';
    const available = Math.max(1, maxLength - suffix.length);
    sanitized = `${stem.slice(0, available).replace(/[ .-]+$/g, '') || fallback.slice(0, available)}${suffix}`;
  }
  return sanitized;
}

export function replaceExtension(fileName: string, extension: string): string {
  const safeName = sanitizeFileName(fileName);
  const { stem } = splitFileName(safeName);
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'bin';
  return sanitizeFileName(`${stem || 'converted-file'}.${safeExtension}`);
}

export function makeOutputFileName(inputName: string, input: FormatId, output: FormatId): string {
  const safeName = sanitizeFileName(inputName);
  const { stem } = splitFileName(safeName);
  if (input === 'pdf' && (output === 'png' || output === 'jpg')) {
    return sanitizeFileName(`${stem || 'converted-file'}-${output}.zip`);
  }
  return replaceExtension(safeName, getFormat(output).extensions[0]);
}

export const buildOutputFileName = makeOutputFileName;

export function ensureUniqueFileName(fileName: string, existingNames: Iterable<string>): string {
  const safeName = sanitizeFileName(fileName);
  const used = new Set(Array.from(existingNames, (name) => name.toLocaleLowerCase()));
  if (!used.has(safeName.toLocaleLowerCase())) return safeName;

  const { stem, extension } = splitFileName(safeName);
  for (let index = 2; index < 100_000; index += 1) {
    const collisionSuffix = ` (${index})`;
    const extensionSuffix = extension ? `.${extension}` : '';
    const availableStemLength = Math.max(1, 180 - collisionSuffix.length - extensionSuffix.length);
    const shortenedStem = stem.slice(0, availableStemLength).replace(/[ .-]+$/g, '') || 'converted-file';
    const candidate = sanitizeFileName(`${shortenedStem}${collisionSuffix}${extensionSuffix}`);
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error(`Could not create a unique output name for “${safeName}”.`);
}

export const resolveFileNameCollision = ensureUniqueFileName;
