import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { A4_LANDSCAPE_PAGE, createSplitPdf, extractPageBoxes } from '../../src/pdf/convert';
import { buildConversionPlan, createPagePlan, estimateWorkloadWarnings } from '../../src/pdf/grid';
import type { LayoutPresetId } from '../../src/types';
import { createGridFixturePdf } from '../fixtures/generate-fixtures';

async function planFor(bytes: Uint8Array, layouts: LayoutPresetId[]) {
  const boxes = await extractPageBoxes(bytes);
  const pages = boxes.map((box, index) => createPagePlan(index, box, layouts[index] ?? 'one-up', 'high', 'Fixture plan'));
  return buildConversionPlan('fixture.pdf', pages, bytes.byteLength);
}

describe('PDF conversion', () => {
  it('converts a single 3x2 fixture page into 6 A4 landscape output PDF pages', async () => {
    const source = await createGridFixturePdf([{ layoutId: 'three-by-two' }]);
    const sourceCopy = source.slice();
    const plan = await planFor(source, ['three-by-two']);
    const result = await createSplitPdf(source, plan);
    const output = await PDFDocument.load(result.bytes);

    expect(output.getPageCount()).toBe(6);
    expect(result.outputPageCount).toBe(6);
    expect([...source]).toEqual([...sourceCopy]);
    expect(result.sourceHashBefore).toBe(result.sourceHashAfter);

    const firstPage = output.getPage(0);
    expect(firstPage.getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
    expect(firstPage.getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
  });

  it('converts 2x2 and mixed layout fixtures to expected page counts', async () => {
    const twoByTwo = await createGridFixturePdf([{ layoutId: 'two-by-two' }]);
    const twoByTwoResult = await createSplitPdf(twoByTwo, await planFor(twoByTwo, ['two-by-two']));
    expect((await PDFDocument.load(twoByTwoResult.bytes)).getPageCount()).toBe(4);

    const mixed = await createGridFixturePdf([
      { layoutId: 'one-up' },
      { layoutId: 'two-up-horizontal' },
      { layoutId: 'two-by-two' },
      { layoutId: 'three-by-two' },
    ]);
    const mixedResult = await createSplitPdf(
      mixed,
      await planFor(mixed, ['one-up', 'two-up-horizontal', 'two-by-two', 'three-by-two']),
    );
    expect((await PDFDocument.load(mixedResult.bytes)).getPageCount()).toBe(13);
  });

  it('uses a non-default CropBox as the effective split area before falling back to MediaBox', async () => {
    const source = await createGridFixturePdf([
      { layoutId: 'two-by-two', width: 600, height: 400, cropBox: { x: 50, y: 40, width: 500, height: 300 } },
    ]);
    const boxes = await extractPageBoxes(source);

    expect(boxes[0]).toMatchObject({ x: 50, y: 40, width: 500, height: 300, rotation: 0 });

    const plan = await planFor(source, ['two-by-two']);
    const result = await createSplitPdf(source, plan);
    const output = await PDFDocument.load(result.bytes);
    const firstPage = output.getPage(0);

    expect(output.getPageCount()).toBe(4);
    expect(firstPage.getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
    expect(firstPage.getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
    expect(result.sourceHashBefore).toBe(result.sourceHashAfter);
  });

  it('maps rotated visual layout to PDF crops and exports pages with matching PDF.js viewport orientation', async () => {
    const source = await createGridFixturePdf([{ layoutId: 'two-up-horizontal', width: 420, height: 300, rotation: 90 }]);
    const sourceCopy = source.slice();
    const boxes = await extractPageBoxes(source);

    expect(boxes[0]).toMatchObject({ x: 0, y: 0, width: 420, height: 300, rotation: 90 });

    const plan = await planFor(source, ['two-up-vertical']);
    expect(plan.pages[0]!.cropBoxes[0]).toMatchObject({ x: 0, y: 0, width: 210, height: 300 });
    expect(plan.pages[0]!.cropBoxes[1]).toMatchObject({ x: 210, y: 0, width: 210, height: 300 });
    await expectPdfJsViewportRect(source, plan.pages[0]!.cropBoxes[0]!, { x: 0, y: 0, width: 300, height: 210 });
    await expectPdfJsViewportRect(source, plan.pages[0]!.cropBoxes[1]!, { x: 0, y: 210, width: 300, height: 210 });

    const result = await createSplitPdf(source, plan);
    const output = await PDFDocument.load(result.bytes);
    const firstPage = output.getPage(0);
    const firstOutputViewport = await getPdfJsViewport(result.bytes, 1);

    expect(output.getPageCount()).toBe(2);
    expect(firstPage.getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
    expect(firstPage.getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
    expect(firstPage.getRotation().angle).toBe(0);
    expect(firstOutputViewport).toMatchObject({ width: Math.round(A4_LANDSCAPE_PAGE.width), height: Math.round(A4_LANDSCAPE_PAGE.height), rotation: 0 });
    expect([...source]).toEqual([...sourceCopy]);
    expect(result.sourceHashBefore).toBe(result.sourceHashAfter);
  });

  it('surfaces browser-only large workload soft warnings', () => {
    const warnings = estimateWorkloadWarnings(101 * 1024 * 1024, 201, 1_001);
    expect(warnings).toHaveLength(3);
    expect(warnings.join(' ')).toMatch(/browser export/i);
  });
});

async function getPdfJsViewport(bytes: Uint8Array, pageNumber: number): Promise<{ width: number; height: number; rotation: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    return { width: Math.round(viewport.width), height: Math.round(viewport.height), rotation: page.rotate };
  } finally {
    await task.destroy();
  }
}

async function expectPdfJsViewportRect(
  bytes: Uint8Array,
  crop: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const rect = viewport.convertToViewportRectangle([crop.x, crop.y, crop.x + crop.width, crop.y + crop.height]);
    const normalized = {
      x: Math.round(Math.min(rect[0], rect[2])),
      y: Math.round(Math.min(rect[1], rect[3])),
      width: Math.round(Math.abs(rect[2] - rect[0])),
      height: Math.round(Math.abs(rect[3] - rect[1])),
    };
    expect(normalized).toEqual(expected);
  } finally {
    await task.destroy();
  }
}
