import { PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { convertPdfSlides, createSplitPdf } from '../../src/pdf/convert';
import { buildConversionPlan, createCropBoxes, updatePageLayout } from '../../src/pdf/grid';
import type { CropBox, DetectionMetadata, GridSpec, PageBox, PagePlan } from '../../src/types';

const PAGE_BOX: PageBox = { x: 0, y: 0, width: 600, height: 900 };
const DETECTED_GRID: GridSpec = { label: 'Detected 2 columns × 3 rows', columns: 2, rows: 3, readingOrder: 'row-major' };
const DETECTED_CROPS = createDetectedTwoByThreeCrops();

describe('detected crop boxes flow through plan and export', () => {
  it('uses PagePlan.cropBoxes as the single plan geometry source instead of regenerating from layoutId', () => {
    const detectedPlan = createDetectedPagePlan();
    const conversionPlan = buildConversionPlan('off-center-handout.pdf', [detectedPlan], 42_000);
    const presetThreeByTwo = createCropBoxes(0, PAGE_BOX, 'three-by-two');

    expect(detectedPlan.layoutId).toBe('three-by-two');
    expect(detectedPlan.grid).toMatchObject({ columns: 2, rows: 3 });
    expect(conversionPlan.estimatedOutputPages).toBe(6);
    expect(conversionPlan.pages[0]?.cropBoxes).toEqual(DETECTED_CROPS);
    expect(conversionPlan.regions.map((region) => region.cropBox)).toEqual(DETECTED_CROPS);
    expect(conversionPlan.regions.map((region) => region.cropBox)).not.toEqual(presetThreeByTwo);
  });

  it('preserves off-center detected crops and avoids the right blank margin during PDF export', async () => {
    const sourceBytes = await createSyntheticSourcePdf();
    const conversionPlan = buildConversionPlan('off-center-handout.pdf', [createDetectedPagePlan()], sourceBytes.byteLength);
    const rightmostDetectedEdge = Math.max(...DETECTED_CROPS.map((crop) => crop.x + crop.width));

    expect(rightmostDetectedEdge).toBe(515);
    expect(PAGE_BOX.width - rightmostDetectedEdge).toBe(85);

    const result = await createSplitPdf(sourceBytes, conversionPlan);

    expect(result.outputPageCount).toBe(6);
    expect(result.outputFileName).toBe('off-center-handout-slides.pdf');
    expect(result.sourceHashAfter).toBe(result.sourceHashBefore);
  });

  it('ignores stale detection metadata when building export regions from cropBoxes', () => {
    const staleFullPageDetection: DetectionMetadata = {
      source: 'projection-profile',
      outcome: 'detected-grid',
      layoutId: 'three-by-two',
      confidence: 'high',
      score: 0.99,
      columns: 1,
      rows: 1,
      warnings: [],
      cropRects: [
        {
          x: 0,
          y: 0,
          width: PAGE_BOX.width,
          height: PAGE_BOX.height,
          analysisRect: { x: 0, y: 0, width: PAGE_BOX.width, height: PAGE_BOX.height },
          order: 1,
          label: 'Stale full-page metadata',
          row: 0,
          column: 0,
        },
      ],
    };
    const detectedPlan = { ...createDetectedPagePlan(), detection: staleFullPageDetection };

    const conversionPlan = buildConversionPlan('stale-detection-metadata.pdf', [detectedPlan], 42_000);

    expect(conversionPlan.regions.map((region) => region.cropBox)).toEqual(DETECTED_CROPS);
    expect(conversionPlan.regions[0]?.cropBox).not.toMatchObject({ x: 0, y: 0, width: PAGE_BOX.width, height: PAGE_BOX.height });
  });

  it('falls back to pages cropBoxes when a conversion plan has no precomputed regions', async () => {
    const sourceBytes = await createSyntheticSourcePdf();
    const conversionPlan = buildConversionPlan('pages-only-plan.pdf', [createDetectedPagePlan()], sourceBytes.byteLength);
    const { regions: _regions, ...pagesOnlyPlan } = conversionPlan;
    void _regions;

    const result = await convertPdfSlides(sourceBytes, pagesOnlyPlan as unknown as Parameters<typeof convertPdfSlides>[1]);

    expect(result.outputPageCount).toBe(DETECTED_CROPS.length);
    expect(result.sourceHashAfter).toBe(result.sourceHashBefore);
  });

  it('manual overrides intentionally regenerate crop boxes from the user-selected preset', () => {
    const detectedPlan = createDetectedPagePlan();
    const overridden = updatePageLayout(detectedPlan, 'one-up');

    expect(overridden.overridden).toBe(true);
    expect(overridden.reviewState).toBe('ready');
    expect(overridden.cropBoxes).toHaveLength(1);
    expect(overridden.cropBoxes).not.toEqual(DETECTED_CROPS);
    expect(overridden.cropBoxes[0]).toMatchObject({ x: 0, y: 0, width: 600, height: 900 });
  });
});

function createDetectedPagePlan(): PagePlan {
  return {
    pageIndex: 0,
    pageNumber: 1,
    layoutId: 'three-by-two',
    layout: 'three-by-two',
    grid: DETECTED_GRID,
    pageBox: PAGE_BOX,
    boxes: { mediaBox: PAGE_BOX },
    cropBoxes: DETECTED_CROPS,
    crops: DETECTED_CROPS,
    confidence: 'high',
    reviewState: 'ready',
    reason: 'Projection-profile detector found six off-center slide regions.',
    score: 0.94,
    overridden: false,
    cropOptions: { margin: {}, gutter: {} },
  };
}

function createDetectedTwoByThreeCrops(): CropBox[] {
  const left = 35;
  const top = 30;
  const cropWidth = 210;
  const cropHeight = 250;
  const gutterX = 60;
  const gutterY = 35;
  const crops: CropBox[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const order = crops.length + 1;
      const x = left + column * (cropWidth + gutterX);
      const y = PAGE_BOX.height - top - cropHeight - row * (cropHeight + gutterY);
      crops.push({
        pageIndex: 0,
        pageNumber: 1,
        order,
        label: `Detected ${order}`,
        row,
        column,
        x,
        y,
        left: x,
        bottom: y,
        width: cropWidth,
        height: cropHeight,
      });
    }
  }
  return crops;
}

async function createSyntheticSourcePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_BOX.width, PAGE_BOX.height]);
  for (const crop of DETECTED_CROPS) {
    page.drawRectangle({
      x: crop.x + 8,
      y: crop.y + 8,
      width: crop.width - 16,
      height: crop.height - 16,
      borderColor: rgb(0.1, 0.1, 0.1),
      borderWidth: 2,
    });
    page.drawText(crop.label, { x: crop.x + 18, y: crop.y + crop.height - 32, size: 18, color: rgb(0, 0, 0) });
  }
  page.drawText('Intentional blank margin', { x: 530, y: 430, size: 12, color: rgb(0.7, 0.7, 0.7) });
  return pdf.save();
}
