import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import type { ConversionPlan as AppConversionPlan, CropBox, ExportResult, PageBox, PdfBox, WorkloadWarning } from '../types';
import { assertCropBoxesBounded } from './grid';
import { hashBytes } from './hash';

export type ConversionPlan = AppConversionPlan | LegacyConvertPlan;

export const A4_LANDSCAPE_PAGE = Object.freeze({
  width: 841.889764,
  height: 595.275591,
});

export const A4_LANDSCAPE_BACKGROUND = Object.freeze({
  red: 1,
  green: 1,
  blue: 1,
});

export interface ConversionProgress {
  completed: number;
  total: number;
  label: string;
}

export interface LegacyConvertPlan {
  regions?: Array<{ sourcePageIndex: number; cropBox: PdfBox | { left: number; bottom: number; width: number; height: number }; label?: string }>;
  sourcePageCount?: number;
}

export async function createSplitPdf(
  sourceBytes: Uint8Array,
  plan: AppConversionPlan,
  onProgress?: (progress: ConversionProgress) => void,
): Promise<ExportResult> {
  const result = await convertPdfSlides(sourceBytes, plan, onProgress);
  const sourceHash = await hashBytes(sourceBytes);
  return {
    bytes: result.bytes,
    outputFileName: plan.outputFileName,
    outputPageCount: result.outputPageCount,
    sourceHashBefore: sourceHash,
    sourceHashAfter: await hashBytes(sourceBytes),
  };
}

export async function convertPdfSlides(
  sourceBytes: Uint8Array,
  plan: AppConversionPlan | LegacyConvertPlan,
  onProgress?: (progress: ConversionProgress) => void,
): Promise<{ bytes: Uint8Array; outputPageCount: number; sourceHashBefore: string; sourceHashAfter: string }> {
  const sourceHashBefore = await hashBytes(sourceBytes);
  const sourceDoc = await PDFDocument.load(sourceBytes.slice(), { updateMetadata: false });
  const outputDoc = await PDFDocument.create();
  const sourcePages = sourceDoc.getPages();
  const regions = normalizeRegions(plan);
  let completed = 0;

  for (const region of regions) {
    const sourcePage = sourcePages[region.sourcePageIndex];
    if (!sourcePage) throw new Error(`Source page ${region.sourcePageIndex + 1} does not exist.`);
    const pageBox = getEffectivePageBox(sourcePage);
    const crop = normalizeCropBox(region.cropBox);
    assertCropBoxesBounded([crop], pageBox);
    await appendCropPage(outputDoc, sourcePage, crop);
    completed += 1;
    onProgress?.({ completed, total: regions.length, label: region.label ?? String(completed) });
  }

  const bytes = await outputDoc.save({ useObjectStreams: true });
  return { bytes, outputPageCount: regions.length, sourceHashBefore, sourceHashAfter: await hashBytes(sourceBytes) };
}

export async function extractPageBoxes(sourceBytes: Uint8Array): Promise<PageBox[]> {
  const sourceDoc = await PDFDocument.load(sourceBytes.slice(), { updateMetadata: false });
  return sourceDoc.getPages().map(getEffectivePageBox);
}

export function getEffectivePageBox(page: PDFPage): PageBox {
  const cropBox = page.getCropBox();
  const mediaBox = page.getMediaBox();
  const effective = cropBox.width > 0 && cropBox.height > 0 ? cropBox : mediaBox;
  return {
    x: roundPdfPoint(effective.x),
    y: roundPdfPoint(effective.y),
    width: roundPdfPoint(effective.width),
    height: roundPdfPoint(effective.height),
    rotation: page.getRotation().angle,
  };
}

export function validateCropBox(cropBox: PdfBox | { left: number; bottom: number; width: number; height: number }, effectiveBox: PageBox | { left: number; bottom: number; width: number; height: number }, label = 'crop box'): CropBox {
  const crop = normalizeCropBox(cropBox);
  const pageBox = normalizePageBox(effectiveBox);
  assertCropBoxesBounded([crop], pageBox);
  return { ...crop, left: crop.x, bottom: crop.y, pageIndex: 0, pageNumber: 1, order: 1, label, row: 0, column: 0 };
}

export function createWorkloadWarnings(input: {
  sourceBytes: number;
  sourcePageCount: number;
  estimatedOutputPages: number;
}): WorkloadWarning[] {
  const warnings: WorkloadWarning[] = [];
  if (input.sourceBytes > 100 * 1024 * 1024) warnings.push({ code: 'large-source-file', message: 'Large source PDF may need more browser memory.' });
  if (input.sourcePageCount > 200) warnings.push({ code: 'many-source-pages', message: 'Large page count may take longer to process locally.' });
  if (input.estimatedOutputPages > 1000) warnings.push({ code: 'many-output-pages', message: 'Estimated output is over 1000 pages.' });
  return warnings;
}

export interface A4LandscapePlacement {
  pageWidth: number;
  pageHeight: number;
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
}

export function fitCropWithinA4Landscape(crop: Pick<PdfBox, 'width' | 'height'>): A4LandscapePlacement {
  if (crop.width <= 0 || crop.height <= 0) throw new RangeError('Crop dimensions must be positive before A4 placement.');
  const scale = Math.min(A4_LANDSCAPE_PAGE.width / crop.width, A4_LANDSCAPE_PAGE.height / crop.height);
  const drawWidth = roundPdfPoint(crop.width * scale);
  const drawHeight = roundPdfPoint(crop.height * scale);
  return {
    pageWidth: A4_LANDSCAPE_PAGE.width,
    pageHeight: A4_LANDSCAPE_PAGE.height,
    drawX: roundPdfPoint((A4_LANDSCAPE_PAGE.width - drawWidth) / 2),
    drawY: roundPdfPoint((A4_LANDSCAPE_PAGE.height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  };
}

async function appendCropPage(outputDoc: PDFDocument, sourcePage: PDFPage, crop: PdfBox): Promise<void> {
  const [embeddedPage] = await outputDoc.embedPages([sourcePage], [
    { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height },
  ]);
  if (!embeddedPage) throw new Error('Unable to embed cropped source page.');
  const placement = fitCropWithinA4Landscape(crop);
  const outputPage = outputDoc.addPage([placement.pageWidth, placement.pageHeight]);
  outputPage.drawRectangle({
    x: 0,
    y: 0,
    width: placement.pageWidth,
    height: placement.pageHeight,
    color: rgb(A4_LANDSCAPE_BACKGROUND.red, A4_LANDSCAPE_BACKGROUND.green, A4_LANDSCAPE_BACKGROUND.blue),
  });
  outputPage.drawPage(embeddedPage, {
    x: placement.drawX,
    y: placement.drawY,
    width: placement.drawWidth,
    height: placement.drawHeight,
  });
}

function normalizeRegions(plan: AppConversionPlan | LegacyConvertPlan): Array<{ sourcePageIndex: number; cropBox: PdfBox | { left: number; bottom: number; width: number; height: number }; label?: string }> {
  if ('regions' in plan && plan.regions) return plan.regions;
  if ('pages' in plan) {
    return plan.pages.flatMap((page) => page.cropBoxes.map((cropBox) => ({ sourcePageIndex: page.pageIndex, cropBox, label: cropBox.label })));
  }
  return [];
}

function normalizeCropBox(crop: PdfBox | { left: number; bottom: number; width: number; height: number }): PdfBox {
  if ('left' in crop) return { x: crop.left, y: crop.bottom, width: crop.width, height: crop.height };
  return crop;
}

function normalizePageBox(box: PageBox | { left: number; bottom: number; width: number; height: number }): PageBox {
  if ('left' in box) return { x: box.left, y: box.bottom, width: box.width, height: box.height };
  return box;
}

function roundPdfPoint(value: number): number {
  return Number(value.toFixed(6));
}
