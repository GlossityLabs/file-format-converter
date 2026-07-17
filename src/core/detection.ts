import type { FormatId } from './types';
import { getFormat, getFormatFromExtension, getFormatsFromMimeType } from './formats';

export type DetectionErrorCode = 'empty-file' | 'unsupported-format' | 'format-mismatch' | 'ambiguous-format';

export class FileDetectionError extends Error {
  readonly code: DetectionErrorCode;

  constructor(code: DetectionErrorCode, message: string) {
    super(message);
    this.name = 'FileDetectionError';
    this.code = code;
  }
}

const decoder = new TextDecoder('latin1');
const textDecoder = new TextDecoder('utf-8', { fatal: false });

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start = 0, length = bytes.length - start): string {
  return decoder.decode(bytes.subarray(start, start + length));
}

function findAscii(bytes: Uint8Array, text: string): boolean {
  return ascii(bytes).includes(text);
}

function isZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);
}

function detectZipPackage(bytes: Uint8Array, extensionFormat?: FormatId): FormatId | undefined {
  if (findAscii(bytes, 'word/')) return 'docx';
  if (findAscii(bytes, 'xl/')) return 'xlsx';
  if (findAscii(bytes, 'ppt/')) return 'pptx';
  if (findAscii(bytes, 'application/vnd.oasis.opendocument.text')) return 'odt';
  if (findAscii(bytes, 'application/vnd.oasis.opendocument.spreadsheet')) return 'ods';
  if (findAscii(bytes, 'application/vnd.oasis.opendocument.presentation')) return 'odp';
  if (extensionFormat && ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(extensionFormat)) return extensionFormat;
  return undefined;
}

function detectIsoMedia(bytes: Uint8Array, extensionFormat?: FormatId): FormatId {
  const brand = ascii(bytes, 8, 8).toLowerCase();
  if (brand.includes('m4a')) return 'm4a';
  if (brand.includes('m4v')) return 'm4v';
  if (brand.includes('qt')) return 'mov';
  if (extensionFormat && ['mp4', 'mov', 'm4a', 'm4v'].includes(extensionFormat)) return extensionFormat;
  return 'mp4';
}

function detectMagic(bytes: Uint8Array, extensionFormat?: FormatId): FormatId | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'AVI ') return 'avi';
  if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
  if (ascii(bytes, 0, 4) === 'OggS') return findAscii(bytes.subarray(0, 512), 'OpusHead') ? 'opus' : 'ogg';
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    if (extensionFormat === 'webm' || extensionFormat === 'mkv') return extensionFormat;
    return findAscii(bytes.subarray(0, 4096), 'webm') ? 'webm' : 'mkv';
  }
  if (ascii(bytes, 4, 4) === 'ftyp') return detectIsoMedia(bytes, extensionFormat);
  if (ascii(bytes, 0, 3) === 'ID3') return 'mp3';
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return 'aac';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  if (ascii(bytes, 0, 5) === '{\\rtf') return 'rtf';
  if (isZip(bytes)) return detectZipPackage(bytes, extensionFormat);
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return extensionFormat && ['doc', 'xls', 'ppt'].includes(extensionFormat) ? extensionFormat : undefined;
  }
  return undefined;
}

function likelyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let suspicious = 0;
  for (const value of sample) {
    if (value === 0) return true;
    if (value < 0x09 || (value > 0x0d && value < 0x20)) suspicious += 1;
  }
  return sample.length > 0 && suspicious / sample.length > 0.05;
}

function detectText(bytes: Uint8Array, extensionFormat?: FormatId): FormatId | undefined {
  if (likelyBinary(bytes)) return undefined;
  const value = textDecoder.decode(bytes).replace(/^\uFEFF/, '').trim();
  if (!value && extensionFormat && ['txt', 'csv', 'json'].includes(extensionFormat)) return extensionFormat;
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      JSON.parse(value);
      return 'json';
    } catch {
      // A malformed JSON file should still be identified from its explicit extension below.
    }
  }
  if (extensionFormat && ['csv', 'txt', 'json'].includes(extensionFormat)) return extensionFormat;
  if (/[,;\t]/.test(value) && /\r?\n/.test(value)) return 'csv';
  return value ? 'txt' : undefined;
}

function formatsAreCompatible(detected: FormatId, named?: FormatId): boolean {
  if (!named || detected === named) return true;
  const groups: readonly (readonly FormatId[])[] = [
    ['mp4', 'mov', 'm4a', 'm4v'],
    ['mkv', 'webm'],
    ['ogg', 'opus'],
    ['txt', 'csv', 'json'],
  ];
  return groups.some((group) => group.includes(detected) && group.includes(named));
}

async function readDetectionBytes(file: Blob): Promise<Uint8Array> {
  const sampleSize = 1024 * 1024;
  if (file.size <= sampleSize * 2) return new Uint8Array(await file.arrayBuffer());
  const [head, tail] = await Promise.all([
    file.slice(0, sampleSize).arrayBuffer(),
    file.slice(file.size - sampleSize).arrayBuffer(),
  ]);
  const joined = new Uint8Array(sampleSize * 2);
  joined.set(new Uint8Array(head), 0);
  joined.set(new Uint8Array(tail), sampleSize);
  return joined;
}

export async function detectFileFormat(file: Blob & { name?: string; type?: string }): Promise<FormatId> {
  if (file.size === 0) {
    throw new FileDetectionError('empty-file', 'The selected file is empty and cannot be converted.');
  }

  const name = file.name ?? '';
  const extensionFormat = getFormatFromExtension(name);
  const mimeFormats = file.type ? getFormatsFromMimeType(file.type) : [];
  const bytes = await readDetectionBytes(file);
  const strongMagicFormat = detectMagic(bytes, extensionFormat);
  const textFormat = strongMagicFormat ? undefined : detectText(bytes, extensionFormat);
  const magicFormat = strongMagicFormat ?? textFormat;

  if (magicFormat && extensionFormat && !formatsAreCompatible(magicFormat, extensionFormat)) {
    const expectedExtension = getFormat(extensionFormat).extensions[0];
    throw new FileDetectionError(
      'format-mismatch',
      `“${name || 'This file'}” uses the .${expectedExtension} extension, but its contents look like ${getFormat(magicFormat).label}. Rename or choose the correct file.`,
    );
  }
  if (magicFormat) {
    const hasUnknownExtension = Boolean(name.includes('.') && !extensionFormat);
    if (textFormat && hasUnknownExtension && mimeFormats.length === 0) {
      const extension = `.${name.split('.').at(-1)}`;
      throw new FileDetectionError(
        'unsupported-format',
        `“${name}” uses the unsupported ${extension} extension, even though its contents are text. Rename it only if it is actually TXT, CSV, or JSON.`,
      );
    }
    return magicFormat;
  }
  if (isZip(bytes)) {
    throw new FileDetectionError(
      'ambiguous-format',
      `“${name || 'This file'}” is a ZIP-based container, but it does not identify itself as a supported DOCX, XLSX, PPTX, ODT, ODS, or ODP file.`,
    );
  }
  if (extensionFormat) return extensionFormat;
  if (mimeFormats.length === 1) return mimeFormats[0];
  if (mimeFormats.length > 1) {
    throw new FileDetectionError('ambiguous-format', `The MIME type “${file.type}” matches more than one supported format. Add the correct file extension and try again.`);
  }

  const extension = name.includes('.') ? `.${name.split('.').at(-1)}` : 'without an extension';
  throw new FileDetectionError(
    'unsupported-format',
    `“${name || 'This file'}” has an unsupported format (${extension}). Choose one of the formats shown in the converter.`,
  );
}

export const detectFormat = detectFileFormat;
