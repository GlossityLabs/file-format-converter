import type { FormatDefinition, FormatId } from './types';

export const FORMAT_DEFINITIONS = [
  { id: 'png', label: 'PNG image', category: 'image', extensions: ['png'], mimeTypes: ['image/png'] },
  { id: 'jpg', label: 'JPEG image', category: 'image', extensions: ['jpg', 'jpeg', 'jpe'], mimeTypes: ['image/jpeg'] },
  { id: 'webp', label: 'WebP image', category: 'image', extensions: ['webp'], mimeTypes: ['image/webp'] },
  { id: 'gif', label: 'GIF image', category: 'image', extensions: ['gif'], mimeTypes: ['image/gif'] },
  { id: 'pdf', label: 'PDF document', category: 'pdf', extensions: ['pdf'], mimeTypes: ['application/pdf'] },
  { id: 'csv', label: 'CSV data', category: 'data', extensions: ['csv'], mimeTypes: ['text/csv', 'application/csv'] },
  { id: 'json', label: 'JSON data', category: 'data', extensions: ['json'], mimeTypes: ['application/json', 'text/json'] },
  { id: 'txt', label: 'Plain text', category: 'document', extensions: ['txt', 'text'], mimeTypes: ['text/plain'] },
  { id: 'doc', label: 'Word 97–2003 document', category: 'document', extensions: ['doc'], mimeTypes: ['application/msword'] },
  { id: 'docx', label: 'Word document', category: 'document', extensions: ['docx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  { id: 'odt', label: 'OpenDocument text', category: 'document', extensions: ['odt'], mimeTypes: ['application/vnd.oasis.opendocument.text'] },
  { id: 'rtf', label: 'Rich Text Format', category: 'document', extensions: ['rtf'], mimeTypes: ['application/rtf', 'text/rtf'] },
  { id: 'xls', label: 'Excel 97–2003 workbook', category: 'spreadsheet', extensions: ['xls'], mimeTypes: ['application/vnd.ms-excel'] },
  { id: 'xlsx', label: 'Excel workbook', category: 'spreadsheet', extensions: ['xlsx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  { id: 'ods', label: 'OpenDocument spreadsheet', category: 'spreadsheet', extensions: ['ods'], mimeTypes: ['application/vnd.oasis.opendocument.spreadsheet'] },
  { id: 'ppt', label: 'PowerPoint 97–2003 presentation', category: 'presentation', extensions: ['ppt'], mimeTypes: ['application/vnd.ms-powerpoint'] },
  { id: 'pptx', label: 'PowerPoint presentation', category: 'presentation', extensions: ['pptx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
  { id: 'odp', label: 'OpenDocument presentation', category: 'presentation', extensions: ['odp'], mimeTypes: ['application/vnd.oasis.opendocument.presentation'] },
  { id: 'mp3', label: 'MP3 audio', category: 'audio', extensions: ['mp3'], mimeTypes: ['audio/mpeg', 'audio/mp3'] },
  { id: 'wav', label: 'WAV audio', category: 'audio', extensions: ['wav', 'wave'], mimeTypes: ['audio/wav', 'audio/x-wav', 'audio/wave'] },
  { id: 'flac', label: 'FLAC audio', category: 'audio', extensions: ['flac'], mimeTypes: ['audio/flac', 'audio/x-flac'] },
  { id: 'm4a', label: 'M4A audio', category: 'audio', extensions: ['m4a'], mimeTypes: ['audio/mp4', 'audio/x-m4a'] },
  { id: 'aac', label: 'AAC audio', category: 'audio', extensions: ['aac'], mimeTypes: ['audio/aac', 'audio/x-aac'] },
  { id: 'ogg', label: 'Ogg audio', category: 'audio', extensions: ['ogg', 'oga'], mimeTypes: ['audio/ogg', 'application/ogg'] },
  { id: 'opus', label: 'Opus audio', category: 'audio', extensions: ['opus'], mimeTypes: ['audio/opus'] },
  { id: 'mp4', label: 'MP4 video', category: 'video', extensions: ['mp4'], mimeTypes: ['video/mp4'] },
  { id: 'mov', label: 'QuickTime video', category: 'video', extensions: ['mov', 'qt'], mimeTypes: ['video/quicktime'] },
  { id: 'mkv', label: 'Matroska video', category: 'video', extensions: ['mkv'], mimeTypes: ['video/x-matroska'] },
  { id: 'webm', label: 'WebM video', category: 'video', extensions: ['webm'], mimeTypes: ['video/webm'] },
  { id: 'avi', label: 'AVI video', category: 'video', extensions: ['avi'], mimeTypes: ['video/x-msvideo', 'video/avi'] },
  { id: 'm4v', label: 'M4V video', category: 'video', extensions: ['m4v'], mimeTypes: ['video/x-m4v'] },
] as const satisfies readonly FormatDefinition[];

export const FORMATS = FORMAT_DEFINITIONS;

export const FORMAT_REGISTRY = Object.freeze(
  Object.fromEntries(FORMAT_DEFINITIONS.map((format) => [format.id, format])) as unknown as Record<FormatId, FormatDefinition>,
);

const FORMAT_BY_EXTENSION = new Map<string, FormatId>();
const FORMATS_BY_MIME = new Map<string, FormatId[]>();

for (const format of FORMAT_DEFINITIONS) {
  for (const extension of format.extensions) FORMAT_BY_EXTENSION.set(extension, format.id);
  for (const mimeType of format.mimeTypes) {
    const key = mimeType.toLowerCase();
    FORMATS_BY_MIME.set(key, [...(FORMATS_BY_MIME.get(key) ?? []), format.id]);
  }
}

export function getFormat(id: FormatId): FormatDefinition {
  return FORMAT_REGISTRY[id];
}

export const getFormatDefinition = getFormat;

export function getFormatFromExtension(extensionOrName: string): FormatId | undefined {
  const finalSegment = extensionOrName.split(/[\\/]/).at(-1) ?? extensionOrName;
  const extension = finalSegment.includes('.') ? finalSegment.split('.').at(-1) : finalSegment;
  return extension ? FORMAT_BY_EXTENSION.get(extension.toLowerCase().replace(/^\./, '')) : undefined;
}

export function getFormatsFromMimeType(mimeType: string): readonly FormatId[] {
  return FORMATS_BY_MIME.get(mimeType.toLowerCase().split(';', 1)[0].trim()) ?? [];
}

export function isFormatId(value: string): value is FormatId {
  return Object.prototype.hasOwnProperty.call(FORMAT_REGISTRY, value);
}
