import type { FormatCategory, FormatId, JobStatus, QualityPreset } from '../core/types';
import { getKnownRecipesForInput } from '../core/recipes';

export interface FormatGroup {
  category: FormatCategory;
  label: string;
  description: string;
  formats: readonly FormatId[];
  companionNote?: string;
}

export const FORMAT_LABELS: Record<FormatId, string> = {
  png: 'PNG',
  jpg: 'JPG',
  webp: 'WebP',
  pdf: 'PDF',
  csv: 'CSV',
  json: 'JSON',
  txt: 'TXT',
  doc: 'DOC',
  docx: 'DOCX',
  odt: 'ODT',
  rtf: 'RTF',
  xls: 'XLS',
  xlsx: 'XLSX',
  ods: 'ODS',
  ppt: 'PPT',
  pptx: 'PPTX',
  odp: 'ODP',
  mp3: 'MP3',
  wav: 'WAV',
  flac: 'FLAC',
  m4a: 'M4A',
  aac: 'AAC',
  ogg: 'OGG',
  opus: 'Opus',
  mp4: 'MP4',
  mov: 'MOV',
  mkv: 'MKV',
  webm: 'WebM',
  avi: 'AVI',
  m4v: 'M4V',
  gif: 'GIF',
};

export const FORMAT_GROUPS: readonly FormatGroup[] = [
  {
    category: 'document',
    label: 'Documents',
    description: 'Convert DOCX, DOC, ODT, RTF and TXT to PDF.',
    formats: ['doc', 'docx', 'odt', 'rtf', 'txt'],
    companionNote: 'Office conversions use LibreOffice locally.',
  },
  {
    category: 'pdf',
    label: 'PDF',
    description: 'Turn PDF pages into PNG or JPG images in a ZIP.',
    formats: ['pdf'],
  },
  {
    category: 'spreadsheet',
    label: 'Spreadsheets',
    description: 'Convert XLSX, XLS, ODS or CSV to PDF; move between CSV and XLSX.',
    formats: ['xls', 'xlsx', 'ods', 'csv'],
    companionNote: 'Workbook fidelity uses LibreOffice locally.',
  },
  {
    category: 'presentation',
    label: 'Presentations',
    description: 'Convert PPTX, PPT or ODP presentations to PDF.',
    formats: ['ppt', 'pptx', 'odp'],
    companionNote: 'Slide conversions use LibreOffice locally.',
  },
  {
    category: 'image',
    label: 'Images',
    description: 'Convert PNG, JPG and WebP, or save an image as PDF.',
    formats: ['png', 'jpg', 'webp', 'gif'],
  },
  {
    category: 'audio',
    label: 'Audio',
    description: 'Convert between MP3, WAV, FLAC, M4A, AAC, OGG and Opus.',
    formats: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'],
    companionNote: 'Audio conversions use FFmpeg locally.',
  },
  {
    category: 'video',
    label: 'Video',
    description: 'Convert MP4, MOV, MKV, WebM, AVI or M4V; export GIF or audio.',
    formats: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'],
    companionNote: 'Video conversions use FFmpeg locally.',
  },
  {
    category: 'data',
    label: 'Data',
    description: 'Convert CSV and JSON table data directly in Chrome.',
    formats: ['json', 'csv'],
  },
] as const;

export const PRESET_LABELS: Record<QualityPreset, { label: string; hint: string }> = {
  high: { label: 'High quality', hint: 'Best fidelity, larger file' },
  balanced: { label: 'Balanced', hint: 'Recommended for most files' },
  small: { label: 'Smaller file', hint: 'More compression' },
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  ready: 'Ready',
  uploading: 'Preparing locally',
  converting: 'Converting',
  finalizing: 'Finishing',
  complete: 'Complete',
  failed: 'Needs attention',
  canceled: 'Canceled',
};

export function getOutputFormats(input: FormatId, current?: FormatId): FormatId[] {
  const outputs = [...new Set(getKnownRecipesForInput(input).map((recipe) => recipe.output))].filter(
    (format) => format !== input,
  );
  if (current && current !== input && !outputs.includes(current)) outputs.unshift(current);
  return outputs;
}

export function getFormatCategory(format: FormatId): FormatCategory {
  const group = FORMAT_GROUPS.find((candidate) => candidate.formats.includes(format));
  return group?.category ?? 'data';
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** order;
  const digits = order === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[order]}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
