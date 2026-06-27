import { describe, expect, it } from 'vitest';
import { A4_LANDSCAPE_PAGE, fitCropWithinA4Landscape } from '../../src/pdf/convert';
import { createPreviewStage, expectedOutputPreviewGeometry } from '../../src/ui/preview';
import type { CropBox, PagePlan } from '../../src/types';

describe('preview crop overlay', () => {
  it('renders overlay entries from actual cropBoxes, not from preset grid cell count', () => {
    const stage = createPreviewStage(createPageWithActualDetectedCrops());
    const overlay = stage.querySelector<HTMLOListElement>('[data-testid="crop-overlay"]');
    const labels = [...stage.querySelectorAll<HTMLElement>('[data-testid="crop-overlay"] li')].map((item) => item.textContent);

    expect(overlay).not.toBeNull();
    expect(labels).toEqual(['Actual left', 'Actual right']);
    expect(overlay?.style.gridTemplateColumns).toBe('repeat(1, 1fr)');
    expect(overlay?.style.gridTemplateRows).toBe('repeat(1, 1fr)');
    expect(stage.querySelectorAll('[data-testid="expected-output-canvas"]')).toHaveLength(2);
    expect(stage.querySelector('[data-testid="expected-output-preview"]')?.textContent).toContain('Expected output preview');
  });

  it('surfaces review-needed pages next to the overlay', () => {
    const page = createPageWithActualDetectedCrops({ reviewState: 'review-needed', confidence: 'review-needed' });
    const stage = createPreviewStage(page);

    expect(stage.querySelector('[data-testid="review-needed-page"]')?.textContent).toMatch(/review needed/i);
    expect(stage.querySelector('[data-testid="preview-summary"]')?.textContent).toContain('2 output slides');
  });

  it('emits crop-box updates when an expected output slide is deleted', () => {
    const updates: string[] = [];
    const stage = createPreviewStage(createPageWithActualDetectedCrops(), {
      onUpdateCropBoxes: (change) => {
        updates.push(`${change.interaction}:${change.fromIndex}:${change.cropBoxes.map((crop) => crop.label).join(',')}`);
      },
    });

    stage.querySelector<HTMLButtonElement>('[data-testid="expected-output-delete-button"]')?.click();

    expect(updates).toEqual(['delete:0:Actual right']);
  });

  it('maps a crop into the same A4 landscape contain placement used by export', () => {
    const page = createPageWithActualDetectedCrops();
    const crop = page.cropBoxes[0]!;
    const target = { width: 420, height: 297 };
    const geometry = expectedOutputPreviewGeometry({ width: 800, height: 600 }, crop, page.pageBox, target);
    const exportPlacement = fitCropWithinA4Landscape(crop);

    expect(geometry.sourceX).toBeCloseTo(40, 6);
    expect(geometry.sourceY).toBeCloseTo(80, 6);
    expect(geometry.sourceWidth).toBeCloseTo(340, 6);
    expect(geometry.sourceHeight).toBeCloseTo(440, 6);
    expect(geometry.targetWidth / geometry.targetHeight).toBeCloseTo(A4_LANDSCAPE_PAGE.width / A4_LANDSCAPE_PAGE.height, 2);
    expect(geometry.drawX).toBeCloseTo((exportPlacement.drawX / exportPlacement.pageWidth) * target.width, 6);
    expect(geometry.drawY).toBeCloseTo(
      ((exportPlacement.pageHeight - exportPlacement.drawY - exportPlacement.drawHeight) / exportPlacement.pageHeight) * target.height,
      6,
    );
    expect(geometry.drawWidth).toBeCloseTo((exportPlacement.drawWidth / exportPlacement.pageWidth) * target.width, 6);
    expect(geometry.drawHeight).toBeCloseTo((exportPlacement.drawHeight / exportPlacement.pageHeight) * target.height, 6);
  });
});

function createPageWithActualDetectedCrops(overrides: Partial<PagePlan> = {}): PagePlan {
  const cropBoxes = createActualCrops();
  return {
    pageIndex: 0,
    pageNumber: 1,
    layoutId: 'one-up',
    layout: 'one-up',
    grid: { label: 'Compatibility 1-up label', columns: 1, rows: 1 },
    pageBox: { x: 0, y: 0, width: 400, height: 300 },
    boxes: { mediaBox: { x: 0, y: 0, width: 400, height: 300 } },
    cropBoxes,
    crops: cropBoxes,
    confidence: 'high',
    reviewState: 'ready',
    reason: 'Detected crops are authoritative.',
    score: 0.91,
    overridden: false,
    cropOptions: { margin: {}, gutter: {} },
    ...overrides,
  };
}

function createActualCrops(): CropBox[] {
  return [
    {
      pageIndex: 0,
      pageNumber: 1,
      order: 1,
      label: 'Actual left',
      row: 0,
      column: 0,
      x: 20,
      y: 40,
      left: 20,
      bottom: 40,
      width: 170,
      height: 220,
    },
    {
      pageIndex: 0,
      pageNumber: 1,
      order: 2,
      label: 'Actual right',
      row: 0,
      column: 1,
      x: 210,
      y: 40,
      left: 210,
      bottom: 40,
      width: 170,
      height: 220,
    },
  ];
}
