import './styles.css';
import { createSplitPdf } from './pdf/convert';
import { applyCropBoxOverride, applyCropTemplateToPageRange, applyLayoutToPageRange, applyOutputCropBoxesOverride, buildConversionPlan, createDetectedPagePlan, updatePageCropOptions, updatePageLayout } from './pdf/grid';
import { suggestLayoutFromImage, suggestLayoutFromPageBox, type LayoutSuggestion } from './pdf/layout-detect';
import { readPdfFile, type LoadedPdf } from './pdf/load';
import { renderPdfPageForAnalysisWithMetadata, renderPdfPageToCanvas } from './pdf/render';
import { initialState, reducer, type AppState } from './state/store';
import type { AnalysisRenderMetadata, CropOptions, DetectionSource, LayoutPresetId, PagePlan } from './types';
import { clear, element } from './ui/dom';
import { createDropZone } from './ui/dropzone';
import { createExportPanel, describeExportDisabledReason, installNoUploadNetworkGuard } from './ui/export';
import { createInspectorPanel } from './ui/page-range-editor';
import { createPreviewStage, createThumbnailRail, renderExpectedOutputPreviews, syncPreviewSurfaceToCanvas, type PreviewCropBoxChange, type PreviewCropBoxesChange } from './ui/preview';

declare global {
  interface Window {
    __pdfSlideSplitterTestHooks?: {
      failNextExport?: boolean;
      attemptNetworkDuringExport?: boolean;
      blockedNetworkEvents?: string[];
      guardProbe?: {
        fetchBlocked?: boolean;
        fetchError?: string;
        sendBeaconReturn?: boolean;
      };
    };
  }
}

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('App root not found.');
}
const app: HTMLDivElement = appRoot;

let state: AppState = { ...initialState };
let loadedPdf: LoadedPdf | null = null;
let objectUrl = '';
let renderGeneration = 0;

function dispatch(action: Parameters<typeof reducer>[1]): void {
  state = reducer(state, action);
  renderApp();
}

function renderApp(): void {
  renderGeneration += 1;
  const generation = renderGeneration;
  clear(app);
  app.append(createHeader(), createStatusRegion());

  if (state.phase === 'empty' || state.phase === 'loading') {
    app.append(
      element('main', { className: 'empty-shell' }, [
        createDropZone({ onFile: handleFile }),
        createPrivacyChecklist(),
      ]),
    );
    return;
  }

  const selectedPage = state.pages[state.selectedPageIndex] ?? state.pages[0];
  if (!selectedPage) {
    app.append(
      element('main', { className: 'empty-shell' }, [
        element('div', { className: 'notice notice-error', text: 'No page plan is available. Start over and load the PDF again.' }),
      ]),
    );
    return;
  }

  const workspace = element('main', { className: 'workspace', attrs: { 'data-testid': 'workspace' } });
  workspace.append(
    createThumbnailRail({
      pages: state.pages,
      selectedPageIndex: state.selectedPageIndex,
      onSelectPage: (pageIndex) => dispatch({ type: 'select-page', pageIndex }),
    }),
    createPreviewStage(selectedPage, {
      onUpdateCropBox: handleCropBoxUpdate,
      onUpdateCropBoxes: handleCropBoxesUpdate,
    }),
    element('div', { className: 'side-stack' }, [
      createInspectorPanel({
        page: selectedPage,
        pageCount: state.pages.length,
        savedLayouts: state.savedLayouts,
        selectedSavedLayoutId: state.selectedSavedLayoutId ?? '',
        saveCurrentLayoutDisabledReason: getSaveCurrentLayoutDisabledReason(selectedPage),
        onLayoutChange: handleLayoutChange,
        onApplyRange: handleApplyRange,
        onApplyCurrentTemplateToRange: handleApplyCurrentTemplateToRange,
        onCropOptionsChange: handleCropOptionsChange,
        onResetPage: handleResetPage,
        onSaveCurrentLayout: handleSaveCurrentLayout,
        onSelectSavedLayout: handleSelectSavedLayout,
        onRenameSavedLayout: handleRenameSavedLayout,
        onUpdateSavedLayout: handleUpdateSavedLayout,
        onDeleteSavedLayout: handleDeleteSavedLayout,
        onApplySavedLayout: handleApplySavedLayout,
      }),
      createExportPanel({
        state,
        objectUrl,
        onConvert: handleConvert,
        onReset: resetApp,
      }),
    ]),
  );
  app.append(workspace);

  void renderSelectedCanvas(selectedPage, generation);
}

function createHeader(): HTMLElement {
  return element('header', { className: 'top-bar' }, [
    element('div', { className: 'brand-block' }, [
      element('span', { className: 'brand-mark', text: 'PDF' }),
      element('div', {}, [
        element('strong', { text: 'PDF Slide Splitter' }),
        element('span', { text: 'Local handout conversion' }),
      ]),
    ]),
    element('div', { className: 'top-actions' }, [
      element('span', { className: 'privacy-badge', text: 'No external upload' }),
      element('a', {
        className: 'help-link',
        text: 'Limitations',
        attrs: { href: '#limitations' },
      }),
    ]),
  ]);
}

function createStatusRegion(): HTMLElement {
  const statusClass = state.errorMessage ? 'status-region has-error' : 'status-region';
  return element('section', {
    className: statusClass,
    text: state.errorMessage || state.statusMessage,
    attrs: {
      'aria-live': state.phase === 'processing' || state.phase === 'error' ? 'assertive' : 'polite',
      'data-testid': 'status-region',
    },
  });
}

function createPrivacyChecklist(): HTMLElement {
  return element('section', { className: 'privacy-checklist', attrs: { id: 'limitations' } }, [
    element('article', {}, [
      element('h2', { text: 'Local-first by design' }),
      element('p', { text: 'The app reads your selected PDF in browser memory, keeps saved crop layouts only for the current PDF session, and creates a new local download Blob. There is no analytics, upload endpoint, browser persistence, or backend processing path.' }),
    ]),
    element('article', {}, [
      element('h2', { text: 'Review before export' }),
      element('p', { text: 'Automatic layout suggestions are best-effort. Save Layout 1 from a representative page, rename or update it, then apply the saved crop layout to explicit page ranges. Existing pages change only when you apply or reapply a layout.' }),
    ]),
    element('article', {}, [
      element('h2', { text: 'PDF-preserving output' }),
      element('p', { text: 'The source PDF is left unchanged. Each exported slide is placed on an A4 landscape page for readers such as GoodNotes, with white padding when needed and vector/text fidelity where the browser PDF engine supports it.' }),
    ]),
  ]);
}

async function handleFile(file: File): Promise<void> {
  try {
    dispatch({ type: 'loading', message: `Reading ${file.name} locally…` });
    if (loadedPdf?.pdfJsDocument.destroy) {
      await loadedPdf.pdfJsDocument.destroy();
    }
    revokeObjectUrl();
    loadedPdf = await readPdfFile(file);
    const pages = await buildInitialPagePlans(loadedPdf);
    const initialPages = clonePagePlans(pages);
    const plan = buildConversionPlan(file.name, pages, loadedPdf.bytes.byteLength);
    dispatch({
      type: 'loaded',
      sourceFileName: file.name,
      sourceByteLength: loadedPdf.bytes.byteLength,
      sourceHash: loadedPdf.sourceHash,
      pages,
      initialPages,
      plan,
    });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

async function buildInitialPagePlans(pdf: LoadedPdf): Promise<PagePlan[]> {
  const pages: PagePlan[] = [];
  for (let index = 0; index < pdf.pageBoxes.length; index += 1) {
    const pageBox = pdf.pageBoxes[index];
    if (!pageBox) continue;
    dispatch({ type: 'loading', message: `Analyzing page ${index + 1} of ${pdf.pageBoxes.length} locally…` });
    try {
      const analysis = await renderPdfPageForAnalysisWithMetadata(pdf.pdfJsDocument, index + 1, 360);
      const suggestion = suggestLayoutFromImage(analysis.imageData, pageBox);
      pages.push(createDetectedPlanFromSuggestion(index, pageBox, suggestion, 'projection-profile', analysis.metadata));
    } catch {
      const suggestion = suggestLayoutFromPageBox(pageBox);
      pages.push(createDetectedPlanFromSuggestion(index, pageBox, {
        ...suggestion,
        confidence: 'review-needed',
        reviewState: 'review-needed',
        reason: `Preview analysis failed. ${suggestion.reason}`,
      }, 'analysis-failed'));
    }
  }
  return pages;
}

function createDetectedPlanFromSuggestion(
  pageIndex: number,
  pageBox: PagePlan['pageBox'],
  suggestion: LayoutSuggestion,
  source: DetectionSource,
  analysis?: AnalysisRenderMetadata,
): PagePlan {
  return createDetectedPagePlan(pageIndex, pageBox, {
    layoutId: suggestion.layoutId,
    ...(suggestion.grid ? { grid: suggestion.grid } : {}),
    confidence: suggestion.confidence,
    ...(suggestion.reviewState ? { reviewState: suggestion.reviewState } : {}),
    reason: suggestion.reason,
    score: suggestion.score,
    source,
    detection: { ...suggestion.detection, source, ...(suggestion.detection.render ? {} : analysis ? { render: analysis } : {}) },
    visualCropRects: suggestion.visualCropRects,
    ...(analysis ? { analysis } : {}),
  });
}

async function renderSelectedCanvas(page: PagePlan, generation: number): Promise<void> {
  const canvas = app.querySelector<HTMLCanvasElement>('[data-testid="pdf-canvas"]');
  if (!loadedPdf || !canvas) return;
  try {
    await renderPdfPageToCanvas(loadedPdf.pdfJsDocument, page.pageNumber, canvas, 860);
    if (generation === renderGeneration) {
      syncPreviewSurfaceToCanvas(canvas);
      renderExpectedOutputPreviews(page, canvas, app);
    }
  } catch (error) {
    if (generation === renderGeneration) {
      dispatch({ type: 'error', message: `Preview render failed: ${getErrorMessage(error)}` });
    }
  }
}

function handleLayoutChange(layoutId: LayoutPresetId): void {
  updatePages((pages) => pages.map((page, index) => (index === state.selectedPageIndex ? updatePageLayout(page, layoutId) : page)));
}

function handleApplyRange(range: string, layoutId: LayoutPresetId): void {
  try {
    updatePages((pages) => applyLayoutToPageRange(pages, range, layoutId));
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleApplyCurrentTemplateToRange(range: string): void {
  const selectedPage = state.pages[state.selectedPageIndex];
  if (!selectedPage) return;
  try {
    updatePages((pages) => applyCropTemplateToPageRange(pages, range, selectedPage));
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleCropOptionsChange(options: CropOptions): void {
  try {
    updatePages((pages) => pages.map((page, index) => (index === state.selectedPageIndex ? updatePageCropOptions(page, options) : page)));
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleCropBoxUpdate(change: PreviewCropBoxChange): void {
  try {
    updatePages((pages) => pages.map((page) => {
      if (page.pageIndex !== change.pageIndex) return page;
      return applyCropBoxOverride(page, {
        cropBoxes: change.cropBoxes,
        reason: `User adjusted crop ${change.cropIndex + 1} with ${change.interaction}.`,
      });
    }));
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleCropBoxesUpdate(change: PreviewCropBoxesChange): void {
  try {
    updatePages((pages) => pages.map((page) => {
      if (page.pageIndex !== change.pageIndex) return page;
      return applyOutputCropBoxesOverride(page, change.cropBoxes, outputCropBoxesUpdateReason(change));
    }));
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function outputCropBoxesUpdateReason(change: PreviewCropBoxesChange): string {
  if (change.interaction === 'delete') return `User deleted output slide ${(change.fromIndex ?? 0) + 1}.`;
  if (change.interaction === 'reorder') return `User moved output slide ${(change.fromIndex ?? 0) + 1} to position ${(change.toIndex ?? 0) + 1}.`;
  return 'User edited output slide pages.';
}

function handleResetPage(): void {
  const original = state.initialPages[state.selectedPageIndex];
  if (!original) return;
  updatePages((pages) => pages.map((page, index) => (index === state.selectedPageIndex ? clonePagePlan(original) : page)));
}

function updatePages(pagesOrUpdater: PagePlan[] | ((pages: readonly PagePlan[]) => PagePlan[])): void {
  const pages = typeof pagesOrUpdater === 'function' ? pagesOrUpdater(state.pages) : pagesOrUpdater;
  const plan = buildConversionPlan(state.sourceFileName, pages, state.sourceByteLength);
  dispatch({ type: 'update-pages', pages, plan });
}

function handleSaveCurrentLayout(): void {
  const selectedPage = state.pages[state.selectedPageIndex];
  if (!selectedPage) return;
  const disabledReason = getSaveCurrentLayoutDisabledReason(selectedPage);
  if (disabledReason) {
    dispatch({ type: 'error', message: disabledReason });
    return;
  }

  try {
    dispatch({ type: 'save-saved-layout', page: selectedPage });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleSelectSavedLayout(layoutId: string): void {
  try {
    dispatch({ type: 'select-saved-layout', savedLayoutId: layoutId || null });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleRenameSavedLayout(layoutId: string, name: string): void {
  try {
    dispatch({ type: 'rename-saved-layout', savedLayoutId: layoutId, name });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleUpdateSavedLayout(layoutId: string): void {
  const selectedPage = state.pages[state.selectedPageIndex];
  if (!selectedPage) return;
  const disabledReason = getSaveCurrentLayoutDisabledReason(selectedPage);
  if (disabledReason) {
    dispatch({ type: 'error', message: disabledReason });
    return;
  }

  try {
    dispatch({ type: 'update-saved-layout', savedLayoutId: layoutId, page: selectedPage });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleDeleteSavedLayout(layoutId: string): void {
  try {
    dispatch({ type: 'delete-saved-layout', savedLayoutId: layoutId });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function handleApplySavedLayout(range: string, layoutId: string): void {
  try {
    dispatch({ type: 'apply-saved-layout', savedLayoutId: layoutId, range });
  } catch (error) {
    dispatch({ type: 'error', message: getErrorMessage(error) });
  }
}

function getSaveCurrentLayoutDisabledReason(page: PagePlan): string {
  if (page.reviewState === 'review-needed') return 'Resolve review-needed crop boxes before saving this page as a layout.';
  if (page.cropBoxes.length === 0) return 'Current page has no crop boxes to save as a layout.';
  return '';
}

async function handleConvert(): Promise<void> {
  if (!loadedPdf || !state.plan) return;
  const disabledReason = describeExportDisabledReason({
    sourceBytes: loadedPdf.bytes,
    plan: state.plan,
    requireReview: state.pages.some((page) => page.reviewState === 'review-needed'),
    reviewAccepted: false,
  });
  if (disabledReason) {
    dispatch({ type: 'error', message: disabledReason });
    return;
  }
  const guard = installNoUploadNetworkGuard({
    onBlocked: (event) => {
      window.__pdfSlideSplitterTestHooks?.blockedNetworkEvents?.push(`${event.method} ${event.url}`);
    },
  });
  try {
    revokeObjectUrl();
    dispatch({ type: 'processing', message: 'Converting cropped PDF pages locally…' });
    if (window.__pdfSlideSplitterTestHooks?.attemptNetworkDuringExport) {
      window.__pdfSlideSplitterTestHooks.attemptNetworkDuringExport = false;
      await probeNoUploadGuardForTest();
    }
    if (window.__pdfSlideSplitterTestHooks?.failNextExport) {
      window.__pdfSlideSplitterTestHooks.failNextExport = false;
      throw new Error('Simulated browser export failure.');
    }
    const result = await createSplitPdf(loadedPdf.bytes, state.plan, (progress) => {
      dispatch({ type: 'processing', message: `${progress.label} (${progress.completed}/${progress.total})` });
    });
    objectUrl = URL.createObjectURL(new Blob([toArrayBuffer(result.bytes)], { type: 'application/pdf' }));
    dispatch({ type: 'success', result, message: `Export complete: ${result.outputFileName}` });
  } catch (error) {
    dispatch({ type: 'error', message: `Export failed gracefully: ${getErrorMessage(error)}` });
  } finally {
    guard.dispose();
  }
}

async function probeNoUploadGuardForTest(): Promise<void> {
  const hook = window.__pdfSlideSplitterTestHooks;
  if (!hook) return;
  hook.guardProbe = {};
  try {
    await fetch('/__pdf-slide-splitter-upload-probe', { method: 'POST', body: new Uint8Array([37, 80, 68, 70]) });
    hook.guardProbe.fetchBlocked = false;
  } catch (error) {
    hook.guardProbe.fetchBlocked = true;
    hook.guardProbe.fetchError = getErrorMessage(error);
  }
  hook.guardProbe.sendBeaconReturn = navigator.sendBeacon?.('/__pdf-slide-splitter-beacon-probe', new Uint8Array([1, 2, 3]));
}

function resetApp(): void {
  revokeObjectUrl();
  if (loadedPdf?.pdfJsDocument.destroy) {
    void loadedPdf.pdfJsDocument.destroy();
  }
  loadedPdf = null;
  dispatch({ type: 'reset' });
}

function clonePagePlans(pages: readonly PagePlan[]): PagePlan[] {
  return pages.map(clonePagePlan);
}

function clonePagePlan(page: PagePlan): PagePlan {
  const cropBoxes = page.cropBoxes.map((cropBox) => ({ ...cropBox }));
  const cloned: PagePlan = {
    ...page,
    grid: { ...page.grid, margin: { ...page.grid.margin }, gutter: { ...page.grid.gutter } },
    cropBoxes,
    crops: cropBoxes,
    cropOptions: {
      margin: { ...page.cropOptions.margin },
      gutter: { ...page.cropOptions.gutter },
    },
  };
  if (page.detection) cloned.detection = { ...page.detection, cropRects: [...page.detection.cropRects] };
  return cloned;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function revokeObjectUrl(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = '';
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

renderApp();
