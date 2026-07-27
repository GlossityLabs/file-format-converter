import type { ChildProcess } from 'node:child_process';

export const SERVICE_NAME = 'format-forge-companion' as const;
export const SERVICE_VERSION = '0.1.4';
export const API_VERSION = 1;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 43_123;

export const FORMAT_IDS = [
  'png',
  'jpg',
  'webp',
  'pdf',
  'csv',
  'json',
  'txt',
  'doc',
  'docx',
  'odt',
  'rtf',
  'xls',
  'xlsx',
  'ods',
  'ppt',
  'pptx',
  'odp',
  'mp3',
  'wav',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'm4v',
  'gif',
] as const;

export type FormatId = (typeof FORMAT_IDS)[number];
export type QualityPreset = 'high' | 'balanced' | 'small';
export type RequiredTool = 'ffmpeg' | 'libreoffice' | 'poppler';
export type JobState =
  | 'queued'
  | 'converting'
  | 'finalizing'
  | 'complete'
  | 'failed'
  | 'canceled';

export interface Recipe {
  input: FormatId;
  output: FormatId;
  requires: RequiredTool;
}

export interface PublicRecipe extends Recipe {
  available: boolean;
}

export interface ToolCapability {
  available: boolean;
  version?: string;
  detail?: string;
}

export interface DetectedTool extends ToolCapability {
  command?: string;
}

export interface DetectedTools {
  ffmpeg: DetectedTool;
  ffprobe: DetectedTool;
  libreoffice: DetectedTool;
  poppler: DetectedTool;
}

export interface PublicJob {
  id: string;
  state: JobState;
  progress: number;
  outputName?: string;
  sizeBytes?: number;
  error?: string;
}

export interface InternalJob {
  id: string;
  state: JobState;
  progress: number;
  inputFormat: FormatId;
  outputFormat: FormatId;
  preset: QualityPreset;
  inputPath: string;
  outputPath: string;
  outputName: string;
  directory: string;
  inputBytes: number;
  outputBytes?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  lastAccessedAt: number;
  cancelRequested: boolean;
  child?: ChildProcess;
}

export interface ServiceLimits {
  maxUploadBytes: number;
  maxConcurrentJobs: number;
  maxRetainedJobs: number;
  jobTtlMs: number;
  processTimeoutMs: number;
}

export interface RuntimeOptions {
  host: string;
  port: number;
  tokenFile: string;
  pairingToken?: string;
  tempDirectory: string;
  allowedExtensionIds: ReadonlySet<string>;
  allowedDevOrigins: ReadonlySet<string>;
  limits: ServiceLimits;
}

export function isFormatId(value: string): value is FormatId {
  return (FORMAT_IDS as readonly string[]).includes(value);
}

export function isQualityPreset(value: string): value is QualityPreset {
  return value === 'high' || value === 'balanced' || value === 'small';
}
