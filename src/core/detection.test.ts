import { describe, expect, it } from 'vitest';
import { detectFileFormat } from './detection';

function file(bytes: BlobPart[], name: string, type = ''): File {
  return new File(bytes, name, { type });
}

describe('file format detection', () => {
  it('uses strong magic bytes instead of MIME metadata', async () => {
    const png = file([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], 'image.bin', 'application/octet-stream');
    await expect(detectFileFormat(png)).resolves.toBe('png');
  });

  it('reports a clear extension/content mismatch', async () => {
    const renamed = file([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])], 'not-really.png', 'image/png');
    await expect(detectFileFormat(renamed)).rejects.toMatchObject({ code: 'format-mismatch' });
    await expect(detectFileFormat(renamed)).rejects.toThrow(/contents look like JPEG/i);
  });

  it('distinguishes Opus in an Ogg container and JSON text', async () => {
    await expect(detectFileFormat(file(['OggS', new Uint8Array(24), 'OpusHead'], 'voice.ogg'))).resolves.toBe('opus');
    await expect(detectFileFormat(file(['[{"name":"Ada"}]'], 'data.txt', 'text/plain'))).resolves.toBe('json');
  });

  it('rejects empty and unknown binary files', async () => {
    await expect(detectFileFormat(file([], 'empty.csv'))).rejects.toMatchObject({ code: 'empty-file' });
    await expect(detectFileFormat(file([new Uint8Array([0, 1, 2, 3])], 'mystery.bin'))).rejects.toMatchObject({ code: 'unsupported-format' });
  });

  it('does not reinterpret an explicitly unsupported text extension as TXT', async () => {
    await expect(detectFileFormat(file(['<svg></svg>'], 'vector.svg', 'image/svg+xml'))).rejects.toMatchObject({ code: 'unsupported-format' });
  });
});
