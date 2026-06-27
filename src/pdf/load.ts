import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { PageBox } from '../types';
import { hashBytes } from './hash';

export interface PdfJsPageLike {
  readonly view: [number, number, number, number];
  readonly rotate?: number;
  getViewport(options: { scale: number; rotation?: number }): PdfJsViewportLike;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewportLike }): { promise: Promise<void> };
}

export interface PdfJsViewportLike {
  readonly width: number;
  readonly height: number;
  convertToViewportRectangle?(rect: [number, number, number, number]): [number, number, number, number];
  convertToPdfPoint?(x: number, y: number): [number, number];
}

export interface PdfJsDocumentLike {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPageLike>;
  destroy?: () => Promise<void> | void;
}

export interface LoadedPdf {
  fileName: string;
  bytes: Uint8Array;
  sourceHash: string;
  pageBoxes: PageBox[];
  pdfJsDocument: PdfJsDocumentLike;
}

type PdfJsRuntime = {
  getDocument(options: { data: Uint8Array; useWorkerFetch: boolean; isEvalSupported: boolean; stopAtErrors: boolean }): { promise: Promise<PdfJsDocumentLike> };
  GlobalWorkerOptions: { workerSrc?: string };
};

export async function readPdfFile(file: File): Promise<LoadedPdf> {
  assertPdfFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('Choose a non-empty PDF file.');
  const runtime = pdfjsLib as unknown as PdfJsRuntime;
  runtime.GlobalWorkerOptions.workerSrc = workerSrc;
  const pdfJsDocument = await runtime.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
    stopAtErrors: true,
  }).promise;
  const pageBoxes: PageBox[] = [];
  for (let pageNumber = 1; pageNumber <= pdfJsDocument.numPages; pageNumber += 1) {
    const page = await pdfJsDocument.getPage(pageNumber);
    pageBoxes.push(pageBoxFromPdfJsPage(page));
  }
  return { fileName: file.name, bytes, sourceHash: await hashBytes(bytes), pageBoxes, pdfJsDocument };
}

export function pageBoxFromPdfJsPage(page: PdfJsPageLike): PageBox {
  const [x1, y1, x2, y2] = page.view;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    rotation: normalizeRotation(page.rotate ?? 0),
  };
}

export function assertPdfFile(file: File): void {
  const nameLooksPdf = file.name.toLowerCase().endsWith('.pdf');
  const typeLooksPdf = file.type === '' || file.type === 'application/pdf';
  if (!nameLooksPdf && !typeLooksPdf) throw new Error('Choose a PDF file.');
}

function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}
