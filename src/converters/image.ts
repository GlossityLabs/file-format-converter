import type { ConversionResult, FormatId, QualityPreset } from '../core/types';
import { makeOutputFileName } from '../core/filenames';

const MAX_CANVAS_PIXELS = 80_000_000;

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

function ensureCanvasSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The image has invalid dimensions.');
  }
  if (width * height > MAX_CANVAS_PIXELS) {
    throw new Error('The image dimensions are too large to process safely in the browser.');
  }
}

async function loadImage(file: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    ensureCanvasSize(bitmap.width, bitmap.height);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The browser could not decode this image.'));
      image.src = url;
    });
    ensureCanvasSize(image.naturalWidth, image.naturalHeight);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function qualityFor(preset: QualityPreset): number {
  if (preset === 'high') return 0.95;
  if (preset === 'small') return 0.68;
  return 0.84;
}

function createCanvas(image: LoadedImage, opaque: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
  if (opaque) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image.source, 0, 0, image.width, image.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`The browser could not encode ${mimeType}.`))),
      mimeType,
      quality,
    );
  });
}

export async function convertImage(
  file: File,
  input: Extract<FormatId, 'png' | 'jpg' | 'webp'>,
  output: Extract<FormatId, 'png' | 'jpg' | 'webp'>,
  preset: QualityPreset,
): Promise<ConversionResult> {
  const image = await loadImage(file);
  try {
    const mimeType = output === 'jpg' ? 'image/jpeg' : `image/${output}`;
    const canvas = createCanvas(image, output === 'jpg');
    const blob = await canvasToBlob(canvas, mimeType, output === 'png' ? undefined : qualityFor(preset));
    return { blob, fileName: makeOutputFileName(file.name, input, output) };
  } finally {
    image.close();
  }
}

export async function convertImageToPdf(
  file: File,
  input: Extract<FormatId, 'png' | 'jpg' | 'webp'>,
): Promise<ConversionResult> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  let imageBytes = new Uint8Array(await file.arrayBuffer());
  let embedded;
  if (input === 'jpg') {
    embedded = await pdf.embedJpg(imageBytes);
  } else if (input === 'png') {
    embedded = await pdf.embedPng(imageBytes);
  } else {
    const image = await loadImage(file);
    try {
      const png = await canvasToBlob(createCanvas(image, false), 'image/png');
      imageBytes = new Uint8Array(await png.arrayBuffer());
      embedded = await pdf.embedPng(imageBytes);
    } finally {
      image.close();
    }
  }

  const width = embedded.width * 0.75;
  const height = embedded.height * 0.75;
  const page = pdf.addPage([width, height]);
  page.drawImage(embedded, { x: 0, y: 0, width, height });
  const bytes = await pdf.save({ useObjectStreams: true });
  return {
    blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
    fileName: makeOutputFileName(file.name, input, 'pdf'),
  };
}
