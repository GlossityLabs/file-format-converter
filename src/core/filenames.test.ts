import { describe, expect, it } from 'vitest';
import { ensureUniqueFileName, makeOutputFileName, sanitizeFileName } from './filenames';

describe('safe output filenames', () => {
  it('removes paths, controls, reserved names and dangerous punctuation', () => {
    expect(sanitizeFileName('../../CON.txt')).toBe('_CON.txt');
    expect(sanitizeFileName('../../bad?.txt')).toBe('bad-.txt');
    expect(sanitizeFileName('  report\u0000  final .pdf ')).toBe('report- final .pdf');
  });

  it('names ordinary and PDF page-archive outputs predictably', () => {
    expect(makeOutputFileName('quarterly.report.csv', 'csv', 'json')).toBe('quarterly.report.json');
    expect(makeOutputFileName('slides.pdf', 'pdf', 'png')).toBe('slides-png.zip');
  });

  it('resolves collisions case-insensitively before the extension', () => {
    expect(ensureUniqueFileName('report.pdf', ['REPORT.PDF', 'report (2).pdf'])).toBe('report (3).pdf');
    const longName = `${'a'.repeat(176)}.pdf`;
    const resolved = ensureUniqueFileName(longName, [longName]);
    expect(resolved).toMatch(/ \(2\)\.pdf$/);
    expect(resolved.length).toBeLessThanOrEqual(180);
  });
});
