import { describe, expect, it } from 'vitest';
import { applyLayoutToPageRange, buildConversionPlan, createCropBoxes, createDetectedPagePlan, createPagePlan, parsePageRange, pdfBoxToVisualRect, previewRectToPdfBox } from '../../src/pdf/grid';
import { suggestLayoutFromImage } from '../../src/pdf/layout-detect';
import { createGridImageData } from '../fixtures/generate-fixtures';

const pageBox = { x: 0, y: 0, width: 600, height: 400 };

describe('grid crop generation', () => {
  it('creates row-major PDF-space crops for 3x2 reading order', () => {
    const crops = createCropBoxes(0, pageBox, 'three-by-two');
    expect(crops).toHaveLength(6);
    expect(crops.map((crop) => crop.label)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(crops[0]).toMatchObject({ x: 0, y: 200, width: 200, height: 200 });
    expect(crops[5]).toMatchObject({ x: 400, y: 0, width: 200, height: 200 });
  });

  it('rejects invalid page ranges and applies valid layout ranges exactly', () => {
    const pages = [
      createPagePlan(0, pageBox, 'one-up'),
      createPagePlan(1, pageBox, 'one-up'),
      createPagePlan(2, pageBox, 'one-up'),
    ];
    expect([...parsePageRange('1, 3', 3)]).toEqual([0, 2]);
    const updated = applyLayoutToPageRange(pages, '2-3', 'two-by-two');
    expect(updated.map((page) => page.layoutId)).toEqual(['one-up', 'two-by-two', 'two-by-two']);
    expect(() => parsePageRange('0-2', 3)).toThrow(/outside/);
  });

  it('maps preview top-left canvas rectangles to bottom-left PDF coordinates', () => {
    const crop = previewRectToPdfBox({ x: 150, y: 100, width: 150, height: 100 }, { width: 600, height: 400 }, pageBox);
    expect(crop).toEqual({ x: 150, y: 200, width: 150, height: 100 });
    expect(pdfBoxToVisualRect(crop, pageBox)).toEqual({ x: 150, y: 100, width: 150, height: 100 });
  });

  it('maps visual grid cells back to PDF crop boxes for rotated pages', () => {
    const rotatedPageBox = { x: 0, y: 0, width: 420, height: 300, rotation: 90 };
    const crops = createCropBoxes(0, rotatedPageBox, 'two-up-vertical');

    expect(crops).toHaveLength(2);
    expect(crops[0]).toMatchObject({ x: 0, y: 0, width: 210, height: 300 });
    expect(crops[1]).toMatchObject({ x: 210, y: 0, width: 210, height: 300 });

    const previewCrop = previewRectToPdfBox({ x: 0, y: 0, width: 300, height: 210 }, { width: 300, height: 420 }, rotatedPageBox);
    expect(previewCrop).toEqual({ x: 0, y: 0, width: 210, height: 300 });
    expect(pdfBoxToVisualRect(previewCrop, rotatedPageBox)).toEqual({ x: 0, y: 0, width: 300, height: 210 });
  });

  it('projects automatic crops from detected grid geometry instead of regenerating from layoutId', () => {
    const plan = createDetectedPagePlan(0, pageBox, {
      layoutId: 'one-up',
      grid: { label: 'Detected six slides', columns: 3, rows: 2, readingOrder: 'row-major' },
      confidence: 'high',
      reason: 'Detected six slide regions.',
      score: 0.9,
      source: 'projection-profile',
      visualCropRects: detectedVisualRects(3, 2, pageBox.width / 3, pageBox.height / 2),
    });

    expect(plan.layoutId).toBe('one-up');
    expect(plan.grid).toMatchObject({ columns: 3, rows: 2 });
    expect(plan.cropBoxes).toHaveLength(6);
    expect(plan.cropBoxes[0]).toMatchObject({ x: 0, y: 200, width: 200, height: 200 });
    expect(plan.detection).toMatchObject({ source: 'projection-profile', cropProjection: 'detected-grid' });
  });

  it('projects shuffled automatic crop rectangles in row-major output order', () => {
    const visualRects = detectedVisualRects(2, 2, pageBox.width / 2, pageBox.height / 2);
    const plan = createDetectedPagePlan(0, pageBox, {
      layoutId: 'two-by-two',
      grid: { label: 'Detected four slides', columns: 2, rows: 2, readingOrder: 'row-major' },
      confidence: 'high',
      reason: 'Detected four slide regions.',
      score: 0.9,
      source: 'projection-profile',
      visualCropRects: [visualRects[2]!, visualRects[1]!, visualRects[3]!, visualRects[0]!],
    });

    expect(plan.cropBoxes.map((crop) => [crop.label, crop.row, crop.column, crop.x, crop.y])).toEqual([
      ['1', 0, 0, 0, 200],
      ['2', 0, 1, 300, 200],
      ['3', 1, 0, 0, 0],
      ['4', 1, 1, 300, 0],
    ]);
    expect(plan.detection?.cropRects.map((crop) => [crop.label, crop.row, crop.column])).toEqual([
      ['1', 0, 0],
      ['2', 0, 1],
      ['3', 1, 0],
      ['4', 1, 1],
    ]);
  });

  it('fails closed when automatic detection has grid metadata but no crop rectangles', () => {
    const plan = createDetectedPagePlan(0, pageBox, {
      layoutId: 'three-by-two',
      grid: { label: 'Detected six slides', columns: 3, rows: 2, readingOrder: 'row-major' },
      confidence: 'high',
      reviewState: 'ready',
      reason: 'Detected grid metadata was missing crop geometry.',
      score: 0.9,
      source: 'projection-profile',
    });

    expect(plan.reviewState).toBe('review-needed');
    expect(plan.cropBoxes).toEqual([]);
    expect(plan.detection).toMatchObject({ outcome: 'review-needed', cropProjection: 'none' });
  });

  it('keeps uncertain automatic pages review-needed without creating a full-page fallback crop', () => {
    const plan = createDetectedPagePlan(0, pageBox, {
      layoutId: 'one-up',
      confidence: 'review-needed',
      reviewState: 'review-needed',
      reason: 'No reliable separators detected.',
      score: 0.45,
      source: 'analysis-failed',
    });

    expect(plan.reviewState).toBe('review-needed');
    expect(plan.cropBoxes).toEqual([]);
    expect(plan.detection).toMatchObject({ source: 'analysis-failed', cropProjection: 'none' });
  });
});

function detectedVisualRects(columns: number, rows: number, cellWidth: number, cellHeight: number) {
  return Array.from({ length: columns * rows }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const order = index + 1;
    const x = column * cellWidth;
    const y = row * cellHeight;
    return {
      x,
      y,
      width: cellWidth,
      height: cellHeight,
      analysisRect: { x, y, width: cellWidth, height: cellHeight },
      order,
      label: String(order),
      row,
      column,
    };
  });
}

describe('layout detection', () => {
  it('detects visible 3x2 grid separators from raster data', () => {
    const suggestion = suggestLayoutFromImage(createGridImageData(3, 2), pageBox);
    expect(suggestion.layoutId).toBe('three-by-two');
    expect(suggestion.confidence).not.toBe('low');
  });

  it('detects visible 2x2 grid separators from raster data', () => {
    const suggestion = suggestLayoutFromImage(createGridImageData(2, 2), pageBox);
    expect(suggestion.layoutId).toBe('two-by-two');
    expect(suggestion.score).toBeGreaterThan(0.5);
  });

  it('treats exact 1x1 raster detection as a detected one-up crop, not fallback review', () => {
    const suggestion = suggestLayoutFromImage(createGridImageData(1, 1), pageBox);
    expect(suggestion).toMatchObject({ layoutId: 'one-up', confidence: 'medium', reviewState: 'ready' });
    expect(suggestion.grid).toMatchObject({ columns: 1, rows: 1 });
  });

  it('marks blank or unsupported automatic raster analysis review-needed instead of silently exporting a preset', () => {
    const blank = { width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4).fill(255), colorSpace: 'srgb' } as ImageData;
    const blankSuggestion = suggestLayoutFromImage(blank, pageBox);
    expect(blankSuggestion).toMatchObject({ layoutId: 'one-up', confidence: 'review-needed', reviewState: 'review-needed' });
    expect(blankSuggestion.grid).toBeUndefined();

    const unsupportedSuggestion = suggestLayoutFromImage(createGridImageData(3, 1), pageBox);
    expect(unsupportedSuggestion).toMatchObject({ confidence: 'review-needed', reviewState: 'review-needed' });
  });

  it('does not include review-needed automatic pages in export regions before manual layout override', () => {
    const reviewPage = createDetectedPagePlan(0, pageBox, {
      layoutId: 'one-up',
      confidence: 'review-needed',
      reviewState: 'review-needed',
      reason: 'Ambiguous automatic analysis.',
      score: 0.35,
      source: 'projection-profile',
    });
    const plan = buildConversionPlan('review-needed.pdf', [reviewPage], 1024);
    expect(plan.estimatedOutputPages).toBe(0);
    expect(plan.regions).toEqual([]);

    const corrected = applyLayoutToPageRange([reviewPage], '1', 'one-up')[0]!;
    expect(corrected.reviewState).toBe('ready');
    expect(buildConversionPlan('corrected.pdf', [corrected], 1024).regions).toHaveLength(1);
  });
});
