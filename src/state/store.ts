import {
  applySavedLayoutTemplateToPageRange,
  buildConversionPlan,
  cloneSavedLayoutTemplate,
  createSavedLayoutTemplateFromPage,
  deleteSavedLayoutTemplate,
  renameSavedLayoutTemplate,
  updateSavedLayoutTemplateFromPage,
} from '../pdf/grid';
import type { ConversionPlan, ExportResult, LoadedPdfSummary, PagePlan, SavedLayoutTemplate } from '../types';

export type AppPhase = 'empty' | 'loading' | 'ready' | 'processing' | 'success' | 'error';

export interface SaveSavedLayoutOptions {
  id?: string;
  name?: string;
}

export interface AppState {
  phase: AppPhase;
  sourceFileName: string;
  sourceByteLength: number;
  sourceHash: string;
  selectedPageIndex: number;
  pages: PagePlan[];
  initialPages: PagePlan[];
  savedLayouts: SavedLayoutTemplate[];
  selectedSavedLayoutId: string | null;
  plan: ConversionPlan | null;
  exportResult: ExportResult | null;
  statusMessage: string;
  errorMessage: string;
  // Legacy shell-test fields kept harmlessly for reducer compatibility.
  isDragging: boolean;
  error: string | null;
  view: 'empty' | 'loading' | 'loaded';
  document: LoadedPdfSummary | null;
}

export type AppAction =
  | { type: 'loading'; message: string }
  | { type: 'loaded'; sourceFileName: string; sourceByteLength: number; sourceHash: string; pages: PagePlan[]; initialPages: PagePlan[]; plan: ConversionPlan }
  | { type: 'select-page'; pageIndex: number }
  | { type: 'update-pages'; pages: PagePlan[]; plan: ConversionPlan }
  | { type: 'save-saved-layout'; page: PagePlan; options?: SaveSavedLayoutOptions }
  | { type: 'select-saved-layout'; savedLayoutId: string | null }
  | { type: 'rename-saved-layout'; savedLayoutId: string; name: string }
  | { type: 'update-saved-layout'; savedLayoutId: string; page: PagePlan }
  | { type: 'delete-saved-layout'; savedLayoutId: string }
  | { type: 'apply-saved-layout'; savedLayoutId: string; range: string }
  | { type: 'processing'; message: string }
  | { type: 'success'; result: ExportResult; message: string }
  | { type: 'error'; message: string }
  | { type: 'reset' }
  | { type: 'drag-enter' }
  | { type: 'drag-leave' }
  | { type: 'load-start' }
  | { type: 'load-error'; message: string }
  | { type: 'load-success'; document: LoadedPdfSummary };

export const initialState: AppState = Object.freeze({
  phase: 'empty',
  sourceFileName: '',
  sourceByteLength: 0,
  sourceHash: '',
  selectedPageIndex: 0,
  pages: [],
  initialPages: [],
  savedLayouts: [],
  selectedSavedLayoutId: null,
  plan: null,
  exportResult: null,
  statusMessage: 'Drop a PDF to begin.',
  errorMessage: '',
  isDragging: false,
  error: null,
  view: 'empty',
  document: null,
});

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'loading':
      return {
        ...initialState,
        phase: 'loading',
        view: 'loading',
        statusMessage: action.message,
      };
    case 'load-start':
      return {
        ...initialState,
        phase: 'loading',
        view: 'loading',
        statusMessage: 'Reading PDF locally…',
      };
    case 'loaded':
      return {
        ...state,
        phase: 'ready',
        view: 'loaded',
        sourceFileName: action.sourceFileName,
        sourceByteLength: action.sourceByteLength,
        sourceHash: action.sourceHash,
        pages: action.pages,
        initialPages: action.initialPages,
        savedLayouts: [],
        selectedSavedLayoutId: null,
        plan: action.plan,
        selectedPageIndex: 0,
        statusMessage: 'Suggested layouts are ready. Review the preview before export.',
        errorMessage: '',
        error: null,
        exportResult: null,
      };
    case 'load-success':
      return { ...state, view: 'loaded', document: action.document, error: null };
    case 'select-page':
      return { ...state, selectedPageIndex: clamp(action.pageIndex, 0, Math.max(0, state.pages.length - 1)) };
    case 'update-pages':
      return {
        ...state,
        pages: action.pages,
        plan: action.plan,
        selectedPageIndex: clamp(state.selectedPageIndex, 0, Math.max(0, action.pages.length - 1)),
        phase: state.phase === 'empty' ? 'ready' : state.phase,
        statusMessage: 'Edits saved locally in this browser session.',
        errorMessage: '',
        error: null,
      };
    case 'save-saved-layout':
      return saveSavedLayoutFromPage(state, action.page, action.options);
    case 'select-saved-layout':
      return selectSavedLayout(state, action.savedLayoutId);
    case 'rename-saved-layout':
      return renameSavedLayout(state, action.savedLayoutId, action.name);
    case 'update-saved-layout':
      return updateSavedLayoutFromPage(state, action.savedLayoutId, action.page);
    case 'delete-saved-layout':
      return deleteSavedLayout(state, action.savedLayoutId);
    case 'apply-saved-layout':
      return applySavedLayoutToPageRange(state, action.savedLayoutId, action.range);
    case 'processing':
      return { ...state, phase: 'processing', statusMessage: action.message, errorMessage: '', error: null };
    case 'success':
      return { ...state, phase: 'success', exportResult: action.result, statusMessage: action.message, errorMessage: '', error: null };
    case 'error':
    case 'load-error':
      return { ...state, phase: 'error', errorMessage: action.message, error: action.message, statusMessage: 'Your edits are preserved. Adjust and try again.' };
    case 'drag-enter':
      return { ...state, isDragging: true, error: null, errorMessage: '' };
    case 'drag-leave':
      return { ...state, isDragging: false };
    case 'reset':
      return { ...initialState };
    default:
      return state;
  }
}

export const reduceAppState = reducer;

export function assertPageCanSaveSavedLayout(page: PagePlan): void {
  if (page.reviewState === 'review-needed') {
    throw new RangeError('Review-needed pages cannot be saved as crop layouts.');
  }
  if (page.cropBoxes.length === 0) {
    throw new RangeError('Current page has no crop boxes to save.');
  }
}

export function saveSavedLayoutFromPage(state: AppState, page: PagePlan, options: SaveSavedLayoutOptions = {}): AppState {
  assertPageCanSaveSavedLayout(page);
  const existingLayouts = state.savedLayouts.map(cloneSavedLayoutTemplate);
  const savedLayout = createSavedLayoutTemplateFromPage(page, { ...options, existingLayouts });
  const savedLayouts = [...existingLayouts, savedLayout];
  return {
    ...state,
    savedLayouts,
    selectedSavedLayoutId: savedLayout.id,
    statusMessage: `Saved crop layout "${savedLayout.name}" for this PDF session.`,
    errorMessage: '',
    error: null,
  };
}

export function selectSavedLayout(state: AppState, savedLayoutId: string | null): AppState {
  if (savedLayoutId === null) {
    return {
      ...state,
      selectedSavedLayoutId: null,
      statusMessage: 'No saved crop layout selected.',
      errorMessage: '',
      error: null,
    };
  }

  const savedLayout = findSavedLayoutOrThrow(state.savedLayouts, savedLayoutId);
  return {
    ...state,
    selectedSavedLayoutId: savedLayout.id,
    statusMessage: `Selected saved crop layout "${savedLayout.name}".`,
    errorMessage: '',
    error: null,
  };
}

export function renameSavedLayout(state: AppState, savedLayoutId: string, name: string): AppState {
  const savedLayouts = renameSavedLayoutTemplate(state.savedLayouts, savedLayoutId, name);
  const renamed = findSavedLayoutOrThrow(savedLayouts, savedLayoutId);
  return {
    ...state,
    savedLayouts,
    statusMessage: `Renamed saved crop layout to "${renamed.name}".`,
    errorMessage: '',
    error: null,
  };
}

export function updateSavedLayoutFromPage(state: AppState, savedLayoutId: string, page: PagePlan): AppState {
  assertPageCanSaveSavedLayout(page);
  const savedLayouts = updateSavedLayoutTemplateFromPage(state.savedLayouts, savedLayoutId, page);
  const updated = findSavedLayoutOrThrow(savedLayouts, savedLayoutId);
  return {
    ...state,
    savedLayouts,
    selectedSavedLayoutId: updated.id,
    statusMessage: `Updated saved crop layout "${updated.name}" from page ${updated.sourcePageNumber}.`,
    errorMessage: '',
    error: null,
  };
}

export function deleteSavedLayout(state: AppState, savedLayoutId: string): AppState {
  const deleted = findSavedLayoutOrThrow(state.savedLayouts, savedLayoutId);
  const savedLayouts = deleteSavedLayoutTemplate(state.savedLayouts, savedLayoutId);
  const selectedSavedLayoutId = state.selectedSavedLayoutId === savedLayoutId
    ? (savedLayouts[0]?.id ?? null)
    : state.selectedSavedLayoutId;
  return {
    ...state,
    savedLayouts,
    selectedSavedLayoutId,
    statusMessage: `Deleted saved crop layout "${deleted.name}".`,
    errorMessage: '',
    error: null,
  };
}

export function applySavedLayoutToPageRange(state: AppState, savedLayoutId: string, range: string): AppState {
  const savedLayout = findSavedLayoutOrThrow(state.savedLayouts, savedLayoutId);
  const pages = applySavedLayoutTemplateToPageRange(state.pages, range, savedLayout);
  const plan = buildConversionPlan(state.sourceFileName, pages, state.sourceByteLength);
  return {
    ...state,
    pages,
    plan,
    selectedSavedLayoutId: savedLayout.id,
    selectedPageIndex: clamp(state.selectedPageIndex, 0, Math.max(0, pages.length - 1)),
    phase: state.phase === 'empty' ? 'ready' : state.phase,
    statusMessage: `Applied saved crop layout "${savedLayout.name}" to pages ${range.trim()}.`,
    errorMessage: '',
    error: null,
  };
}

function findSavedLayoutOrThrow(savedLayouts: readonly SavedLayoutTemplate[], savedLayoutId: string): SavedLayoutTemplate {
  const savedLayout = savedLayouts.find((layout) => layout.id === savedLayoutId);
  if (!savedLayout) throw new RangeError(`Saved crop layout "${savedLayoutId}" was not found.`);
  return savedLayout;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
