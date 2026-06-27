import { describe, expect, it } from 'vitest';
import * as gridModule from '../../src/pdf/grid';
import {
  LAYOUT_PRESETS,
  applyCropBoxOverride,
  applyOutputCropBoxesOverride,
  applyCropTemplateToPageRange,
  applyPageRangeOverride,
  buildConversionPlan,
  createCropBoxes,
  createPagePlan,
  cropBoxesForGrid,
  pdfBoxToVisualRect,
  previewRectToPdfBox,
  updatePageCropOptions,
} from '../../src/pdf/grid';
import type { CropBox, GridSpec, LayoutPresetId, PageBox, PagePlan, PdfBox, ReadingOrder, SavedLayoutTemplate } from '../../src/types';

const TWO_BY_THREE = 'two-by-three' as LayoutPresetId;

interface CropTemplateRect {
  x: number;
  y: number;
  width: number;
  height: number;
  order: number;
  label: string;
  row: number;
  column: number;
}

interface CropTemplate {
  layoutId?: LayoutPresetId;
  label?: string;
  columns: number;
  rows: number;
  readingOrder: ReadingOrder;
  rects: CropTemplateRect[];
}

type MaterializeCropBoxesFromTemplate = (pageIndex: number, pageBox: PageBox, template: CropTemplate) => CropBox[];
type GetNextSavedLayoutName = (layouts: readonly SavedLayoutTemplate[]) => string;
interface CreateSavedLayoutTemplateOptions {
  id?: string;
  name?: string;
  existingLayouts?: readonly SavedLayoutTemplate[];
}

type CreateSavedLayoutTemplateFromPage = (
  page: PagePlan,
  optionsOrExistingLayouts?: CreateSavedLayoutTemplateOptions | readonly SavedLayoutTemplate[],
) => SavedLayoutTemplate;
type RenameSavedLayoutTemplate = (layouts: readonly SavedLayoutTemplate[], id: string, name: string) => SavedLayoutTemplate[];
type UpdateSavedLayoutTemplateFromPage = (savedLayout: SavedLayoutTemplate, page: PagePlan) => SavedLayoutTemplate;
type ApplySavedLayoutTemplateToPageRange = (pages: readonly PagePlan[], range: string, savedLayout: SavedLayoutTemplate) => PagePlan[];


describe('G001 geometry model regressions', () => {
  it('pins the full preset catalog with exact grid labels', () => {
    const catalog = Object.fromEntries(
      Object.entries(LAYOUT_PRESETS).map(([layoutId, preset]) => [
        layoutId,
        {
          label: preset.label,
          columns: preset.columns,
          rows: preset.rows,
          readingOrder: preset.readingOrder,
        },
      ]),
    );

    expect(catalog).toEqual({
      'one-up': { label: '1x1', columns: 1, rows: 1, readingOrder: 'row-major' },
      'two-up-vertical': { label: '1x2', columns: 1, rows: 2, readingOrder: 'row-major' },
      'two-up-horizontal': { label: '2x1', columns: 2, rows: 1, readingOrder: 'row-major' },
      'two-by-two': { label: '2x2', columns: 2, rows: 2, readingOrder: 'row-major' },
      'two-by-three': { label: '2x3', columns: 2, rows: 3, readingOrder: 'row-major' },
      'three-by-two': { label: '3x2', columns: 3, rows: 2, readingOrder: 'row-major' },
    });
  });

  it('materializes the explicit 2x3 preset in row-major visual order', () => {
    const pageBox: PageBox = { x: 0, y: 0, width: 600, height: 900 };
    const crops = createCropBoxes(0, pageBox, TWO_BY_THREE);

    expect(crops).toHaveLength(6);
    expect(crops.map((crop) => [crop.label, crop.row, crop.column])).toEqual([
      ['1', 0, 0],
      ['2', 0, 1],
      ['3', 1, 0],
      ['4', 1, 1],
      ['5', 2, 0],
      ['6', 2, 1],
    ]);
    expect(crops.map((crop) => pickBox(crop))).toEqual([
      { x: 0, y: 600, width: 300, height: 300 },
      { x: 300, y: 600, width: 300, height: 300 },
      { x: 0, y: 300, width: 300, height: 300 },
      { x: 300, y: 300, width: 300, height: 300 },
      { x: 0, y: 0, width: 300, height: 300 },
      { x: 300, y: 0, width: 300, height: 300 },
    ]);
  });

  it('materializes visual crop templates into PDF-space crop boxes without regenerating a preset', () => {
    const materializeCropBoxesFromTemplate = requireGridExport<MaterializeCropBoxesFromTemplate>('materializeCropBoxesFromTemplate');
    const pageBox: PageBox = { x: 10, y: 20, width: 620, height: 930 };
    const template: CropTemplate = {
      layoutId: TWO_BY_THREE,
      label: 'Manual 2x3 template',
      columns: 2,
      rows: 3,
      readingOrder: 'row-major',
      rects: [
        { x: 40, y: 30, width: 240, height: 250, order: 1, label: 'A', row: 0, column: 0 },
        { x: 330, y: 30, width: 240, height: 250, order: 2, label: 'B', row: 0, column: 1 },
        { x: 40, y: 330, width: 240, height: 250, order: 3, label: 'C', row: 1, column: 0 },
        { x: 330, y: 330, width: 240, height: 250, order: 4, label: 'D', row: 1, column: 1 },
        { x: 40, y: 630, width: 240, height: 250, order: 5, label: 'E', row: 2, column: 0 },
        { x: 330, y: 630, width: 240, height: 250, order: 6, label: 'F', row: 2, column: 1 },
      ],
    };

    const crops = materializeCropBoxesFromTemplate(2, pageBox, template);

    expect(crops.map((crop) => [crop.label, crop.pageIndex, crop.pageNumber, crop.row, crop.column])).toEqual([
      ['A', 2, 3, 0, 0],
      ['B', 2, 3, 0, 1],
      ['C', 2, 3, 1, 0],
      ['D', 2, 3, 1, 1],
      ['E', 2, 3, 2, 0],
      ['F', 2, 3, 2, 1],
    ]);
    expect(pickBox(crops[0]!)).toEqual({ x: 50, y: 670, width: 240, height: 250 });
    expect(pickBox(crops[5]!)).toEqual({ x: 340, y: 70, width: 240, height: 250 });
  });

  it('recomputes crop boxes from crop options and applies page-index range overrides exactly', () => {
    const pageBox: PageBox = { x: 0, y: 0, width: 620, height: 930 };
    const adjusted = updatePageCropOptions(createPagePlan(0, pageBox, TWO_BY_THREE), {
      margin: { top: 30, right: 20, bottom: 60, left: 40 },
      gutter: { x: 20, y: 30 },
    });

    expect(adjusted.cropBoxes.map((crop) => pickBox(crop))).toEqual([
      { x: 40, y: 640, width: 270, height: 260 },
      { x: 330, y: 640, width: 270, height: 260 },
      { x: 40, y: 350, width: 270, height: 260 },
      { x: 330, y: 350, width: 270, height: 260 },
      { x: 40, y: 60, width: 270, height: 260 },
      { x: 330, y: 60, width: 270, height: 260 },
    ]);

    const pages = [
      createPagePlan(0, pageBox, 'one-up'),
      createPagePlan(1, pageBox, 'one-up'),
      createPagePlan(2, pageBox, 'one-up'),
      createPagePlan(3, pageBox, 'one-up'),
    ];
    const overridden = applyPageRangeOverride(pages, { startPageIndex: 1, endPageIndex: 2, layout: TWO_BY_THREE });

    expect(overridden.map((page) => page.layoutId)).toEqual(['one-up', 'two-by-three', 'two-by-three', 'one-up']);
    expect(overridden.map((page) => page.cropBoxes.length)).toEqual([1, 6, 6, 1]);
    expect(overridden.map((page) => page.overridden)).toEqual([false, true, true, false]);
  });

  it('applies explicit crop-box overrides without regenerating preset geometry', () => {
    const page = createPagePlan(1, { x: 0, y: 0, width: 600, height: 400 }, 'three-by-two');
    const manualCrop: CropBox = {
      pageIndex: 1,
      pageNumber: 2,
      order: 0,
      label: '',
      row: 0,
      column: 0,
      x: 25,
      y: 50,
      left: 25,
      bottom: 50,
      width: 280,
      height: 175,
    };

    const overridden = applyCropBoxOverride(page, {
      cropBoxes: [manualCrop],
      reason: 'Manual crop box override.',
    });

    expect(overridden.overridden).toBe(true);
    expect(overridden.origin).toBe('manual');
    expect(overridden.reason).toBe('Manual crop box override.');
    expect(overridden.cropBoxes).toHaveLength(1);
    expect(overridden.cropBoxes).toEqual(overridden.crops);
    expect(overridden.cropBoxes[0]).toMatchObject({
      order: 1,
      label: '1',
      row: 0,
      column: 0,
      x: 25,
      y: 50,
      left: 25,
      bottom: 50,
      width: 280,
      height: 175,
    });
  });

  it('keeps materialized PagePlan.cropBoxes authoritative after a manual overlay adjustment', () => {
    const pageBox: PageBox = { x: 0, y: 0, width: 600, height: 400 };
    const page = createPagePlan(0, pageBox, 'three-by-two');
    const stalePresetCrops = createCropBoxes(0, pageBox, 'three-by-two');
    const manualCropBoxes: CropBox[] = [
      createLabeledManualCrop(0, 1, 'Manual left', 25, 40, 225, 310),
      createLabeledManualCrop(0, 2, 'Manual right', 320, 35, 210, 300),
    ];

    const adjusted = applyCropBoxOverride(page, {
      cropBoxes: manualCropBoxes,
      reason: 'Keyboard-resized manual overlay.',
    });
    const staleAliasPlan: PagePlan = {
      ...adjusted,
      // Simulate stale compatibility metadata from an older caller. Export must not read it.
      crops: stalePresetCrops,
    };

    const conversionPlan = buildConversionPlan('manual-overlay.pdf', [staleAliasPlan], 2048);

    expect(adjusted.origin).toBe('manual');
    expect(adjusted.cropBoxes).toEqual(adjusted.crops);
    expect(conversionPlan.estimatedOutputPages).toBe(2);
    expect(conversionPlan.pages[0]?.cropBoxes).toEqual(adjusted.cropBoxes);
    expect(conversionPlan.regions.map((region) => region.cropBox)).toEqual(adjusted.cropBoxes);
    expect(conversionPlan.regions.map((region) => region.cropBox)).not.toEqual(stalePresetCrops);
  });

  it('applies a manual crop template only to the requested page list/range', () => {
    const sourcePageBox: PageBox = { x: 0, y: 0, width: 600, height: 400 };
    const pages = [
      applyCropBoxOverride(createPagePlan(0, sourcePageBox, 'three-by-two'), {
        cropBoxes: [
          createLabeledManualCrop(0, 1, 'A', 20, 40, 220, 280),
          createLabeledManualCrop(0, 2, 'B', 310, 40, 220, 280),
        ],
        reason: 'Manual source template.',
      }),
      createPagePlan(1, { x: 0, y: 0, width: 300, height: 200 }, 'one-up'),
      createPagePlan(2, { x: 0, y: 0, width: 300, height: 200 }, 'two-by-two'),
      createPagePlan(3, { x: 0, y: 0, width: 900, height: 600 }, 'one-up'),
    ];

    const templated = applyCropTemplateToPageRange(pages, '2, 4', pages[0]!);

    expect(templated[0]).toBe(pages[0]);
    expect(templated[2]).toBe(pages[2]);
    expect(templated[1]).not.toBe(pages[1]);
    expect(templated[3]).not.toBe(pages[3]);
    expect(templated.map((page) => page.cropBoxes.length)).toEqual([2, 2, 4, 2]);
    expect(templated[1]).toMatchObject({ origin: 'manual', overridden: true, reason: 'Applied crop template from page 1.' });
    expect(templated[3]).toMatchObject({ origin: 'manual', overridden: true, reason: 'Applied crop template from page 1.' });
    expect(templated[1]?.cropBoxes.map((crop) => crop.label)).toEqual(['A', 'B']);
    expect(templated[3]?.cropBoxes.map((crop) => crop.label)).toEqual(['A', 'B']);
  });

  it('derives template grid metadata from authoritative cropBoxes instead of copied preset recipe options', () => {
    const sourcePageBox: PageBox = { x: 0, y: 0, width: 600, height: 400 };
    const source = applyCropBoxOverride(createPagePlan(0, sourcePageBox, 'three-by-two'), {
      cropBoxes: [
        createLabeledManualCrop(0, 1, 'A', 20, 40, 220, 280),
        createLabeledManualCrop(0, 2, 'B', 310, 40, 220, 280),
      ],
      cropOptions: { margin: { top: 50 }, gutter: { x: 40, y: 30 } },
      reason: 'Manual two-crop source template.',
    });
    const target = createPagePlan(1, { x: 0, y: 0, width: 300, height: 200 }, 'one-up');

    const templated = applyCropTemplateToPageRange([source, target], '2', source)[1]!;

    expect(source.grid).toMatchObject({ columns: 3, rows: 2 });
    expect(templated.layoutId).toBe('two-up-horizontal');
    expect(templated.grid).toMatchObject({ id: 'two-up-horizontal', columns: 2, rows: 1, readingOrder: 'row-major' });
    expect(templated.grid.margin).toBeUndefined();
    expect(templated.grid.gutter).toBeUndefined();
    expect(templated.cropOptions).toEqual({ margin: {}, gutter: {} });
    expect(templated.cropBoxes.map((crop) => [crop.label, crop.row, crop.column])).toEqual([
      ['A', 0, 0],
      ['B', 0, 1],
    ]);
  });

  it('fails manual template application without mutating pages when range or source crops are invalid', () => {
    const pageBox: PageBox = { x: 0, y: 0, width: 600, height: 400 };
    const pages = [createPagePlan(0, pageBox, 'one-up'), createPagePlan(1, pageBox, 'two-by-two')];
    const emptySource: PagePlan = { ...pages[0]!, cropBoxes: [], crops: [] };

    expect(() => applyCropTemplateToPageRange(pages, '2', emptySource)).toThrow(/no crop boxes/i);
    expect(() => applyCropTemplateToPageRange(pages, '3', pages[0]!)).toThrow(/outside 1-2/i);
    expect(pages[0]?.cropBoxes).toHaveLength(1);
    expect(pages[1]?.cropBoxes).toHaveLength(4);
  });

  it('normalizes explicit crop-box overrides to row-major output order', () => {
    const page = createPagePlan(0, { x: 0, y: 0, width: 600, height: 400 }, 'two-by-two');
    const shuffledCrops: CropBox[] = [
      createManualCrop(3, 0, 0, 300, 200, 1, 0),
      createManualCrop(2, 300, 200, 300, 200, 0, 1),
      createManualCrop(4, 300, 0, 300, 200, 1, 1),
      createManualCrop(1, 0, 200, 300, 200, 0, 0),
    ];

    const overridden = applyCropBoxOverride(page, {
      cropBoxes: shuffledCrops,
      reason: 'Manual crop box override.',
    });

    expect(overridden.cropBoxes.map((crop) => [crop.label, crop.row, crop.column, crop.x, crop.y])).toEqual([
      ['1', 0, 0, 0, 200],
      ['2', 0, 1, 300, 200],
      ['3', 1, 0, 0, 0],
      ['4', 1, 1, 300, 0],
    ]);
  });

  it('preserves explicit output slide order edits without visual re-sorting', () => {
    const page = createPagePlan(0, { x: 0, y: 0, width: 600, height: 400 }, 'two-by-two');
    const bottomRight = page.cropBoxes[3]!;
    const topLeft = page.cropBoxes[0]!;

    const edited = applyOutputCropBoxesOverride(page, [bottomRight, topLeft], 'User reordered output slides.');
    const plan = buildConversionPlan('deck.pdf', [edited], 1024);

    expect(edited.cropBoxes.map((crop) => [crop.label, crop.order, crop.x, crop.y])).toEqual([
      ['1', 1, bottomRight.x, bottomRight.y],
      ['2', 2, topLeft.x, topLeft.y],
    ]);
    expect(plan.regions.map((region) => region.cropBox)).toEqual(edited.cropBoxes);
  });

  it('allows output slide deletion and marks an empty page for review before export', () => {
    const page = createPagePlan(0, { x: 0, y: 0, width: 600, height: 400 }, 'two-by-two');
    const edited = applyOutputCropBoxesOverride(page, [page.cropBoxes[1]!], 'User deleted output slides.');
    const empty = applyOutputCropBoxesOverride(page, [], 'User deleted all output slides.');

    expect(edited.cropBoxes).toHaveLength(1);
    expect(edited.cropBoxes[0]).toMatchObject({ label: '1', order: 1 });
    expect(edited.reviewState).toBe('ready');
    expect(empty.cropBoxes).toEqual([]);
    expect(empty.reviewState).toBe('review-needed');
  });

  it('keeps non-default reading order explicit for custom grid materialization', () => {
    const pageBox: PageBox = { x: 0, y: 0, width: 600, height: 900 };
    const grid: GridSpec = { columns: 2, rows: 3, readingOrder: 'column-major' };

    const crops = cropBoxesForGrid(0, { mediaBox: pageBox }, grid);

    expect(crops.map((crop) => [crop.order, crop.row, crop.column, crop.label])).toEqual([
      [1, 0, 0, '1'],
      [2, 1, 0, '2'],
      [3, 2, 0, '3'],
      [4, 0, 1, '4'],
      [5, 1, 1, '5'],
      [6, 2, 1, '6'],
    ]);
  });

  it('round-trips 180° and 270° preview rectangles through PDF-space coordinates', () => {
    const rotated180: PageBox = { x: 10, y: 20, width: 500, height: 300, rotation: 180 };
    const visual180: PdfBox = { x: 50, y: 70, width: 120, height: 80 };
    const pdf180 = previewRectToPdfBox(visual180, { width: 500, height: 300 }, rotated180);

    expect(pdf180).toEqual({ x: 340, y: 90, width: 120, height: 80 });
    expect(pdfBoxToVisualRect(pdf180, rotated180)).toEqual(visual180);

    const rotated270: PageBox = { x: 10, y: 20, width: 500, height: 300, rotation: 270 };
    const visual270: PdfBox = { x: 40, y: 90, width: 100, height: 150 };
    const pdf270 = previewRectToPdfBox(visual270, { width: 300, height: 500 }, rotated270);

    expect(pdf270).toEqual({ x: 270, y: 180, width: 150, height: 100 });
    expect(pdfBoxToVisualRect(pdf270, rotated270)).toEqual(visual270);
  });

  it('creates a saved layout from authoritative cropBoxes with source metadata and no stale alias reads', () => {
    const createSavedLayoutTemplateFromPage = requireGridExport<CreateSavedLayoutTemplateFromPage>('createSavedLayoutTemplateFromPage');
    const sourcePageBox: PageBox = { x: 0, y: 0, width: 600, height: 400 };
    const source = createManualTemplateSourcePage(2, sourcePageBox);
    const staleAliasPlan: PagePlan = {
      ...source,
      crops: createCropBoxes(source.pageIndex, sourcePageBox, 'three-by-two'),
    };

    const saved = createSavedLayoutTemplateFromPage(staleAliasPlan, { existingLayouts: [], id: 'layout-a' });

    expect(saved).toMatchObject({
      id: 'layout-a',
      name: 'Layout 1',
      sourcePageIndex: 2,
      sourcePageNumber: 3,
    });
    expect(saved.template).toMatchObject({
      layoutId: 'two-up-horizontal',
      label: '2x1',
      columns: 2,
      rows: 1,
      readingOrder: 'row-major',
    });
    expect(saved.template.rects.map((rect) => [rect.label, rect.order, rect.row, rect.column, pickBox(rect)])).toEqual([
      ['A', 1, 0, 0, { x: 20, y: 80, width: 220, height: 280 }],
      ['B', 2, 0, 1, { x: 310, y: 80, width: 220, height: 280 }],
    ]);
    expect(saved.template.rects).toHaveLength(2);
    expect(saved.template.rects).not.toEqual(staleAliasPlan.crops.map((crop) => pdfBoxToVisualRect(crop, staleAliasPlan.pageBox)));

    source.cropBoxes[0]!.x = 999;
    expect(saved.template.rects[0]).toMatchObject({ x: 20, y: 80, width: 220, height: 280 });
  });

  it('rejects saved layout create and update from review-needed source pages', () => {
    const createSavedLayoutTemplateFromPage = requireGridExport<CreateSavedLayoutTemplateFromPage>('createSavedLayoutTemplateFromPage');
    const updateSavedLayoutTemplateFromPage = requireGridExport<UpdateSavedLayoutTemplateFromPage>('updateSavedLayoutTemplateFromPage');
    const readySource = createManualTemplateSourcePage();
    const reviewNeededSource: PagePlan = {
      ...readySource,
      reviewState: 'review-needed',
      confidence: 'review-needed',
      reason: 'Automatic detection needs review.',
    };
    const saved = createSavedLayoutTemplateFromPage(readySource, { existingLayouts: [], id: 'layout-a' });

    expect(() => createSavedLayoutTemplateFromPage(reviewNeededSource, { existingLayouts: [], id: 'layout-b' })).toThrow(/review-needed/i);
    expect(() => updateSavedLayoutTemplateFromPage(saved, reviewNeededSource)).toThrow(/review-needed/i);
  });

  it('applies a saved layout only to the requested page list and scales from sourcePageIndex context', () => {
    const createSavedLayoutTemplateFromPage = requireGridExport<CreateSavedLayoutTemplateFromPage>('createSavedLayoutTemplateFromPage');
    const applySavedLayoutTemplateToPageRange = requireGridExport<ApplySavedLayoutTemplateToPageRange>('applySavedLayoutTemplateToPageRange');
    const pages = createSavedLayoutApplyPages();
    const saved = {
      ...createSavedLayoutTemplateFromPage(pages[0]!, { existingLayouts: [], id: 'layout-a' }),
      // Display-only trace data must not be used to resolve the source page for scaling.
      sourcePageNumber: 99,
    };

    const templated = applySavedLayoutTemplateToPageRange(pages, '2, 4', saved);

    expect(templated[0]).toBe(pages[0]);
    expect(templated[2]).toBe(pages[2]);
    expect(templated[1]).not.toBe(pages[1]);
    expect(templated[3]).not.toBe(pages[3]);
    expect(templated.map((page) => page.cropBoxes.length)).toEqual([2, 2, 4, 2]);
    expect(templated[1]).toMatchObject({ origin: 'manual', overridden: true, reason: 'Applied saved crop layout "Layout 1".' });
    expect(templated[3]).toMatchObject({ origin: 'manual', overridden: true, reason: 'Applied saved crop layout "Layout 1".' });
    expect(templated[1]?.cropBoxes.map((crop) => [crop.label, pickBox(crop)])).toEqual([
      ['A', { x: 10, y: 20, width: 110, height: 140 }],
      ['B', { x: 155, y: 20, width: 110, height: 140 }],
    ]);
    expect(templated[3]?.cropBoxes.map((crop) => [crop.label, pickBox(crop)])).toEqual([
      ['A', { x: 30, y: 60, width: 330, height: 420 }],
      ['B', { x: 465, y: 60, width: 330, height: 420 }],
    ]);
  });

  it('rejects invalid saved layout application without mutating page inputs', () => {
    const createSavedLayoutTemplateFromPage = requireGridExport<CreateSavedLayoutTemplateFromPage>('createSavedLayoutTemplateFromPage');
    const applySavedLayoutTemplateToPageRange = requireGridExport<ApplySavedLayoutTemplateToPageRange>('applySavedLayoutTemplateToPageRange');
    const pages = createSavedLayoutApplyPages();
    const before = serializePages(pages);
    const emptySaved: SavedLayoutTemplate = {
      ...createSavedLayoutTemplateFromPage(pages[0]!, { existingLayouts: [], id: 'layout-a' }),
      template: {
        layoutId: 'one-up',
        label: 'Empty',
        columns: 1,
        rows: 1,
        readingOrder: 'row-major',
        rects: [],
      },
    };

    expect(() => applySavedLayoutTemplateToPageRange(pages, '2', emptySaved)).toThrow(/no crop boxes|empty/i);
    expect(serializePages(pages)).toBe(before);

    const validSaved = createSavedLayoutTemplateFromPage(pages[0]!, { existingLayouts: [], id: 'layout-a' });
    expect(() => applySavedLayoutTemplateToPageRange(pages, '5', validSaved)).toThrow(/outside 1-4/i);
    expect(serializePages(pages)).toBe(before);
  });

  it('keeps saved layouts non-live-linked and requires explicit update plus reapply', () => {
    const createSavedLayoutTemplateFromPage = requireGridExport<CreateSavedLayoutTemplateFromPage>('createSavedLayoutTemplateFromPage');
    const updateSavedLayoutTemplateFromPage = requireGridExport<UpdateSavedLayoutTemplateFromPage>('updateSavedLayoutTemplateFromPage');
    const applySavedLayoutTemplateToPageRange = requireGridExport<ApplySavedLayoutTemplateToPageRange>('applySavedLayoutTemplateToPageRange');
    const pages = createSavedLayoutApplyPages();
    const saved = createSavedLayoutTemplateFromPage(pages[0]!, { existingLayouts: [], id: 'layout-a' });

    const withOriginalApplied = applySavedLayoutTemplateToPageRange(pages, '2', saved);
    const oldAppliedPageTwo = withOriginalApplied[1]!;
    const editedSource = applyCropBoxOverride(pages[0]!, {
      cropBoxes: [
        createLabeledManualCrop(0, 1, 'Wide A', 40, 70, 180, 260),
        createLabeledManualCrop(0, 2, 'Wide B', 360, 70, 180, 260),
      ],
      reason: 'Manual source edit after save.',
    });

    expect(saved.template.rects.map((rect) => [rect.label, pickBox(rect)])).toEqual([
      ['A', { x: 20, y: 80, width: 220, height: 280 }],
      ['B', { x: 310, y: 80, width: 220, height: 280 }],
    ]);
    expect(oldAppliedPageTwo.cropBoxes.map((crop) => [crop.label, pickBox(crop)])).toEqual([
      ['A', { x: 10, y: 20, width: 110, height: 140 }],
      ['B', { x: 155, y: 20, width: 110, height: 140 }],
    ]);

    const updated = updateSavedLayoutTemplateFromPage(saved, editedSource);

    expect(updated).toMatchObject({ id: saved.id, name: saved.name, sourcePageIndex: 0, sourcePageNumber: 1 });
    expect(updated).not.toBe(saved);
    expect(updated?.template.rects.map((rect) => [rect.label, pickBox(rect)])).toEqual([
      ['Wide A', { x: 40, y: 70, width: 180, height: 260 }],
      ['Wide B', { x: 360, y: 70, width: 180, height: 260 }],
    ]);
    expect(withOriginalApplied[1]).toBe(oldAppliedPageTwo);
    expect(withOriginalApplied[1]?.cropBoxes.map((crop) => [crop.label, pickBox(crop)])).toEqual([
      ['A', { x: 10, y: 20, width: 110, height: 140 }],
      ['B', { x: 155, y: 20, width: 110, height: 140 }],
    ]);

    const withUpdatedApplied = applySavedLayoutTemplateToPageRange([editedSource, ...pages.slice(1)], '2', updated!);
    expect(withUpdatedApplied[1]?.cropBoxes.map((crop) => [crop.label, pickBox(crop)])).toEqual([
      ['Wide A', { x: 20, y: 35, width: 90, height: 130 }],
      ['Wide B', { x: 180, y: 35, width: 90, height: 130 }],
    ]);

    editedSource.cropBoxes[0]!.x = 777;
    expect(updated?.template.rects[0]).toMatchObject({ x: 40, y: 70, width: 180, height: 260 });
  });

  it('validates saved layout rename attempts and reuses the smallest unused Layout N name', () => {
    const getNextSavedLayoutName = requireGridExport<GetNextSavedLayoutName>('getNextSavedLayoutName');
    const createSavedLayoutTemplateFromPage = requireGridExport<CreateSavedLayoutTemplateFromPage>('createSavedLayoutTemplateFromPage');
    const renameSavedLayoutTemplate = requireGridExport<RenameSavedLayoutTemplate>('renameSavedLayoutTemplate');
    const page = createManualTemplateSourcePage();
    const layoutOne = createSavedLayoutTemplateFromPage(page, { existingLayouts: [], id: 'layout-1' });
    const custom = { ...createSavedLayoutTemplateFromPage(page, { existingLayouts: [layoutOne], id: 'layout-2' }), name: 'Body' };
    const layoutThree = { ...createSavedLayoutTemplateFromPage(page, { existingLayouts: [layoutOne, custom], id: 'layout-3' }), name: 'Layout 3' };
    const layouts = [layoutOne, custom, layoutThree];

    expect(getNextSavedLayoutName(layouts)).toBe('Layout 2');

    const renamed = renameSavedLayoutTemplate(layouts, layoutOne.id, '  Intro  ');

    expect(renamed.find((layout) => layout.id === layoutOne.id)?.name).toBe('Intro');
    expect(layoutOne.name).toBe('Layout 1');
    expect(getNextSavedLayoutName(renamed)).toBe('Layout 1');

    expect(() => renameSavedLayoutTemplate(renamed, custom.id, ' intro ')).toThrow(/duplicate|unique|already in use/i);
    expect(() => renameSavedLayoutTemplate(renamed, custom.id, '   ')).toThrow(/empty|name/i);
    expect(renamed.find((layout) => layout.id === custom.id)?.name).toBe('Body');
  });

  it('deep-clones saved templates across save, update, and apply boundaries', () => {
    const createSavedLayoutTemplateFromPage = requireGridExport<CreateSavedLayoutTemplateFromPage>('createSavedLayoutTemplateFromPage');
    const updateSavedLayoutTemplateFromPage = requireGridExport<UpdateSavedLayoutTemplateFromPage>('updateSavedLayoutTemplateFromPage');
    const applySavedLayoutTemplateToPageRange = requireGridExport<ApplySavedLayoutTemplateToPageRange>('applySavedLayoutTemplateToPageRange');
    const pages = createSavedLayoutApplyPages();
    const saved = createSavedLayoutTemplateFromPage(pages[0]!, { existingLayouts: [], id: 'layout-a' });
    const originalSavedRect = { ...saved.template.rects[0]! };

    pages[0]!.cropBoxes[0]!.x = 80;
    expect(saved.template.rects[0]).toEqual(originalSavedRect);

    const updated = updateSavedLayoutTemplateFromPage(saved, pages[0]!);
    pages[0]!.cropBoxes[0]!.x = 90;
    expect(updated?.template.rects[0]?.x).toBe(80);

    const templated = applySavedLayoutTemplateToPageRange(pages, '2', updated!);
    const appliedCrop = templated[1]!.cropBoxes[0]!;
    const appliedBox = pickBox(appliedCrop);

    updated!.template.rects[0]!.x = 1234;
    expect(pickBox(appliedCrop)).toEqual(appliedBox);

    appliedCrop.x = 4321;
    expect(updated?.template.rects[0]?.x).toBe(1234);
    expect(pages[1]!.cropBoxes[0]!.x).not.toBe(4321);
  });
});

function createLabeledManualCrop(pageIndex: number, order: number, label: string, x: number, y: number, width: number, height: number): CropBox {
  return {
    pageIndex,
    pageNumber: pageIndex + 1,
    order,
    label,
    row: 0,
    column: order - 1,
    x,
    y,
    left: x,
    bottom: y,
    width,
    height,
  };
}

function requireGridExport<T>(name: string): T {
  const value = (gridModule as Record<string, unknown>)[name];
  expect(value, `${name} must be exported from src/pdf/grid.ts`).toBeTypeOf('function');
  return value as T;
}

function pickBox(box: PdfBox): PdfBox {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function createManualCrop(order: number, x: number, y: number, width: number, height: number, row: number, column: number): CropBox {
  return {
    pageIndex: 0,
    pageNumber: 1,
    order,
    label: String(order),
    row,
    column,
    x,
    y,
    left: x,
    bottom: y,
    width,
    height,
  };
}

function createManualTemplateSourcePage(pageIndex = 0, pageBox: PageBox = { x: 0, y: 0, width: 600, height: 400 }): PagePlan {
  return applyCropBoxOverride(createPagePlan(pageIndex, pageBox, 'three-by-two'), {
    cropBoxes: [
      createLabeledManualCrop(pageIndex, 1, 'A', 20, 40, 220, 280),
      createLabeledManualCrop(pageIndex, 2, 'B', 310, 40, 220, 280),
    ],
    reason: 'Manual source template.',
  });
}

function createSavedLayoutApplyPages(): PagePlan[] {
  return [
    createManualTemplateSourcePage(0, { x: 0, y: 0, width: 600, height: 400 }),
    createPagePlan(1, { x: 0, y: 0, width: 300, height: 200 }, 'one-up'),
    createPagePlan(2, { x: 0, y: 0, width: 300, height: 200 }, 'two-by-two'),
    createPagePlan(3, { x: 0, y: 0, width: 900, height: 600 }, 'one-up'),
  ];
}

function serializePages(pages: readonly PagePlan[]): string {
  return JSON.stringify(
    pages.map((page) => ({
      ref: page,
      pageIndex: page.pageIndex,
      layoutId: page.layoutId,
      cropBoxes: page.cropBoxes.map((crop) => ({ ...crop })),
      crops: page.crops.map((crop) => ({ ...crop })),
    })),
  );
}
