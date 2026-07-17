import type { ConversionProgress, ConversionResult, FormatId, QualityPreset } from '../core/types';
import { findRecipe } from '../core/recipes';
import { convertCsvToJson, convertJsonToCsv } from './csv-json';
import { convertImage, convertImageToPdf } from './image';
import { convertPdfToImages } from './pdf';

export interface BrowserConversionOptions {
  preset?: QualityPreset;
  signal?: AbortSignal;
  onProgress?: (progress: ConversionProgress) => void;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Conversion canceled.', 'AbortError');
}

export async function convertInBrowser(
  file: File,
  input: FormatId,
  output: FormatId,
  options: BrowserConversionOptions = {},
): Promise<ConversionResult> {
  const recipe = findRecipe(input, output);
  if (!recipe || recipe.engine !== 'browser') {
    throw new Error(`Browser conversion from ${input.toUpperCase()} to ${output.toUpperCase()} is not supported.`);
  }

  const preset = options.preset ?? 'balanced';
  throwIfAborted(options.signal);
  options.onProgress?.({ phase: 'loading', value: 5 });
  let result: ConversionResult;

  if (input === 'pdf' && (output === 'png' || output === 'jpg')) {
    return convertPdfToImages(file, output, preset, options.onProgress, options.signal);
  }
  if ((input === 'png' || input === 'jpg' || input === 'webp') && output === 'pdf') {
    options.onProgress?.({ phase: 'converting', value: 35 });
    result = await convertImageToPdf(file, input);
  } else if (
    (input === 'png' || input === 'jpg' || input === 'webp') &&
    (output === 'png' || output === 'jpg' || output === 'webp')
  ) {
    options.onProgress?.({ phase: 'converting', value: 35 });
    result = await convertImage(file, input, output, preset);
  } else if (input === 'csv' && output === 'json') {
    options.onProgress?.({ phase: 'converting', value: 35 });
    result = await convertCsvToJson(file);
  } else if (input === 'json' && output === 'csv') {
    options.onProgress?.({ phase: 'converting', value: 35 });
    result = await convertJsonToCsv(file);
  } else {
    throw new Error(`Browser conversion from ${input.toUpperCase()} to ${output.toUpperCase()} is not implemented.`);
  }

  throwIfAborted(options.signal);
  options.onProgress?.({ phase: 'finalizing', value: 95 });
  return result;
}

export const browserConvert = convertInBrowser;
