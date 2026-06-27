import { describe, expect, it } from 'vitest';
import { createInspectorPanel } from '../../src/ui/page-range-editor';
import type { CropBox, PagePlan, SavedLayoutTemplate } from '../../src/types';

describe('createInspectorPanel saved layout controls', () => {
  it('labels grid presets, saved crop layouts, and one-off crop copying as separate inspector sections', () => {
    const panel = createInspectorPanel({
      page: createPagePlan(),
      pageCount: 4,
      savedLayouts: [createSavedLayout('saved-layout-1', 'Opening crops')],
      selectedSavedLayoutId: 'saved-layout-1',
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
      onSelectSavedLayout: () => undefined,
      onRenameSavedLayout: () => undefined,
      onUpdateSavedLayout: () => undefined,
      onDeleteSavedLayout: () => undefined,
      onApplySavedLayout: () => undefined,
    });

    expectText(panel, 'Inspector');
    expectText(panel, 'Grid preset');
    expectText(panel, 'Saved crop layouts');
    expectText(panel, 'Current page crop copy');
    expectText(panel, 'Save a crop layout once');
    expect(panel.textContent!.indexOf('Saved crop layouts')).toBeLessThan(panel.textContent!.indexOf('Grid preset'));
    expect(panel.textContent).not.toContain('Crop spacing');
    expect(getByTestId(panel, 'layout-picker').getAttribute('aria-label')).toBe('Grid preset for selected page');
    expect(getInput(panel, 'range-input').getAttribute('aria-label')).toBe('Shared page range for grid presets and saved crop layouts');
    expect(getSelect(panel, 'range-layout-select').getAttribute('aria-label')).toBe('Grid preset to apply to range');
    expectText(getButton(panel, 'apply-range-button'), 'Apply grid preset to range');
    expectText(getButton(panel, 'apply-current-template-button'), 'Copy current page crop to range');
    expectText(getButton(panel, 'apply-saved-layout-button'), 'Apply saved crop layout to range');
  });

  it('shows an empty saved-layout state and disables saved-layout actions until a crop layout is saved', () => {
    const panel = createInspectorPanel({
      page: createPagePlan(),
      pageCount: 4,
      savedLayouts: [],
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
      onSelectSavedLayout: () => undefined,
      onRenameSavedLayout: () => undefined,
      onUpdateSavedLayout: () => undefined,
      onDeleteSavedLayout: () => undefined,
      onApplySavedLayout: () => undefined,
    });

    const noSavedLayoutReason = 'Save the current crop layout before using saved crop layout actions.';
    expectText(getByTestId(panel, 'saved-layout-empty-state'), 'No saved crop layouts yet');
    expect(getButton(panel, 'save-current-layout-button').disabled).toBe(false);
    expect(getSelect(panel, 'saved-layout-select').disabled).toBe(true);
    expect(getSelect(panel, 'saved-layout-select').title).toBe(noSavedLayoutReason);
    expect(getInput(panel, 'saved-layout-name-input').disabled).toBe(true);
    expect(getInput(panel, 'saved-layout-name-input').title).toBe(noSavedLayoutReason);
    for (const testId of ['rename-saved-layout-button', 'update-saved-layout-button', 'apply-saved-layout-button', 'delete-saved-layout-button']) {
      const button = getButton(panel, testId);
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(noSavedLayoutReason);
    }
  });

  it('does not infer a selected saved layout when AppState has no selection', () => {
    const calls: string[] = [];
    const panel = createInspectorPanel({
      page: createPagePlan(),
      pageCount: 4,
      savedLayouts: [createSavedLayout('saved-layout-1', 'Layout 1'), createSavedLayout('saved-layout-2', 'Layout 2')],
      selectedSavedLayoutId: '',
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
      onSelectSavedLayout: (layoutId) => calls.push(`select:${layoutId}`),
      onRenameSavedLayout: (layoutId, name) => calls.push(`rename:${layoutId}:${name}`),
      onUpdateSavedLayout: (layoutId) => calls.push(`update:${layoutId}`),
      onDeleteSavedLayout: (layoutId) => calls.push(`delete:${layoutId}`),
      onApplySavedLayout: (range, layoutId) => calls.push(`apply:${range}:${layoutId}`),
    });

    const select = getSelect(panel, 'saved-layout-select');
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('');
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['Choose saved layout', 'Layout 1', 'Layout 2']);
    const chooseReason = 'Choose a saved crop layout before using saved crop layout actions.';
    expect(getInput(panel, 'saved-layout-name-input').disabled).toBe(true);
    expect(getInput(panel, 'saved-layout-name-input').title).toBe(chooseReason);
    for (const testId of ['rename-saved-layout-button', 'update-saved-layout-button', 'apply-saved-layout-button', 'delete-saved-layout-button']) {
      const button = getButton(panel, testId);
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(chooseReason);
    }

    select.value = 'saved-layout-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(calls).toEqual(['select:saved-layout-1']);
  });

  it('disables saving or updating the current page when it needs review or has no crop boxes', () => {
    const reviewPanel = createInspectorPanel({
      page: createPagePlan({ reviewState: 'review-needed' }),
      pageCount: 1,
      saveCurrentLayoutDisabledReason: 'Resolve review-needed crop boxes before saving this page as a layout.',
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
    });

    const reviewSave = getButton(reviewPanel, 'save-current-layout-button');
    expect(reviewSave.disabled).toBe(true);
    expect(reviewSave.title).toMatch(/review-needed/i);

    const noCropPanel = createInspectorPanel({
      page: createPagePlan({ cropBoxes: [] }),
      pageCount: 1,
      savedLayouts: [createSavedLayout('saved-layout-1', 'Layout 1')],
      selectedSavedLayoutId: 'saved-layout-1',
      saveCurrentLayoutDisabledReason: 'Current page has no crop boxes to save as a layout.',
      onLayoutChange: () => undefined,
      onApplyRange: () => undefined,
      onApplyCurrentTemplateToRange: () => undefined,
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => undefined,
      onUpdateSavedLayout: () => undefined,
    });

    const noCropSave = getButton(noCropPanel, 'save-current-layout-button');
    const noCropUpdate = getButton(noCropPanel, 'update-saved-layout-button');
    expect(noCropSave.disabled).toBe(true);
    expect(noCropUpdate.disabled).toBe(true);
    expect(noCropUpdate.title).toMatch(/no crop boxes/i);
    expectText(getByTestId(noCropPanel, 'saved-layout-disabled-reason'), 'Current page has no crop boxes');
  });

  it('wires grid preset, current crop copy, and saved crop layout callbacks separately', () => {
    const calls: string[] = [];
    const panel = createInspectorPanel({
      page: createPagePlan(),
      pageCount: 4,
      savedLayouts: [createSavedLayout('saved-layout-1', 'Layout 1'), createSavedLayout('saved-layout-2', 'Layout 2')],
      selectedSavedLayoutId: 'saved-layout-2',
      onLayoutChange: (layoutId) => calls.push(`grid-selected:${layoutId}`),
      onApplyRange: (range, layoutId) => calls.push(`grid-range:${range}:${layoutId}`),
      onApplyCurrentTemplateToRange: (range) => calls.push(`copy-current:${range}`),
      onResetPage: () => undefined,
      onSaveCurrentLayout: () => calls.push('save'),
      onSelectSavedLayout: (layoutId) => calls.push(`select:${layoutId}`),
      onRenameSavedLayout: (layoutId, name) => calls.push(`rename:${layoutId}:${name}`),
      onUpdateSavedLayout: (layoutId) => calls.push(`update:${layoutId}`),
      onDeleteSavedLayout: (layoutId) => calls.push(`delete:${layoutId}`),
      onApplySavedLayout: (range, layoutId) => calls.push(`apply:${range}:${layoutId}`),
    });

    getButton(panel, 'layout-three-by-two').click();
    getInput(panel, 'range-input').value = '2, 4';
    getSelect(panel, 'range-layout-select').value = 'two-by-two';
    getButton(panel, 'apply-range-button').click();
    getButton(panel, 'apply-current-template-button').click();
    getButton(panel, 'save-current-layout-button').click();

    const select = getSelect(panel, 'saved-layout-select');
    expect(select.value).toBe('saved-layout-2');
    select.value = 'saved-layout-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const nameInput = getInput(panel, 'saved-layout-name-input');
    expect(nameInput.value).toBe('Layout 2');
    nameInput.value = 'Lecture Slides';
    getButton(panel, 'rename-saved-layout-button').click();

    getButton(panel, 'update-saved-layout-button').click();

    getInput(panel, 'range-input').value = '2, 4';
    getButton(panel, 'apply-saved-layout-button').click();
    getButton(panel, 'delete-saved-layout-button').click();

    expect(calls).toEqual([
      'grid-selected:three-by-two',
      'grid-range:2, 4:two-by-two',
      'copy-current:2, 4',
      'save',
      'select:saved-layout-1',
      'rename:saved-layout-2:Lecture Slides',
      'update:saved-layout-2',
      'apply:2, 4:saved-layout-2',
      'delete:saved-layout-2',
    ]);
  });
});

function expectText(element: HTMLElement, expected: string): void {
  expect(element.textContent).toContain(expected);
}

function getByTestId(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  expect(element).not.toBeNull();
  return element!;
}

function getButton(container: HTMLElement, testId: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(button).not.toBeNull();
  return button!;
}

function getInput(container: HTMLElement, testId: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  expect(input).not.toBeNull();
  return input!;
}

function getSelect(container: HTMLElement, testId: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`);
  expect(select).not.toBeNull();
  return select!;
}

function createPagePlan(overrides: Partial<PagePlan> = {}): PagePlan {
  const pageIndex = overrides.pageIndex ?? 0;
  const pageNumber = pageIndex + 1;
  const pageBox = { x: 0, y: 0, width: 612, height: 792 };
  const cropBoxes = overrides.cropBoxes ?? [createCropBox(pageIndex, pageNumber)];

  return {
    pageIndex,
    pageNumber,
    layoutId: 'two-up-horizontal',
    layout: 'two-up-horizontal',
    grid: { id: 'two-up-horizontal', label: '2-up horizontal', columns: 2, rows: 1, readingOrder: 'row-major' },
    pageBox,
    boxes: { mediaBox: pageBox },
    cropBoxes,
    crops: cropBoxes,
    confidence: 'high',
    reviewState: 'ready',
    reason: 'Test page plan.',
    score: 1,
    overridden: false,
    cropOptions: { margin: {}, gutter: {} },
    ...overrides,
  };
}

function createCropBox(pageIndex: number, pageNumber: number): CropBox {
  return {
    x: 0,
    y: 396,
    width: 306,
    height: 396,
    left: 0,
    bottom: 396,
    pageIndex,
    pageNumber,
    order: 1,
    label: 'Slide 1',
    row: 0,
    column: 0,
  };
}

function createSavedLayout(id: string, name: string): SavedLayoutTemplate {
  return {
    id,
    name,
    sourcePageIndex: 0,
    sourcePageNumber: 1,
    template: {
      layoutId: 'two-up-horizontal',
      label: '2-up horizontal',
      columns: 2,
      rows: 1,
      readingOrder: 'row-major',
      rects: [
        {
          x: 0,
          y: 0,
          width: 306,
          height: 396,
          order: 1,
          label: 'Slide 1',
          row: 0,
          column: 0,
        },
      ],
    },
  };
}
