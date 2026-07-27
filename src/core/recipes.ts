import type { CompanionCapabilities, ConversionRecipe, FormatId } from './types';

function recipe(
  input: FormatId,
  output: FormatId,
  engine: ConversionRecipe['engine'],
  description: string,
  requires?: ConversionRecipe['requires'],
  fidelityNote?: string,
): ConversionRecipe {
  return { input, output, engine, description, ...(requires ? { requires } : {}), ...(fidelityNote ? { fidelityNote } : {}) };
}

const imageFormats = ['jpg', 'png', 'webp'] as const;
const browserImageRecipes = imageFormats.flatMap((input) =>
  imageFormats
    .filter((output) => output !== input)
    .map((output) => recipe(input, output, 'browser', `Convert ${input.toUpperCase()} to ${output.toUpperCase()} locally`)),
);

export const BROWSER_RECIPES: readonly ConversionRecipe[] = Object.freeze([
  ...browserImageRecipes,
  ...imageFormats.map((input) => recipe(input, 'pdf', 'browser', `Place ${input.toUpperCase()} in a PDF locally`)),
  recipe('pdf', 'png', 'browser', 'Render every PDF page to PNG and package the images as a ZIP archive'),
  recipe('pdf', 'jpg', 'browser', 'Render every PDF page to JPEG and package the images as a ZIP archive'),
  recipe('csv', 'json', 'browser', 'Convert a CSV table to an array of JSON objects locally'),
  recipe('json', 'csv', 'browser', 'Convert an array of JSON objects to CSV locally'),
]);

const libreOfficeToPdfInputs = ['doc', 'docx', 'odt', 'rtf', 'txt', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp'] as const;
const officeRoundTrips: readonly [FormatId, FormatId][] = [
  ['docx', 'odt'],
  ['odt', 'docx'],
  ['xlsx', 'ods'],
  ['ods', 'xlsx'],
  ['xlsx', 'csv'],
  ['csv', 'xlsx'],
  ['pptx', 'odp'],
  ['odp', 'pptx'],
];
const audioFormats = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] as const;
const videoInputs = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] as const;
const videoOutputs = ['mp4', 'webm', 'mov', 'mkv', 'gif', 'mp3', 'wav'] as const;
const gifVideoOutputs = ['mp4', 'webm', 'mov', 'mkv'] as const;

export const COMPANION_RECIPES: readonly ConversionRecipe[] = Object.freeze([
  ...libreOfficeToPdfInputs.map((input) =>
    recipe(input, 'pdf', 'companion', `Convert ${input.toUpperCase()} to PDF with LibreOffice`, 'libreoffice', 'Layout fidelity depends on the fonts installed on this computer.'),
  ),
  ...officeRoundTrips.map(([input, output]) =>
    recipe(input, output, 'companion', `Convert ${input.toUpperCase()} to ${output.toUpperCase()} with LibreOffice`, 'libreoffice'),
  ),
  ...audioFormats.flatMap((input) =>
    audioFormats
      .filter((output) => output !== input)
      .map((output) => recipe(input, output, 'companion', `Transcode ${input.toUpperCase()} to ${output.toUpperCase()} with FFmpeg`, 'ffmpeg')),
  ),
  ...videoInputs.flatMap((input) =>
    videoOutputs
      .filter((output) => output !== input)
      .map((output) => recipe(input, output, 'companion', `Convert ${input.toUpperCase()} to ${output.toUpperCase()} with FFmpeg`, 'ffmpeg')),
  ),
  ...gifVideoOutputs.map((output) =>
    recipe('gif', output, 'companion', `Convert animated GIF to ${output.toUpperCase()} with FFmpeg`, 'ffmpeg'),
  ),
]);

export const CONVERSION_RECIPES: readonly ConversionRecipe[] = Object.freeze([
  ...BROWSER_RECIPES,
  ...COMPANION_RECIPES,
]);

export const RECIPES = CONVERSION_RECIPES;

type CapabilityRecipe = { input: FormatId; output: FormatId; available?: boolean } | string;
type ExtendedCapabilities = CompanionCapabilities & { recipes?: readonly CapabilityRecipe[] };

function capabilityAdvertises(recipeToCheck: ConversionRecipe, capabilities: ExtendedCapabilities): boolean {
  if (!capabilities.recipes) return true;
  return capabilities.recipes.some((advertised) => {
    if (typeof advertised === 'string') {
      return advertised === `${recipeToCheck.input}:${recipeToCheck.output}` || advertised === `${recipeToCheck.input}->${recipeToCheck.output}`;
    }
    return advertised.input === recipeToCheck.input && advertised.output === recipeToCheck.output && advertised.available !== false;
  });
}

export function isRecipeAvailable(recipeToCheck: ConversionRecipe, capabilities?: CompanionCapabilities | null): boolean {
  if (recipeToCheck.engine === 'browser') return true;
  if (!capabilities?.paired || !recipeToCheck.requires) return false;
  if (!capabilities.tools[recipeToCheck.requires]?.available) return false;
  return capabilityAdvertises(recipeToCheck, capabilities as ExtendedCapabilities);
}

export function recipeUnavailableReason(
  recipeToCheck: ConversionRecipe,
  capabilities?: CompanionCapabilities | null,
): string | undefined {
  if (isRecipeAvailable(recipeToCheck, capabilities)) return undefined;
  if (recipeToCheck.engine === 'browser') return 'This browser conversion is not available.';
  if (!capabilities?.paired) {
    return 'Connect the Format Forge Mac app before using this conversion.';
  }
  if (recipeToCheck.requires === 'ffmpeg' && !capabilities.tools.ffmpeg.available) {
    return 'Audio and video conversion is not ready. Open Format Forge for Mac and check “Audio and video”, then retry.';
  }
  if (recipeToCheck.requires === 'libreoffice' && !capabilities.tools.libreoffice.available) {
    return 'Office conversion is not ready. Open Format Forge for Mac and check “Office documents”, then retry.';
  }
  if (recipeToCheck.requires === 'poppler' && !capabilities.tools.poppler.available) {
    return 'This Local Engine PDF conversion is not available. Supported PDF-to-image conversions run inside Chrome.';
  }
  return 'This conversion is not available in the connected Mac app. Update the app and reconnect.';
}

export function getAvailableRecipes(capabilities?: CompanionCapabilities | null): readonly ConversionRecipe[] {
  return CONVERSION_RECIPES.filter((candidate) => isRecipeAvailable(candidate, capabilities));
}

export function getRecipesForInput(input: FormatId, capabilities?: CompanionCapabilities | null): readonly ConversionRecipe[] {
  return getAvailableRecipes(capabilities).filter((candidate) => candidate.input === input);
}

export function getKnownRecipesForInput(input: FormatId): readonly ConversionRecipe[] {
  return CONVERSION_RECIPES.filter((candidate) => candidate.input === input);
}

export function findRecipe(input: FormatId, output: FormatId): ConversionRecipe | undefined {
  return CONVERSION_RECIPES.find((candidate) => candidate.input === input && candidate.output === output);
}

export function getOutputFormats(input: FormatId, capabilities?: CompanionCapabilities | null): readonly FormatId[] {
  return getRecipesForInput(input, capabilities).map((candidate) => candidate.output);
}
