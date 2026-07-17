import { describe, expect, it } from 'vitest';
import { FORMAT_DEFINITIONS, FORMAT_REGISTRY, getFormatFromExtension, getFormatsFromMimeType } from './formats';

describe('format registry', () => {
  it('contains each supported format exactly once', () => {
    const ids = FORMAT_DEFINITIONS.map((format) => format.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'png', 'jpg', 'webp', 'gif', 'pdf', 'csv', 'json', 'txt', 'doc', 'docx', 'odt', 'rtf',
      'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg',
      'opus', 'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v',
    ]);
    expect(Object.keys(FORMAT_REGISTRY)).toHaveLength(ids.length);
  });

  it('resolves aliases without treating MIME ambiguity as certainty', () => {
    expect(getFormatFromExtension('photo.JPEG')).toBe('jpg');
    expect(getFormatFromExtension('.wave')).toBe('wav');
    expect(getFormatsFromMimeType('audio/mp4; codecs=aac')).toEqual(['m4a']);
  });
});
