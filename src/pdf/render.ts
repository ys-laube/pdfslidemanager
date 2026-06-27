import type { AnalysisRenderMetadata, PdfBox } from '../types';
import type { PdfJsDocumentLike, PdfJsViewportLike } from './load';

export type { PdfJsViewportLike } from './load';
export type PdfRect = PdfBox;

export interface AnalysisRenderResult {
  imageData: ImageData;
  metadata: AnalysisRenderMetadata;
}

export async function renderPdfPageForAnalysis(pdf: PdfJsDocumentLike, pageNumber: number, maxWidth = 360): Promise<ImageData> {
  return (await renderPdfPageForAnalysisWithMetadata(pdf, pageNumber, maxWidth)).imageData;
}

export async function renderPdfPageForAnalysisWithMetadata(pdf: PdfJsDocumentLike, pageNumber: number, maxWidth = 360): Promise<AnalysisRenderResult> {
  const canvas = document.createElement('canvas');
  const viewport = await renderPdfPageToCanvas(pdf, pageNumber, canvas, maxWidth);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D context is unavailable for preview analysis.');
  return {
    imageData: context.getImageData(0, 0, canvas.width, canvas.height),
    metadata: {
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      visualWidth: viewport.width,
      visualHeight: viewport.height,
      scaleX: viewport.width / Math.max(1, canvas.width),
      scaleY: viewport.height / Math.max(1, canvas.height),
      pageNumber,
      maxWidth,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
  };
}

export async function renderPdfPageToCanvas(pdf: PdfJsDocumentLike, pageNumber: number, canvas: HTMLCanvasElement, maxWidth = 860): Promise<PdfJsViewportLike> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, Math.max(0.2, maxWidth / Math.max(1, baseViewport.width)));
  const viewport = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(viewport.width * ratio);
  canvas.height = Math.round(viewport.height * ratio);
  canvas.style.width = `${Math.round(viewport.width)}px`;
  canvas.style.height = `${Math.round(viewport.height)}px`;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable.');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  await page.render({ canvasContext: context, viewport }).promise;
  return viewport;
}

export async function renderPageToCanvas(pdf: PdfJsDocumentLike, pageNumber: number, canvas: HTMLCanvasElement, maxWidth = 860): Promise<PdfJsViewportLike> {
  return renderPdfPageToCanvas(pdf, pageNumber, canvas, maxWidth);
}

export function pdfRectToViewportRect(viewport: PdfJsViewportLike, rect: PdfBox): PdfBox {
  if (viewport.convertToViewportRectangle) {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
  return rect;
}

export function viewportRectToPdfRect(viewport: PdfJsViewportLike, rect: PdfBox): PdfBox {
  if (viewport.convertToPdfPoint) {
    const [x1, y1] = viewport.convertToPdfPoint(rect.x, rect.y + rect.height);
    const [x2, y2] = viewport.convertToPdfPoint(rect.x + rect.width, rect.y);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
  return rect;
}
