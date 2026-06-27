import { describe, expect, it } from 'vitest';
import { applyCropBoxOverride, buildConversionPlan, createPagePlan as createGridPagePlan } from '../../src/pdf/grid';
import { initialState, reduceAppState, type AppState } from '../../src/state/store';
import type { CropBox, ExportResult, LayoutPresetId, PageBox, PagePlan } from '../../src/types';

describe('app state reducer', () => {
  it('clears stale layouts, selection, document, pages, plan, and export state when a new PDF load starts', () => {
    const stalePage = createPagePlan(0, 'two-by-two');
    const staleSavedState = reduceAppState(createReadyState([stalePage]), {
      type: 'save-saved-layout',
      page: stalePage,
      options: { id: 'stale-layout', name: 'Stale layout' },
    });
    const staleState: AppState = {
      ...staleSavedState,
      phase: 'success',
      view: 'loaded',
      sourceFileName: 'old.pdf',
      sourceByteLength: 2048,
      sourceHash: 'old-hash',
      selectedPageIndex: 4,
      pages: [stalePage],
      initialPages: [stalePage],
      plan: buildConversionPlan('old.pdf', [stalePage], 2048),
      exportResult: createExportResult(),
      statusMessage: 'Export complete.',
      document: {
        fileName: 'old.pdf',
        fileSize: 2048,
        sourceHash: 'old-hash',
        outputFileName: 'old-slides.pdf',
        loadedAt: '2026-06-25T00:00:00.000Z',
        warnings: [],
      },
    };

    const loading = reduceAppState(staleState, { type: 'loading', message: 'Reading new.pdf locally…' });

    expect(loading).toMatchObject({
      phase: 'loading',
      view: 'loading',
      statusMessage: 'Reading new.pdf locally…',
      selectedPageIndex: 0,
      sourceFileName: '',
      sourceByteLength: 0,
      sourceHash: '',
      savedLayouts: [],
      selectedSavedLayoutId: null,
    });
    expect(loading.pages).toEqual([]);
    expect(loading.initialPages).toEqual([]);
    expect(loading.plan).toBeNull();
    expect(loading.exportResult).toBeNull();
    expect(loading.document).toBeNull();
  });

  it('clears stale saved layouts and selection when a new PDF finishes loading', () => {
    const stalePage = createPagePlan(0, 'two-by-two');
    const staleState = reduceAppState(createReadyState([stalePage]), {
      type: 'save-saved-layout',
      page: stalePage,
      options: { id: 'stale-layout', name: 'Stale layout' },
    });
    const newPage = createPagePlan(0, 'one-up');

    const loaded = reduceAppState(staleState, {
      type: 'loaded',
      sourceFileName: 'new.pdf',
      sourceByteLength: 1024,
      sourceHash: 'new-hash',
      pages: [newPage],
      initialPages: [clonePagePlanForTest(newPage)],
      plan: buildConversionPlan('new.pdf', [newPage], 1024),
    });

    expect(loaded.sourceFileName).toBe('new.pdf');
    expect(loaded.pages).toEqual([newPage]);
    expect(loaded.selectedPageIndex).toBe(0);
    expect(loaded.savedLayouts).toEqual([]);
    expect(loaded.selectedSavedLayoutId).toBeNull();
  });

  it('resets loaded layouts and selection back to the empty app state', () => {
    const stalePage = createPagePlan(1, 'two-up-horizontal');
    const savedLayout = reduceAppState(createReadyState([stalePage]), {
      type: 'save-saved-layout',
      page: stalePage,
      options: { id: 'layout-a', name: 'Layout A' },
    }).savedLayouts[0]!;
    const staleState: AppState = {
      ...initialState,
      phase: 'ready',
      view: 'loaded',
      sourceFileName: 'deck.pdf',
      sourceByteLength: 4096,
      sourceHash: 'deck-hash',
      selectedPageIndex: 1,
      pages: [createPagePlan(0, 'one-up'), stalePage],
      initialPages: [createPagePlan(0, 'one-up'), clonePagePlanForTest(stalePage)],
      plan: buildConversionPlan('deck.pdf', [createPagePlan(0, 'one-up'), stalePage], 4096),
      savedLayouts: [savedLayout],
      selectedSavedLayoutId: 'layout-a',
      statusMessage: 'Suggested layouts are ready. Review the preview before export.',
    };

    expect(reduceAppState(staleState, { type: 'reset' })).toEqual(initialState);
  });

  it('tracks drag state without leaving stale errors', () => {
    const withError = reduceAppState(initialState, { type: 'load-error', message: 'Choose a PDF file to continue.' });
    const dragging = reduceAppState(withError, { type: 'drag-enter' });

    expect(dragging.isDragging).toBe(true);
    expect(dragging.error).toBeNull();
  });

  it('moves from local load start to loaded document summary', () => {
    const loading = reduceAppState(initialState, { type: 'load-start' });
    const loaded = reduceAppState(loading, {
      type: 'load-success',
      document: {
        fileName: 'deck.pdf',
        fileSize: 1234,
        sourceHash: 'abc123',
        outputFileName: 'deck-slides.pdf',
        loadedAt: '2026-06-25T00:00:00.000Z',
        warnings: [],
      },
    });

    expect(loaded.view).toBe('loaded');
    expect(loaded.document?.outputFileName).toBe('deck-slides.pdf');
    expect(loaded.error).toBeNull();
  });

  it('starts without saved crop layouts and clears them on PDF load and reset', () => {
    const ready = createReadyState();
    const withSaved = reduceAppState(ready, {
      type: 'save-saved-layout',
      page: ready.pages[0]!,
      options: { id: 'layout-a', name: 'Opening' },
    });

    expect(withSaved.savedLayouts).toHaveLength(1);
    expect(withSaved.selectedSavedLayoutId).toBe('layout-a');

    const loaded = reduceAppState(withSaved, {
      type: 'loaded',
      sourceFileName: 'next.pdf',
      sourceByteLength: 456,
      sourceHash: 'next-hash',
      pages: createSavedLayoutPages(),
      initialPages: createSavedLayoutPages(),
      plan: buildConversionPlan('next.pdf', createSavedLayoutPages(), 456),
    });

    expect(initialState.savedLayouts).toEqual([]);
    expect(initialState.selectedSavedLayoutId).toBeNull();
    expect(loaded.savedLayouts).toEqual([]);
    expect(loaded.selectedSavedLayoutId).toBeNull();

    const savedAgain = reduceAppState(ready, {
      type: 'save-saved-layout',
      page: ready.pages[0]!,
      options: { id: 'layout-b' },
    });
    expect(reduceAppState(savedAgain, { type: 'reset' })).toMatchObject({
      savedLayouts: [],
      selectedSavedLayoutId: null,
    });
  });

  it('saves, selects, renames, updates, and deletes session-only saved crop layouts', () => {
    const ready = createReadyState();
    const saved = reduceAppState(ready, {
      type: 'save-saved-layout',
      page: ready.pages[0]!,
      options: { id: 'layout-a', name: 'Opening' },
    });

    expect(saved.savedLayouts[0]).toMatchObject({
      id: 'layout-a',
      name: 'Opening',
      sourcePageIndex: 0,
      sourcePageNumber: 1,
    });
    expect(saved.selectedSavedLayoutId).toBe('layout-a');
    expect(saved.statusMessage).toContain('Saved crop layout "Opening"');
    expect(saved).not.toHaveProperty('layoutLibrary');
    expect(saved).not.toHaveProperty('persistedSavedLayouts');

    ready.pages[0]!.cropBoxes[0]!.x = 999;
    expect(saved.savedLayouts[0]?.template.rects[0]).toMatchObject({ x: 20, y: 80, width: 220, height: 280 });

    const unselected = reduceAppState(saved, { type: 'select-saved-layout', savedLayoutId: null });
    expect(unselected.selectedSavedLayoutId).toBeNull();

    const selected = reduceAppState(unselected, { type: 'select-saved-layout', savedLayoutId: 'layout-a' });
    expect(selected.selectedSavedLayoutId).toBe('layout-a');

    const renamed = reduceAppState(selected, { type: 'rename-saved-layout', savedLayoutId: 'layout-a', name: '  Intro  ' });
    expect(renamed.savedLayouts[0]?.name).toBe('Intro');
    expect(saved.savedLayouts[0]?.name).toBe('Opening');

    const withSecond = reduceAppState(renamed, {
      type: 'save-saved-layout',
      page: renamed.pages[1]!,
      options: { id: 'layout-b', name: 'Body' },
    });
    expect(withSecond.savedLayouts.map((layout) => layout.name)).toEqual(['Intro', 'Body']);
    expect(withSecond.selectedSavedLayoutId).toBe('layout-b');
    expect(() => reduceAppState(withSecond, { type: 'rename-saved-layout', savedLayoutId: 'layout-b', name: 'intro' })).toThrow(
      /duplicate|unique|already in use/i,
    );

    const selectedFirstAgain = reduceAppState(withSecond, { type: 'select-saved-layout', savedLayoutId: 'layout-a' });
    const deletedInactive = reduceAppState(selectedFirstAgain, { type: 'delete-saved-layout', savedLayoutId: 'layout-b' });
    expect(deletedInactive.savedLayouts.map((layout) => layout.id)).toEqual(['layout-a']);
    expect(deletedInactive.selectedSavedLayoutId).toBe('layout-a');

    const deletedSelectedWithSuccessor = reduceAppState(withSecond, { type: 'delete-saved-layout', savedLayoutId: 'layout-b' });
    expect(deletedSelectedWithSuccessor.savedLayouts.map((layout) => layout.id)).toEqual(['layout-a']);
    expect(deletedSelectedWithSuccessor.selectedSavedLayoutId).toBe('layout-a');

    const editedSource = applyCropBoxOverride(renamed.pages[0]!, {
      cropBoxes: [
        createLabeledManualCrop(0, 1, 'Wide A', 40, 70, 180, 260),
        createLabeledManualCrop(0, 2, 'Wide B', 360, 70, 180, 260),
      ],
      reason: 'Manual source edit after save.',
    });
    const updated = reduceAppState(renamed, { type: 'update-saved-layout', savedLayoutId: 'layout-a', page: editedSource });
    expect(updated.savedLayouts[0]).toMatchObject({ id: 'layout-a', name: 'Intro', sourcePageIndex: 0, sourcePageNumber: 1 });
    expect(updated.savedLayouts[0]?.template.rects.map((rect) => [rect.label, pickBox(rect)])).toEqual([
      ['Wide A', { x: 40, y: 70, width: 180, height: 260 }],
      ['Wide B', { x: 360, y: 70, width: 180, height: 260 }],
    ]);

    const deleted = reduceAppState(updated, { type: 'delete-saved-layout', savedLayoutId: 'layout-a' });
    expect(deleted.savedLayouts).toEqual([]);
    expect(deleted.selectedSavedLayoutId).toBeNull();
    expect(updated.savedLayouts).toHaveLength(1);
  });

  it('rejects saving or updating review-needed/no-crop pages without mutating state', () => {
    const sourcePage = createPagePlan(0, 'two-by-two');
    const ready = createReadyState([sourcePage]);
    const saved = reduceAppState(ready, {
      type: 'save-saved-layout',
      page: sourcePage,
      options: { id: 'layout-a', name: 'Safe layout' },
    });
    const reviewNeededPage = createPagePlan(1, 'two-by-two', { reviewState: 'review-needed' });
    const noCropPage = createPagePlan(2, 'two-by-two', { cropBoxes: [] });
    const readyBefore = JSON.stringify(ready);
    const savedBefore = JSON.stringify(saved);

    expect(() => reduceAppState(ready, { type: 'save-saved-layout', page: reviewNeededPage })).toThrow(/review-needed/i);
    expect(() => reduceAppState(ready, { type: 'save-saved-layout', page: noCropPage })).toThrow(/no crop boxes/i);
    expect(() => reduceAppState(saved, { type: 'update-saved-layout', savedLayoutId: 'layout-a', page: reviewNeededPage })).toThrow(
      /review-needed/i,
    );
    expect(() => reduceAppState(saved, { type: 'update-saved-layout', savedLayoutId: 'layout-a', page: noCropPage })).toThrow(
      /no crop boxes/i,
    );
    expect(JSON.stringify(ready)).toBe(readyBefore);
    expect(JSON.stringify(saved)).toBe(savedBefore);
  });

  it('applies saved layouts only to requested pages and rebuilds the conversion plan from updated cropBoxes', () => {
    const sourcePage = createPagePlan(0, 'two-by-two', {
      cropBoxes: [createCropBox(0, { x: 20, y: 30, width: 120, height: 140 })],
    });
    const targetPage = createPagePlan(1, 'one-up', {
      pageBox: { x: 0, y: 0, width: 306, height: 396 },
      cropBoxes: [createCropBox(1, { x: 0, y: 0, width: 306, height: 396 })],
    });
    const untouchedPage = createPagePlan(2, 'one-up');
    const ready = createReadyState([sourcePage, targetPage, untouchedPage]);
    const saved = reduceAppState(ready, {
      type: 'save-saved-layout',
      page: sourcePage,
      options: { id: 'layout-a', name: 'Scaled crop' },
    });

    const applied = reduceAppState(saved, { type: 'apply-saved-layout', savedLayoutId: 'layout-a', range: '2' });

    expect(applied.pages[0]).toBe(sourcePage);
    expect(applied.pages[2]).toBe(untouchedPage);
    expect(applied.pages[1]).not.toBe(targetPage);
    expect(applied.pages[1]?.cropBoxes).toEqual(applied.plan?.pages[1]?.cropBoxes);
    expect(applied.plan?.regions.map((region) => region.sourcePageIndex)).toEqual([0, 1, 2]);
    expect(applied.plan?.regions[1]?.cropBox).toEqual(applied.pages[1]?.cropBoxes[0]);
    expect(applied.plan?.estimatedOutputPages).toBe(3);
    expect(applied.selectedSavedLayoutId).toBe('layout-a');
  });

  it('applies saved crop layouts only to explicit page lists/ranges and rebuilds the conversion plan', () => {
    const ready = createReadyState();
    const saved = reduceAppState(ready, {
      type: 'save-saved-layout',
      page: ready.pages[0]!,
      options: { id: 'layout-a', name: 'Opening' },
    });
    const beforePlan = saved.plan;

    const applied = reduceAppState(saved, { type: 'apply-saved-layout', savedLayoutId: 'layout-a', range: '2, 4' });

    expect(applied.pages[0]).toBe(saved.pages[0]);
    expect(applied.pages[2]).toBe(saved.pages[2]);
    expect(applied.pages[1]).not.toBe(saved.pages[1]);
    expect(applied.pages[3]).not.toBe(saved.pages[3]);
    expect(applied.pages.map((page) => page.cropBoxes.length)).toEqual([2, 2, 4, 2]);
    expect(applied.pages[1]?.reason).toBe('Applied saved crop layout "Opening".');
    expect(applied.pages[3]?.reason).toBe('Applied saved crop layout "Opening".');
    expect(applied.plan).not.toBe(beforePlan);
    expect(applied.plan?.estimatedOutputPages).toBe(10);
    expect(applied.plan?.regions).toHaveLength(10);
    expect(applied.selectedSavedLayoutId).toBe('layout-a');
  });

  it('keeps saved layouts deep-cloned from page edits until explicitly updated', () => {
    const originalPage = createPagePlan(0, 'two-by-two', {
      cropBoxes: [createCropBox(0, { x: 10, y: 10, width: 100, height: 100 })],
    });
    const ready = createReadyState([originalPage]);
    const saved = reduceAppState(ready, {
      type: 'save-saved-layout',
      page: originalPage,
      options: { id: 'layout-a', name: 'Original' },
    });
    const savedRect = saved.savedLayouts[0]?.template.rects[0];
    originalPage.cropBoxes[0]!.x = 250;
    originalPage.cropBoxes[0]!.left = 250;

    expect(savedRect?.x).toBe(10);
    expect(saved.savedLayouts[0]?.template.rects[0]?.x).toBe(10);

    const editedPage = createPagePlan(0, 'two-by-two', {
      cropBoxes: [createCropBox(0, { x: 250, y: 20, width: 90, height: 110 })],
    });
    const updated = reduceAppState(saved, { type: 'update-saved-layout', savedLayoutId: 'layout-a', page: editedPage });

    expect(updated.savedLayouts[0]?.template.rects[0]?.x).toBe(250);
    expect(saved.savedLayouts[0]?.template.rects[0]?.x).toBe(10);
    expect(updated.selectedSavedLayoutId).toBe('layout-a');
  });
});

interface CreateTestPagePlanOptions {
  pageBox?: PageBox;
  cropBoxes?: CropBox[];
  reviewState?: PagePlan['reviewState'];
  confidence?: PagePlan['confidence'];
}

function createPagePlan(
  pageIndex: number,
  layoutId: LayoutPresetId,
  options?: CreateTestPagePlanOptions,
): PagePlan;
function createPagePlan(
  pageIndex: number,
  pageBox: PageBox,
  layoutId: LayoutPresetId,
  options?: CreateTestPagePlanOptions,
): PagePlan;
function createPagePlan(
  pageIndex: number,
  pageBoxOrLayoutId: PageBox | LayoutPresetId,
  layoutIdOrOptions?: LayoutPresetId | CreateTestPagePlanOptions,
  maybeOptions: CreateTestPagePlanOptions = {},
): PagePlan {
  const stringLayout = typeof pageBoxOrLayoutId === 'string';
  const options = stringLayout ? ((layoutIdOrOptions as CreateTestPagePlanOptions | undefined) ?? {}) : maybeOptions;
  const pageBox = stringLayout ? (options.pageBox ?? { x: 0, y: 0, width: 612, height: 792 }) : pageBoxOrLayoutId;
  const layoutId = stringLayout ? pageBoxOrLayoutId : (layoutIdOrOptions as LayoutPresetId);
  const page = createGridPagePlan(pageIndex, pageBox, layoutId);
  const cropBoxes = options.cropBoxes ?? page.cropBoxes;
  return {
    ...page,
    ...(options.reviewState ? { reviewState: options.reviewState } : {}),
    ...(options.confidence ? { confidence: options.confidence } : {}),
    cropBoxes,
    crops: cropBoxes,
  };
}

function createExportResult(): ExportResult {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    outputFileName: 'old-slides.pdf',
    outputPageCount: 1,
    sourceHashBefore: 'old-hash',
    sourceHashAfter: 'old-hash',
  };
}

function createCropBox(pageIndex: number, box: Pick<CropBox, 'x' | 'y' | 'width' | 'height'>, order = 1): CropBox {
  return createLabeledManualCrop(pageIndex, order, String(order), box.x, box.y, box.width, box.height);
}

function createReadyState(pages = createSavedLayoutPages()): AppState {
  return reduceAppState(initialState, {
    type: 'loaded',
    sourceFileName: 'deck.pdf',
    sourceByteLength: 123,
    sourceHash: 'deck-hash',
    pages,
    initialPages: pages.map(clonePagePlanForTest),
    plan: buildConversionPlan('deck.pdf', pages, 123),
  });
}

function createSavedLayoutPages(): PagePlan[] {
  return [
    createManualTemplateSourcePage(0, { x: 0, y: 0, width: 600, height: 400 }),
    createPagePlan(1, { x: 0, y: 0, width: 300, height: 200 }, 'one-up'),
    createPagePlan(2, { x: 0, y: 0, width: 300, height: 200 }, 'two-by-two'),
    createPagePlan(3, { x: 0, y: 0, width: 900, height: 600 }, 'one-up'),
  ];
}

function createManualTemplateSourcePage(pageIndex: number, pageBox: PageBox): PagePlan {
  return applyCropBoxOverride(createPagePlan(pageIndex, pageBox, 'three-by-two'), {
    cropBoxes: [
      createLabeledManualCrop(pageIndex, 1, 'A', 20, 40, 220, 280),
      createLabeledManualCrop(pageIndex, 2, 'B', 310, 40, 220, 280),
    ],
    reason: 'Manual source template.',
  });
}

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

function clonePagePlanForTest(page: PagePlan): PagePlan {
  const grid = {
    ...page.grid,
    ...(page.grid.margin ? { margin: { ...page.grid.margin } } : {}),
    ...(page.grid.gutter ? { gutter: { ...page.grid.gutter } } : {}),
  };
  return {
    ...page,
    pageBox: { ...page.pageBox },
    boxes: { mediaBox: { ...page.boxes.mediaBox }, ...(page.boxes.cropBox ? { cropBox: { ...page.boxes.cropBox } } : {}) },
    grid,
    cropBoxes: page.cropBoxes.map((crop) => ({ ...crop })),
    crops: page.crops.map((crop) => ({ ...crop })),
    cropOptions: { margin: { ...page.cropOptions.margin }, gutter: { ...page.cropOptions.gutter } },
    ...(page.detection ? { detection: { ...page.detection, cropRects: page.detection.cropRects.map((rect) => ({ ...rect })) } } : {}),
  };
}

function pickBox(box: Pick<CropBox, 'x' | 'y' | 'width' | 'height'>): { x: number; y: number; width: number; height: number } {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}
