import { describe, expect, it } from 'vitest';
import { csvToJsonValue, jsonValueToCsv, parseCsv } from './csv-json';

describe('CSV and JSON browser conversion', () => {
  it('parses quoted delimiters, quotes, and embedded newlines', () => {
    expect(parseCsv('name,note\r\nAda,"Hello, ""world"""\r\nLin,"two\nlines"')).toEqual([
      ['name', 'note'],
      ['Ada', 'Hello, "world"'],
      ['Lin', 'two\nlines'],
    ]);
  });

  it('maps CSV headers to JSON objects', () => {
    expect(csvToJsonValue('name,age\nAda,36\nLin,')).toEqual([
      { name: 'Ada', age: '36' },
      { name: 'Lin', age: '' },
    ]);
  });

  it('uses a stable union of JSON keys and quotes nested values', () => {
    expect(jsonValueToCsv([{ name: 'Ada', tags: ['math', 'code'] }, { name: 'Lin', active: true }])).toBe(
      'name,tags,active\r\nAda,"[""math"",""code""]",\r\nLin,,true',
    );
  });

  it('rejects malformed table shapes', () => {
    expect(() => csvToJsonValue('name,name\nAda,Lovelace')).toThrow(/duplicate header/i);
    expect(() => jsonValueToCsv({ name: 'Ada' })).toThrow(/top-level array/i);
  });
});
