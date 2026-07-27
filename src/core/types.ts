export type FormatCategory = 'image' | 'document' | 'spreadsheet' | 'presentation' | 'data' | 'audio' | 'video' | 'pdf';

export type FormatId =
  | 'png'
  | 'jpg'
  | 'webp'
  | 'pdf'
  | 'csv'
  | 'json'
  | 'txt'
  | 'doc'
  | 'docx'
  | 'odt'
  | 'rtf'
  | 'xls'
  | 'xlsx'
  | 'ods'
  | 'ppt'
  | 'pptx'
  | 'odp'
  | 'mp3'
  | 'wav'
  | 'flac'
  | 'm4a'
  | 'aac'
  | 'ogg'
  | 'opus'
  | 'mp4'
  | 'mov'
  | 'mkv'
  | 'webm'
  | 'avi'
  | 'm4v'
  | 'gif';

export type ConversionEngine = 'browser' | 'companion';
export type QualityPreset = 'high' | 'balanced' | 'small';

export interface FormatDefinition {
  id: FormatId;
  label: string;
  category: FormatCategory;
  extensions: readonly string[];
  mimeTypes: readonly string[];
}

export interface ConversionRecipe {
  input: FormatId;
  output: FormatId;
  engine: ConversionEngine;
  description: string;
  fidelityNote?: string;
  requires?: 'ffmpeg' | 'libreoffice' | 'poppler';
}

export type JobStatus =
  | 'ready'
  | 'uploading'
  | 'converting'
  | 'finalizing'
  | 'complete'
  | 'failed'
  | 'canceled';

export interface ConversionJob {
  id: string;
  file: File;
  inputFormat: FormatId;
  outputFormat: FormatId;
  engine: ConversionEngine;
  preset: QualityPreset;
  status: JobStatus;
  progress: number;
  outputName?: string;
  outputUrl?: string;
  outputBlob?: Blob;
  error?: string;
}

export interface ToolCapability {
  available: boolean;
  version?: string;
  detail?: string;
}

export interface CompanionCapabilities {
  service: 'format-forge-companion';
  version: string;
  apiVersion?: number;
  paired: boolean;
  tools: {
    ffmpeg: ToolCapability;
    libreoffice: ToolCapability;
    poppler: ToolCapability;
  };
}

export interface ConversionResult {
  blob: Blob;
  fileName: string;
}

export interface ConversionProgress {
  phase: 'loading' | 'converting' | 'finalizing';
  value: number;
}
