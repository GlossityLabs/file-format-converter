import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { zipSync } from 'fflate';
import type { ConversionProgress, ConversionResult, QualityPreset } from '../core/types';
import { makeOutputFileName, splitFileName } from '../core/filenames';
import { canvasToBlob } from './image';

const MAX_RENDERED_ARCHIVE_BYTES = 250 * 1024 * 1024;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Conversion canceled.', 'AbortError');
}

function renderScale(preset: QualityPreset): number {
  if (preset === 'high') return 2;
  if (preset === 'small') return 1;
  return 1.5;
}

function jpegQuality(preset: QualityPreset): number {
  if (preset === 'high') return 0.94;
  if (preset === 'small') return 0.68;
  return 0.84;
}

export async function convertPdfToImages(
  file: File,
  output: 'png' | 'jpg',
  preset: QualityPreset,
  onProgress?: (progress: ConversionProgress) => void,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  throwIfAborted(signal);
  onProgress?.({ phase: 'loading', value: 3 });
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });

  try {
    const pdfDocument = await loadingTask.promise;
    if (pdfDocument.numPages === 0) throw new Error('The PDF contains no pages.');
    const files: Record<string, Uint8Array> = {};
    let renderedBytes = 0;
    const digits = Math.max(2, String(pdfDocument.numPages).length);
    const baseName = splitFileName(file.name).stem || 'document';

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      throwIfAborted(signal);
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: renderScale(preset) });
      if (viewport.width * viewport.height > 80_000_000) {
        throw new Error(`PDF page ${pageNumber} is too large to render safely in the browser.`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: output === 'png' });
      if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
      if (output === 'jpg') {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      const renderTask = page.render({ canvas, canvasContext: context, viewport });
      const abortRender = () => renderTask.cancel();
      signal?.addEventListener('abort', abortRender, { once: true });
      try {
        await renderTask.promise;
      } finally {
        signal?.removeEventListener('abort', abortRender);
        page.cleanup();
      }
      throwIfAborted(signal);
      const blob = await canvasToBlob(canvas, output === 'jpg' ? 'image/jpeg' : 'image/png', output === 'jpg' ? jpegQuality(preset) : undefined);
      renderedBytes += blob.size;
      if (renderedBytes > MAX_RENDERED_ARCHIVE_BYTES) {
        throw new Error('The rendered PDF pages exceed the browser’s safe archive limit. Try the Small preset or split the PDF.');
      }
      files[`${baseName}-page-${String(pageNumber).padStart(digits, '0')}.${output}`] = new Uint8Array(await blob.arrayBuffer());
      onProgress?.({ phase: 'converting', value: Math.round(5 + (pageNumber / pdfDocument.numPages) * 88) });
    }

    throwIfAborted(signal);
    onProgress?.({ phase: 'finalizing', value: 96 });
    const zipped = zipSync(files, { level: preset === 'small' ? 9 : 6 });
    return {
      blob: new Blob([zipped as BlobPart], { type: 'application/zip' }),
      fileName: makeOutputFileName(file.name, 'pdf', output),
    };
  } finally {
    await loadingTask.destroy();
  }
}
