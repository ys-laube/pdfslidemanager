import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  A4_LANDSCAPE_BACKGROUND,
  A4_LANDSCAPE_PAGE,
  convertPdfSlides,
  createWorkloadWarnings,
  fitCropWithinA4Landscape,
  validateCropBox,
  type ConversionPlan,
} from '../../src/pdf/convert';

async function makeSourcePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 400]);
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 400 });
  page.drawRectangle({ x: 300, y: 0, width: 300, height: 400 });
  return pdf.save();
}

describe('convertPdfSlides', () => {
  it('creates A4 landscape output pages in confirmed reading order without mutating source bytes', async () => {
    const sourceBytes = await makeSourcePdf();
    const sourceBefore = Array.from(sourceBytes);
    const plan: ConversionPlan = {
      regions: [
        { sourcePageIndex: 0, cropBox: { left: 0, bottom: 0, width: 300, height: 400 }, label: 'left slide' },
        { sourcePageIndex: 0, cropBox: { left: 300, bottom: 0, width: 300, height: 400 }, label: 'right slide' },
      ],
      sourcePageCount: 1,
    };

    const result = await convertPdfSlides(sourceBytes, plan);
    const outputPdf = await PDFDocument.load(result.bytes);

    expect(outputPdf.getPageCount()).toBe(2);
    expect(outputPdf.getPage(0).getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
    expect(outputPdf.getPage(0).getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
    expect(outputPdf.getPage(1).getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
    expect(outputPdf.getPage(1).getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
    expect(result.sourceHashBefore).toBe(result.sourceHashAfter);
    expect(Array.from(sourceBytes)).toEqual(sourceBefore);
  });

  it('contains non-A4 crops on an explicit white A4 landscape canvas', () => {
    const placement = fitCropWithinA4Landscape({ width: 300, height: 400 });

    expect(placement).toMatchObject({
      pageWidth: A4_LANDSCAPE_PAGE.width,
      pageHeight: A4_LANDSCAPE_PAGE.height,
      drawWidth: 446.456693,
      drawHeight: A4_LANDSCAPE_PAGE.height,
      drawY: 0,
    });
    expect(placement.drawX).toBeGreaterThan(190);
    expect(placement.drawX).toBeLessThan(200);
    expect(A4_LANDSCAPE_BACKGROUND).toEqual({ red: 1, green: 1, blue: 1 });
  });

  it('rejects crop boxes outside the effective page bounds', () => {
    expect(() =>
      validateCropBox({ left: 590, bottom: 0, width: 20, height: 20 }, { left: 0, bottom: 0, width: 600, height: 400 }, 'bad crop'),
    ).toThrow(/outside the effective source page box/);
  });

  it('returns soft workload warnings for large browser-only conversion estimates', () => {
    const warnings = createWorkloadWarnings({
      sourceBytes: 101 * 1024 * 1024,
      sourcePageCount: 201,
      estimatedOutputPages: 1001,
    });

    expect(warnings.map((warning) => warning.code)).toEqual(['large-source-file', 'many-source-pages', 'many-output-pages']);
  });
});
