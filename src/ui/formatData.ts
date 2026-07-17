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
    description: 'Preserve layout and page structure where possible.',
    formats: ['doc', 'docx', 'odt', 'rtf', 'txt'],
    companionNote: 'Office conversions use LibreOffice locally.',
  },
  {
    category: 'pdf',
    label: 'PDF',
    description: 'Create portable, share-ready documents.',
    formats: ['pdf'],
  },
  {
    category: 'spreadsheet',
    label: 'Spreadsheets',
    description: 'Move tables and structured data between tools.',
    formats: ['xls', 'xlsx', 'ods', 'csv'],
    companionNote: 'Workbook fidelity uses LibreOffice locally.',
  },
  {
    category: 'presentation',
    label: 'Presentations',
    description: 'Preserve slides, notes and aspect ratios.',
    formats: ['ppt', 'pptx', 'odp'],
    companionNote: 'Slide conversions use LibreOffice locally.',
  },
  {
    category: 'image',
    label: 'Images',
    description: 'Switch formats without sending pixels away.',
    formats: ['png', 'jpg', 'webp', 'gif'],
  },
  {
    category: 'audio',
    label: 'Audio',
    description: 'Transcode tracks with quality controls.',
    formats: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'],
    companionNote: 'Audio conversions use FFmpeg locally.',
  },
  {
    category: 'video',
    label: 'Video',
    description: 'Convert containers, clips and animated media.',
    formats: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'],
    companionNote: 'Video conversions use FFmpeg locally.',
  },
  {
    category: 'data',
    label: 'Data',
    description: 'Reshape simple structured and plain-text files.',
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
