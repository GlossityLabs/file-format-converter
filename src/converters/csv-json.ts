import type { ConversionResult } from '../core/types';
import { makeOutputFileName } from '../core/filenames';

export function parseCsv(csv: string): string[][] {
  const source = csv.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length > 0 && rows.at(-1)?.every((value) => value === '')) rows.pop();
  return rows;
}

export function csvToJsonValue(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new Error('The CSV file has no rows.');

  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error('Every CSV column must have a non-empty header.');
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length > 0) throw new Error(`The CSV contains duplicate header “${duplicates[0]}”.`);

  return rows.slice(1).map((values, rowIndex) => {
    if (values.length > headers.length && values.slice(headers.length).some((value) => value !== '')) {
      throw new Error(`CSV row ${rowIndex + 2} contains more values than the header row.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function printableJsonValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsvField(value: unknown): string {
  const printable = printableJsonValue(value);
  return /[",\r\n]/.test(printable) ? `"${printable.replace(/"/g, '""')}"` : printable;
}

export function jsonValueToCsv(value: unknown): string {
  if (!Array.isArray(value)) throw new Error('JSON-to-CSV conversion requires a top-level array of objects.');
  if (value.some((item) => item === null || Array.isArray(item) || typeof item !== 'object')) {
    throw new Error('Every item in the JSON array must be an object.');
  }

  const rows = value as Record<string, unknown>[];
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  if (headers.length === 0) return '';

  return [
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvField(row[header])).join(',')),
  ].join('\r\n');
}

export async function convertCsvToJson(file: File): Promise<ConversionResult> {
  const value = csvToJsonValue(await file.text());
  return {
    blob: new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    fileName: makeOutputFileName(file.name, 'csv', 'json'),
  };
}

export async function convertJsonToCsv(file: File): Promise<ConversionResult> {
  let value: unknown;
  try {
    value = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`The JSON file could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    blob: new Blob([jsonValueToCsv(value)], { type: 'text/csv;charset=utf-8' }),
    fileName: makeOutputFileName(file.name, 'json', 'csv'),
  };
}
