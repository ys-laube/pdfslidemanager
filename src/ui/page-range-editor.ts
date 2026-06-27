import { LAYOUT_PRESETS } from "../pdf/grid";
import type {
  LayoutPresetId,
  PagePlan,
  SavedLayoutTemplate,
} from "../types";
import { element } from "./dom";

export interface InspectorPanelOptions {
  page: PagePlan;
  pageCount: number;
  savedLayouts?: readonly SavedLayoutTemplate[];
  selectedSavedLayoutId?: string;
  saveCurrentLayoutDisabledReason?: string;
  onLayoutChange(layoutId: LayoutPresetId): void;
  onApplyRange(range: string, layoutId: LayoutPresetId): void;
  onApplyCurrentTemplateToRange(range: string): void;
  onResetPage(): void;
  onSaveCurrentLayout?(): void;
  onSelectSavedLayout?(layoutId: string): void;
  onRenameSavedLayout?(layoutId: string, name: string): void;
  onUpdateSavedLayout?(layoutId: string): void;
  onDeleteSavedLayout?(layoutId: string): void;
  onApplySavedLayout?(range: string, layoutId: string): void;
}

const LAYOUT_ORDER: LayoutPresetId[] = [
  "one-up",
  "two-up-horizontal",
  "two-up-vertical",
  "two-by-two",
  "two-by-three",
  "three-by-two",
];

export function createInspectorPanel({
  page,
  pageCount,
  savedLayouts = [],
  selectedSavedLayoutId = "",
  saveCurrentLayoutDisabledReason = "",
  onLayoutChange,
  onApplyRange,
  onApplyCurrentTemplateToRange,
  onResetPage,
  onSaveCurrentLayout,
  onSelectSavedLayout,
  onRenameSavedLayout,
  onUpdateSavedLayout,
  onDeleteSavedLayout,
  onApplySavedLayout,
}: InspectorPanelOptions): HTMLElement {
  const panel = element('section', { className: 'inspector-panel', attrs: { 'data-testid': 'inspector-panel', 'aria-label': 'Layout controls' } });
  const gridPresetPicker = createLayoutPicker(page.layoutId, onLayoutChange);

  const rangeInput = element("input", {
    attrs: {
      type: "text",
      value: `${page.pageNumber}-${page.pageNumber}`,
      'aria-label': 'Shared page range for grid presets and saved crop layouts',
      'data-testid': 'range-input',
      placeholder: `1-${pageCount}`,
    },
  });
  const rangeInputLabel = element('label', { className: 'field-label' }, [element('span', { text: 'Shared page range' }), rangeInput]);
  const gridPresetSelect = element('select', {
    attrs: {
      'aria-label': 'Grid preset to apply to range',
      'data-testid': 'range-layout-select',
    },
  });
  for (const layoutId of LAYOUT_ORDER) {
    const preset = LAYOUT_PRESETS[layoutId];
    const option = element("option", {
      text: preset.label,
      attrs: { value: layoutId },
    });
    option.selected = layoutId === page.layoutId;
    gridPresetSelect.append(option);
  }
  const gridPresetSelectLabel = element('label', { className: 'field-label' }, [element('span', { text: 'Grid preset to apply' }), gridPresetSelect]);
  const applyGridPresetButton = element('button', {
    className: 'button button-secondary',
    text: 'Apply grid preset to range',
    attrs: { type: 'button', 'data-testid': 'apply-range-button' },
  });
  applyGridPresetButton.addEventListener('click', () => {
    onApplyRange(rangeInput.value, gridPresetSelect.value as LayoutPresetId);
  });

  const applyTemplateButton = element('button', {
    className: 'button button-secondary',
    text: 'Copy current page crop to range',
    attrs: { type: 'button', 'data-testid': 'apply-current-template-button' },
  });
  applyTemplateButton.addEventListener("click", () => {
    onApplyCurrentTemplateToRange(rangeInput.value);
  });

  const resetButton = element("button", {
    className: "button button-secondary",
    text: "Reset this page",
    attrs: { type: "button", "data-testid": "reset-page-button" },
  });
  resetButton.addEventListener("click", onResetPage);

  panel.append(
    element('div', { className: 'panel-heading' }, [
      element('span', { className: 'eyebrow', text: `Page ${page.pageNumber} of ${pageCount}` }),
      element('h2', { text: 'Inspector' }),
    ]),
    createSavedLayoutsSection({
      savedLayouts,
      selectedSavedLayoutId,
      saveCurrentLayoutDisabledReason,
      rangeInput,
      rangeInputLabel,
      onSaveCurrentLayout,
      onSelectSavedLayout,
      onRenameSavedLayout,
      onUpdateSavedLayout,
      onDeleteSavedLayout,
      onApplySavedLayout,
    }),
    element('div', { className: 'panel-section' }, [
      element('h3', { text: 'Grid preset' }),
      element('p', { className: 'muted', text: 'Choose this page layout, or apply one grid preset to the shared range above.' }),
      gridPresetPicker,
      element('div', { className: 'range-row' }, [gridPresetSelectLabel]),
      applyGridPresetButton,
      resetButton,
    ]),
    element('div', { className: 'panel-section' }, [
      element('h3', { text: 'Current page crop copy' }),
      element('p', { className: 'muted', text: 'One-off copy to the shared range above without saving a layout.' }),
      applyTemplateButton,
    ]),
  );
  return panel;
}

interface SavedLayoutsSectionOptions {
  savedLayouts: readonly SavedLayoutTemplate[];
  selectedSavedLayoutId: string;
  saveCurrentLayoutDisabledReason: string;
  rangeInput: HTMLInputElement;
  rangeInputLabel: HTMLLabelElement;
  onSaveCurrentLayout: (() => void) | undefined;
  onSelectSavedLayout: ((layoutId: string) => void) | undefined;
  onRenameSavedLayout: ((layoutId: string, name: string) => void) | undefined;
  onUpdateSavedLayout: ((layoutId: string) => void) | undefined;
  onDeleteSavedLayout: ((layoutId: string) => void) | undefined;
  onApplySavedLayout: ((range: string, layoutId: string) => void) | undefined;
}

function createSavedLayoutsSection({
  savedLayouts,
  selectedSavedLayoutId,
  saveCurrentLayoutDisabledReason,
  rangeInput,
  rangeInputLabel,
  onSaveCurrentLayout,
  onSelectSavedLayout,
  onRenameSavedLayout,
  onUpdateSavedLayout,
  onDeleteSavedLayout,
  onApplySavedLayout,
}: SavedLayoutsSectionOptions): HTMLElement {
  const selectedLayout = selectedSavedLayoutId ? savedLayouts.find((layout) => layout.id === selectedSavedLayoutId) : undefined;
  const selectedId = selectedLayout?.id ?? '';
  const hasSavedLayout = selectedId !== '';
  const noSavedLayoutReason = 'Save the current crop layout before using saved crop layout actions.';
  const noSelectedLayoutReason = 'Choose a saved crop layout before using saved crop layout actions.';
  const savedLayoutActionDisabledReason = savedLayouts.length === 0 ? noSavedLayoutReason : noSelectedLayoutReason;
  const saveDisabledReason = saveCurrentLayoutDisabledReason || (!onSaveCurrentLayout ? 'Saving is unavailable until a page is ready.' : '');

  const saveButton = element("button", {
    className: "button button-secondary",
    text: "Save current crop layout",
    attrs: { type: "button", "data-testid": "save-current-layout-button" },
  });
  saveButton.toggleAttribute('disabled', saveDisabledReason !== '');
  if (saveDisabledReason) saveButton.setAttribute('title', saveDisabledReason);
  saveButton.addEventListener('click', () => onSaveCurrentLayout?.());

  const savedLayoutSelect = element("select", {
    attrs: {
      "aria-label": "Saved crop layout",
      "data-testid": "saved-layout-select",
    },
  });
  if (savedLayouts.length === 0) {
    savedLayoutSelect.append(
      element("option", { text: "No saved layouts", attrs: { value: "" } }),
    );
  } else {
    savedLayoutSelect.append(
      element("option", {
        text: "Choose saved layout",
        attrs: { value: "" },
      }),
    );
    for (const savedLayout of savedLayouts) {
      const option = element("option", {
        text: savedLayout.name,
        attrs: { value: savedLayout.id },
      });
      option.selected = savedLayout.id === selectedId;
      savedLayoutSelect.append(option);
    }
  }
  const selectDisabledReason = savedLayouts.length === 0 ? noSavedLayoutReason : !onSelectSavedLayout ? 'Saved crop layout selection is unavailable.' : '';
  savedLayoutSelect.toggleAttribute('disabled', selectDisabledReason !== '');
  if (selectDisabledReason) savedLayoutSelect.setAttribute('title', selectDisabledReason);
  savedLayoutSelect.addEventListener('change', () => onSelectSavedLayout?.(savedLayoutSelect.value));

  const nameInput = element("input", {
    attrs: {
      type: 'text',
      value: selectedLayout?.name ?? '',
      'aria-label': 'Saved crop layout name',
      'data-testid': 'saved-layout-name-input',
      placeholder: 'Crop layout name',
    },
  });
  nameInput.toggleAttribute('disabled', !hasSavedLayout);
  if (!hasSavedLayout) nameInput.setAttribute('title', savedLayoutActionDisabledReason);
  const savedLayoutSelectLabel = element('label', { className: 'field-label' }, [element('span', { text: 'Saved crop layout' }), savedLayoutSelect]);
  const nameInputLabel = element('label', { className: 'field-label' }, [element('span', { text: 'Layout name' }), nameInput]);

  const renameDisabledReason = !hasSavedLayout ? savedLayoutActionDisabledReason : !onRenameSavedLayout ? 'Saved crop layout rename is unavailable.' : '';
  const renameButton = createSavedLayoutActionButton('Rename saved crop layout', 'rename-saved-layout-button', renameDisabledReason === '', () => {
    if (selectedId) onRenameSavedLayout?.(selectedId, nameInput.value);
  }, renameDisabledReason);
  const updateDisabledReason = !hasSavedLayout
    ? savedLayoutActionDisabledReason
    : saveCurrentLayoutDisabledReason || (!onUpdateSavedLayout ? 'Saved crop layout update is unavailable.' : '');
  const updateButton = createSavedLayoutActionButton('Update from current page', 'update-saved-layout-button', updateDisabledReason === '', () => {
    if (selectedId) onUpdateSavedLayout?.(selectedId);
  }, updateDisabledReason);
  const applyDisabledReason = !hasSavedLayout ? savedLayoutActionDisabledReason : !onApplySavedLayout ? 'Saved crop layout range apply is unavailable.' : '';
  const applyButton = createSavedLayoutActionButton('Apply saved crop layout to range', 'apply-saved-layout-button', applyDisabledReason === '', () => {
    if (selectedId) onApplySavedLayout?.(rangeInput.value, selectedId);
  }, applyDisabledReason);
  const deleteDisabledReason = !hasSavedLayout ? savedLayoutActionDisabledReason : !onDeleteSavedLayout ? 'Saved crop layout delete is unavailable.' : '';
  const deleteButton = createSavedLayoutActionButton('Delete saved crop layout', 'delete-saved-layout-button', deleteDisabledReason === '', () => {
    if (selectedId) onDeleteSavedLayout?.(selectedId);
  }, deleteDisabledReason);
  const emptyState = savedLayouts.length === 0
    ? element('p', { className: 'muted', text: 'No saved crop layouts yet. Save the current crop layout after this page has crop boxes.', attrs: { 'data-testid': 'saved-layout-empty-state' } })
    : null;
  const disabledState = saveDisabledReason
    ? element('p', { className: 'muted', text: saveDisabledReason, attrs: { 'data-testid': 'saved-layout-disabled-reason' } })
    : null;

  return element('div', { className: 'panel-section', attrs: { 'data-testid': 'saved-layouts-section' } }, [
    element('h3', { text: 'Saved crop layouts' }),
    element('p', { className: 'muted', text: 'Save a crop layout once, then apply it quickly to other pages in this PDF session.' }),
    rangeInputLabel,
    emptyState,
    disabledState,
    saveButton,
    element('div', { className: 'range-row' }, [savedLayoutSelectLabel, nameInputLabel]),
    renameButton,
    updateButton,
    applyButton,
    deleteButton,
  ]);
}

function createSavedLayoutActionButton(label: string, testId: string, enabled: boolean, onClick: () => void, disabledReason = ''): HTMLButtonElement {
  const button = element('button', {
    className: 'button button-secondary',
    text: label,
    attrs: { type: "button", "data-testid": testId },
  });
  button.toggleAttribute('disabled', !enabled);
  if (!enabled && disabledReason) button.setAttribute('title', disabledReason);
  button.addEventListener('click', onClick);
  return button;
}

function createLayoutPicker(
  selected: LayoutPresetId,
  onChange: (layoutId: LayoutPresetId) => void,
): HTMLElement {
  const group = element("div", {
    className: "segmented-picker",
    attrs: {
      role: 'radiogroup',
      'aria-label': 'Grid preset for selected page',
      'data-testid': 'layout-picker',
    },
  });
  for (const layoutId of LAYOUT_ORDER) {
    const preset = LAYOUT_PRESETS[layoutId];
    const button = element("button", {
      className: `segment ${layoutId === selected ? "is-selected" : ""}`,
      text: preset.label,
      attrs: {
        type: "button",
        role: "radio",
        "aria-checked": String(layoutId === selected),
        title: `${preset.columns} by ${preset.rows} slide grid`,
        "data-testid": `layout-${layoutId}`,
      },
    });
    button.addEventListener("click", () => onChange(layoutId));
    group.append(button);
  }
  return group;
}
