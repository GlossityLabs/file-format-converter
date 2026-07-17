import type { FormatId, QualityPreset, Recipe } from './contracts.js';

const DOCUMENT_FORMATS = ['doc', 'docx', 'odt', 'rtf'] as const satisfies readonly FormatId[];
const SPREADSHEET_FORMATS = ['xls', 'xlsx', 'ods', 'csv'] as const satisfies readonly FormatId[];
const PRESENTATION_FORMATS = ['ppt', 'pptx', 'odp'] as const satisfies readonly FormatId[];
const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] as const satisfies readonly FormatId[];
const VIDEO_FORMATS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'gif'] as const satisfies readonly FormatId[];

function pairWithin(formats: readonly FormatId[], includePdf: boolean, requires: Recipe['requires']): Recipe[] {
  const outputs = includePdf ? [...formats, 'pdf' as const] : [...formats];
  return formats.flatMap((input) =>
    outputs
      .filter((output) => output !== input)
      .map((output) => ({ input, output, requires })),
  );
}

export const ALLOWED_RECIPES: readonly Recipe[] = Object.freeze([
  ...pairWithin(DOCUMENT_FORMATS, true, 'libreoffice'),
  { input: 'txt', output: 'pdf', requires: 'libreoffice' },
  ...pairWithin(SPREADSHEET_FORMATS, true, 'libreoffice'),
  ...pairWithin(PRESENTATION_FORMATS, true, 'libreoffice'),
  ...pairWithin(AUDIO_FORMATS, false, 'ffmpeg'),
  ...pairWithin(VIDEO_FORMATS, false, 'ffmpeg'),
  ...VIDEO_FORMATS.flatMap((input) =>
    AUDIO_FORMATS.map((output) => ({ input, output, requires: 'ffmpeg' as const })),
  ),
]);

const RECIPE_MAP = new Map(
  ALLOWED_RECIPES.map((recipe) => [`${recipe.input}:${recipe.output}`, recipe] as const),
);

export function findRecipe(input: FormatId, output: FormatId): Recipe | undefined {
  return RECIPE_MAP.get(`${input}:${output}`);
}

const AUDIO_BITRATE: Record<QualityPreset, string> = {
  high: '256k',
  balanced: '192k',
  small: '128k',
};

const VIDEO_CRF: Record<QualityPreset, string> = {
  high: '18',
  balanced: '23',
  small: '30',
};

const VIDEO_PRESET: Record<QualityPreset, string> = {
  high: 'slow',
  balanced: 'medium',
  small: 'fast',
};

export function ffmpegOutputArguments(output: FormatId, preset: QualityPreset): string[] {
  const bitrate = AUDIO_BITRATE[preset];
  switch (output) {
    case 'mp3':
      return ['-vn', '-c:a', 'libmp3lame', '-b:a', bitrate];
    case 'wav':
      return ['-vn', '-c:a', 'pcm_s16le'];
    case 'flac':
      return ['-vn', '-c:a', 'flac'];
    case 'm4a':
    case 'aac':
      return ['-vn', '-c:a', 'aac', '-b:a', bitrate];
    case 'ogg':
      return ['-vn', '-c:a', 'libvorbis', '-b:a', bitrate];
    case 'opus':
      return ['-vn', '-c:a', 'libopus', '-b:a', bitrate];
    case 'webm':
      return [
        '-c:v',
        'libvpx-vp9',
        '-crf',
        VIDEO_CRF[preset],
        '-b:v',
        '0',
        '-c:a',
        'libopus',
        '-b:a',
        bitrate,
      ];
    case 'avi':
      return ['-c:v', 'mpeg4', '-q:v', preset === 'high' ? '2' : preset === 'balanced' ? '5' : '8', '-c:a', 'libmp3lame', '-b:a', bitrate];
    case 'gif':
      return [
        '-an',
        '-vf',
        `fps=${preset === 'small' ? '8' : '12'},scale=${preset === 'high' ? '1280' : preset === 'balanced' ? '960' : '640'}:-2:flags=lanczos`,
        '-loop',
        '0',
      ];
    case 'mp4':
    case 'mov':
    case 'm4v':
    case 'mkv':
      return [
        '-c:v',
        'libx264',
        '-preset',
        VIDEO_PRESET[preset],
        '-crf',
        VIDEO_CRF[preset],
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        bitrate,
        ...(output === 'mp4' || output === 'mov' || output === 'm4v'
          ? ['-movflags', '+faststart']
          : []),
      ];
    default:
      throw new Error('No native media encoder is configured for the requested output.');
  }
}

export function libreOfficeFilter(output: FormatId): string {
  const filters: Partial<Record<FormatId, string>> = {
    pdf: 'pdf',
    doc: 'doc:MS Word 97',
    docx: 'docx:Office Open XML Text',
    odt: 'odt:writer8',
    rtf: 'rtf:Rich Text Format',
    xls: 'xls:MS Excel 97',
    xlsx: 'xlsx:Calc MS Excel 2007 XML',
    ods: 'ods:calc8',
    csv: 'csv:Text - txt - csv (StarCalc)',
    ppt: 'ppt:MS PowerPoint 97',
    pptx: 'pptx:Impress MS PowerPoint 2007 XML',
    odp: 'odp:impress8',
  };
  const filter = filters[output];
  if (!filter) throw new Error('No LibreOffice filter is configured for the requested output.');
  return filter;
}
