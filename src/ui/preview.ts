import type { CropBox, PageBox, PagePlan, PdfBox } from '../types';
import { A4_LANDSCAPE_PAGE, fitCropWithinA4Landscape } from '../pdf/convert';
import { pdfBoxToVisualRect, visualPageSize, visualRectToPdfBox } from '../pdf/grid';
import { element } from './dom';

type CropInteraction = 'keyboard' | 'move' | 'resize';
type CropBoxesInteraction = 'delete' | 'reorder';
type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
type VisualSize = Pick<PdfBox, 'width' | 'height'>;

const MIN_VISUAL_CROP_SIZE = 4;
const KEYBOARD_NUDGE = 1;
const KEYBOARD_LARGE_NUDGE = 10;
const OUTPUT_PREVIEW_CANVAS_WIDTH = 420;
const OUTPUT_PREVIEW_CANVAS_HEIGHT = Math.round((OUTPUT_PREVIEW_CANVAS_WIDTH * A4_LANDSCAPE_PAGE.height) / A4_LANDSCAPE_PAGE.width);
const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface ThumbnailRailOptions {
  pages: readonly PagePlan[];
  selectedPageIndex: number;
  onSelectPage(pageIndex: number): void;
}

export interface PreviewCropSelection {
  pageIndex: number;
  cropIndex: number;
  cropBox: CropBox;
}

export interface PreviewCropBoxChange extends PreviewCropSelection {
  /** Full authoritative PagePlan.cropBoxes value after this overlay edit. */
  cropBoxes: CropBox[];
  cropBox: CropBox;
  interaction: CropInteraction;
}

export interface PreviewCropBoxesChange {
  pageIndex: number;
  cropBoxes: CropBox[];
  interaction: CropBoxesInteraction;
  fromIndex?: number;
  toIndex?: number;
}

export interface ExpectedOutputPreviewGeometry {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  targetWidth: number;
  targetHeight: number;
}

export interface PreviewStageOptions {
  selectedCropIndex?: number;
  onSelectCropBox?(selection: PreviewCropSelection): void;
  onUpdateCropBox?(change: PreviewCropBoxChange): void;
  onUpdateCropBoxes?(change: PreviewCropBoxesChange): void;
}

export function createThumbnailRail({ pages, selectedPageIndex, onSelectPage }: ThumbnailRailOptions): HTMLElement {
  const rail = element('nav', { className: 'thumbnail-rail', attrs: { 'aria-label': 'PDF pages' } });
  const list = element('ol', { className: 'thumbnail-list' });
  pages.forEach((page, index) => {
    const button = element('button', {
      className: index === selectedPageIndex ? 'thumbnail-button is-selected' : 'thumbnail-button',
      attrs: {
        type: 'button',
        'aria-current': index === selectedPageIndex ? 'page' : 'false',
        'aria-label': `Page ${page.pageNumber}`,
        title: `Page ${page.pageNumber}`,
      },
    }, [
      element('span', { className: 'thumbnail-page-number', text: String(page.pageNumber) }),
    ]);
    button.addEventListener('click', () => onSelectPage(index));
    list.append(element('li', {}, [button]));
  });
  rail.append(list);
  return rail;
}

export function createPreviewStage(page: PagePlan, options: PreviewStageOptions = {}): HTMLElement {
  const stage = element('section', {
    className: previewStageClassName(page),
    attrs: { 'aria-label': 'Slide crop preview' },
  });
  const cropCount = page.cropBoxes.length;
  const reviewSuffix = page.reviewState === 'review-needed' ? ' · review needed' : '';
  const manualSuffix = page.overridden && page.origin === 'manual' ? ' · manual crop' : '';
  stage.append(
    element('header', { className: 'preview-header' }, [
      element('div', {}, [
        element('span', { className: 'eyebrow', text: previewEyebrow(page) }),
        element('h2', { text: `Page ${page.pageNumber}: ${page.grid.label ?? page.layoutId}` }),
      ]),
      element('p', {
        className: 'preview-summary',
        text: `${page.layoutId} · ${cropCount} output slide${cropCount === 1 ? '' : 's'}${reviewSuffix}${manualSuffix}`,
        attrs: { 'data-testid': 'preview-summary' },
      }),
    ]),
  );

  const frame = element('div', { className: 'pdf-preview-frame', attrs: { 'data-review': page.reviewState } });
  const pageSurface = element('div', { className: 'pdf-preview-page' });
  const canvas = element('canvas', { className: 'pdf-canvas', attrs: { 'data-testid': 'pdf-canvas', 'aria-label': `Rendered PDF page ${page.pageNumber}` } }) as HTMLCanvasElement;
  const instructionsId = `crop-overlay-instructions-page-${page.pageNumber}`;
  const overlay = element('ol', {
    className: 'crop-overlay',
    attrs: {
      'data-testid': 'crop-overlay',
      'aria-label': `Crop boxes for page ${page.pageNumber}`,
      'aria-describedby': instructionsId,
    },
  });
  overlay.style.setProperty('--crop-count', String(cropCount));
  overlay.style.gridTemplateColumns = `repeat(${page.grid.columns}, 1fr)`;
  overlay.style.gridTemplateRows = `repeat(${page.grid.rows}, 1fr)`;
  for (const [cropIndex, crop] of page.cropBoxes.entries()) {
    overlay.append(createCropOverlayItem(crop, page, cropIndex, options));
  }
  pageSurface.append(canvas, overlay);
  frame.append(pageSurface);
  stage.append(frame);
  stage.append(createExpectedOutputPreview(page, options));
  stage.append(element('p', {
    className: 'sr-preview-summary visually-hidden',
    text: 'Crop boxes are keyboard focusable. Use arrow keys to nudge the selected crop. Hold Alt or Option with arrow keys to resize it. Drag a selected crop or its handles with a pointer.',
    attrs: { id: instructionsId },
  }));

  if (page.reviewState === 'review-needed') {
    stage.append(element('div', {
      className: 'notice notice-warning',
      text: 'Review needed: automatic detection is uncertain for this page. Choose a layout or adjust crop spacing before export.',
      attrs: { 'data-testid': 'review-needed-page' },
    }));
  }

  return stage;
}

export function renderExpectedOutputPreviews(page: PagePlan, sourceCanvas: HTMLCanvasElement, root: ParentNode = document): void {
  const previewCanvases = root.querySelectorAll<HTMLCanvasElement>('[data-testid="expected-output-canvas"]');
  for (const canvas of previewCanvases) {
    const cropIndex = Number(canvas.dataset.cropIndex);
    const crop = page.cropBoxes[cropIndex];
    if (!crop) continue;
    renderExpectedOutputPreviewCanvas(sourceCanvas, canvas, crop, page.pageBox);
  }
}

export function syncPreviewSurfaceToCanvas(canvas: HTMLCanvasElement): void {
  const pageSurface = canvas.closest<HTMLElement>('.pdf-preview-page');
  const overlay = pageSurface?.querySelector<HTMLElement>('.crop-overlay');
  if (!pageSurface || !overlay) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const width = `${Math.round(rect.width)}px`;
  const height = `${Math.round(rect.height)}px`;
  pageSurface.style.width = width;
  pageSurface.style.height = height;
  overlay.style.width = width;
  overlay.style.height = height;
}

export function renderExpectedOutputPreviewCanvas(
  sourceCanvas: HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement,
  crop: CropBox,
  pageBox: PageBox,
): void {
  targetCanvas.width = OUTPUT_PREVIEW_CANVAS_WIDTH;
  targetCanvas.height = OUTPUT_PREVIEW_CANVAS_HEIGHT;
  const context = targetCanvas.getContext('2d');
  if (!context) return;

  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

  const geometry = expectedOutputPreviewGeometry(
    { width: sourceCanvas.width, height: sourceCanvas.height },
    crop,
    pageBox,
    { width: targetCanvas.width, height: targetCanvas.height },
  );
  if (geometry.sourceWidth <= 0 || geometry.sourceHeight <= 0 || geometry.drawWidth <= 0 || geometry.drawHeight <= 0) return;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    sourceCanvas,
    geometry.sourceX,
    geometry.sourceY,
    geometry.sourceWidth,
    geometry.sourceHeight,
    geometry.drawX,
    geometry.drawY,
    geometry.drawWidth,
    geometry.drawHeight,
  );
}

export function expectedOutputPreviewGeometry(
  sourceCanvasSize: Pick<PdfBox, 'width' | 'height'>,
  crop: PdfBox,
  pageBox: PageBox,
  targetSize: Pick<PdfBox, 'width' | 'height'> = {
    width: OUTPUT_PREVIEW_CANVAS_WIDTH,
    height: OUTPUT_PREVIEW_CANVAS_HEIGHT,
  },
): ExpectedOutputPreviewGeometry {
  const visualSize = visualPageSize(pageBox, pageBox.rotation ?? 0);
  const visualRect = pdfBoxToVisualRect(crop, pageBox);
  const placement = fitCropWithinA4Landscape(crop);
  const sourceX = scaleDimension(visualRect.x, visualSize.width, sourceCanvasSize.width);
  const sourceY = scaleDimension(visualRect.y, visualSize.height, sourceCanvasSize.height);
  const sourceWidth = scaleDimension(visualRect.width, visualSize.width, sourceCanvasSize.width);
  const sourceHeight = scaleDimension(visualRect.height, visualSize.height, sourceCanvasSize.height);
  const drawX = scaleDimension(placement.drawX, placement.pageWidth, targetSize.width);
  const drawWidth = scaleDimension(placement.drawWidth, placement.pageWidth, targetSize.width);
  const drawHeight = scaleDimension(placement.drawHeight, placement.pageHeight, targetSize.height);
  const drawY = scaleDimension(
    placement.pageHeight - placement.drawY - placement.drawHeight,
    placement.pageHeight,
    targetSize.height,
  );
  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
    targetWidth: targetSize.width,
    targetHeight: targetSize.height,
  };
}

function createExpectedOutputPreview(page: PagePlan, options: PreviewStageOptions): HTMLElement {
  const preview = element('section', {
    className: 'expected-output-preview',
    attrs: {
      'aria-label': `Expected exported A4 pages for page ${page.pageNumber}`,
      'data-testid': 'expected-output-preview',
    },
  }, [
    element('div', { className: 'expected-output-heading' }, [
      element('h3', { text: 'Expected output preview' }),
      element('p', {
        className: 'muted',
        text: 'Each card uses the same A4 landscape contain-and-center rule as the exported PDF.',
      }),
    ]),
  ]);

  if (page.cropBoxes.length === 0) {
    preview.append(element('p', {
      className: 'muted',
      text: 'No output preview yet. Choose or adjust a crop layout first.',
      attrs: { 'data-testid': 'expected-output-empty' },
    }));
    return preview;
  }

  const list = element('ol', { className: 'expected-output-list' });
  let draggedCropIndex: number | null = null;
  for (const [cropIndex, crop] of page.cropBoxes.entries()) {
    const canvas = element('canvas', {
      className: 'expected-output-canvas',
      attrs: {
        width: String(OUTPUT_PREVIEW_CANVAS_WIDTH),
        height: String(OUTPUT_PREVIEW_CANVAS_HEIGHT),
        'data-testid': 'expected-output-canvas',
        'aria-label': `Expected exported A4 page ${cropIndex + 1} from crop ${crop.label}`,
      },
      dataset: { cropIndex: String(cropIndex) },
    }) as HTMLCanvasElement;
    const deleteButton = element('button', {
      className: 'expected-output-delete',
      text: 'Delete',
      attrs: {
        type: 'button',
        'data-testid': 'expected-output-delete-button',
        'aria-label': `Delete expected output slide ${cropIndex + 1}`,
      },
    });
    deleteButton.addEventListener('click', () => {
      options.onUpdateCropBoxes?.({
        pageIndex: page.pageIndex,
        cropBoxes: removeCropBoxAt(page.cropBoxes, cropIndex),
        interaction: 'delete',
        fromIndex: cropIndex,
      });
    });

    const item = element('li', {
      className: 'expected-output-card',
      attrs: {
        draggable: 'true',
        'data-testid': 'expected-output-card',
        'data-crop-x': String(crop.x),
        'data-crop-y': String(crop.y),
        'aria-label': `Expected output slide ${cropIndex + 1}; drag to reorder`,
      },
    }, [
      canvas,
      element('div', { className: 'expected-output-card-footer' }, [
        element('span', { className: 'expected-output-label', text: `Output ${cropIndex + 1}` }),
        deleteButton,
      ]),
    ]);
    item.addEventListener('dragstart', (event) => {
      draggedCropIndex = cropIndex;
      item.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', String(cropIndex));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      draggedCropIndex = null;
      clearExpectedOutputDragState(list);
    });
    item.addEventListener('dragover', (event) => {
      if (draggedCropIndex === null || draggedCropIndex === cropIndex) return;
      event.preventDefault();
      item.classList.add('is-drop-target');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('is-drop-target');
    });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const fromIndex = parseDragCropIndex(event.dataTransfer?.getData('text/plain'), draggedCropIndex);
      draggedCropIndex = null;
      clearExpectedOutputDragState(list);
      if (fromIndex === null || fromIndex === cropIndex) return;
      options.onUpdateCropBoxes?.({
        pageIndex: page.pageIndex,
        cropBoxes: moveCropBox(page.cropBoxes, fromIndex, cropIndex),
        interaction: 'reorder',
        fromIndex,
        toIndex: cropIndex,
      });
    });
    list.append(item);
  }
  preview.append(list);
  return preview;
}

function moveCropBox(cropBoxes: readonly CropBox[], fromIndex: number, toIndex: number): CropBox[] {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return [...cropBoxes];
  if (fromIndex < 0 || fromIndex >= cropBoxes.length || toIndex < 0 || toIndex >= cropBoxes.length || fromIndex === toIndex) return [...cropBoxes];
  const next = [...cropBoxes];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return [...cropBoxes];
  next.splice(toIndex, 0, moved);
  return next;
}

function removeCropBoxAt(cropBoxes: readonly CropBox[], cropIndex: number): CropBox[] {
  return cropBoxes.filter((_, index) => index !== cropIndex);
}

function parseDragCropIndex(value: string | undefined, fallback: number | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function clearExpectedOutputDragState(list: HTMLElement): void {
  for (const item of list.querySelectorAll('.expected-output-card')) {
    item.classList.remove('is-dragging', 'is-drop-target');
  }
}

function previewStageClassName(page: PagePlan): string {
  const classes = ['preview-stage'];
  if (page.reviewState === 'review-needed') classes.push('is-review-needed');
  if (page.overridden && page.origin === 'manual') classes.push('is-manual-crop');
  return classes.join(' ');
}

function previewEyebrow(page: PagePlan): string {
  if (page.overridden && page.origin === 'manual') return 'Manual crop';
  if (page.overridden) return 'User override';
  if (page.reviewState === 'review-needed') return 'Review needed';
  return 'Suggested layout';
}

function createCropOverlayItem(crop: CropBox, page: PagePlan, cropIndex: number, options: PreviewStageOptions): HTMLElement {
  const isSelected = options.selectedCropIndex === cropIndex;
  let currentCrop = crop;
  const item = element('li', {
    className: cropOverlayItemClassName(isSelected, page),
    attrs: {
      title: `Crop ${crop.label}`,
      'data-crop-label': crop.label,
      'data-crop-index': String(cropIndex),
      'data-testid': 'crop-overlay-item',
      role: 'button',
      tabindex: '0',
      'aria-pressed': isSelected ? 'true' : 'false',
      'aria-label': cropAriaLabel(crop, page, cropIndex),
    },
  });
  item.append(
    element('span', { className: 'crop-label', text: crop.label }),
    ...RESIZE_HANDLES.map((handle) => element('span', {
      className: `crop-resize-handle crop-resize-handle-${handle}`,
      attrs: {
        'aria-hidden': 'true',
        'data-resize-handle': handle,
      },
    })),
  );
  const rememberCrop = (nextCrop: CropBox): void => {
    currentCrop = nextCrop;
  };
  applyCropOverlayStyle(item, crop, page.pageBox);
  item.addEventListener('pointerdown', (event) => handleCropPointerDown(event, item, currentCrop, page, cropIndex, options, rememberCrop));
  item.addEventListener('keydown', (event) => handleCropKeyDown(event, item, currentCrop, page, cropIndex, options, rememberCrop));
  item.addEventListener('click', () => selectCrop(currentCrop, page, cropIndex, options));
  return item;
}

function cropOverlayItemClassName(isSelected: boolean, page: PagePlan): string {
  const classes = ['crop-overlay-item'];
  if (isSelected) classes.push('is-selected');
  if (page.overridden && page.origin === 'manual') classes.push('is-manual-crop');
  return classes.join(' ');
}

function cropAriaLabel(crop: CropBox, page: PagePlan, cropIndex: number): string {
  return `Page ${page.pageNumber}, crop ${cropIndex + 1} of ${page.cropBoxes.length}, label ${crop.label}, ${formatDimension(crop.width)} by ${formatDimension(crop.height)} PDF points.`;
}

function handleCropPointerDown(
  event: PointerEvent,
  item: HTMLElement,
  crop: CropBox,
  page: PagePlan,
  cropIndex: number,
  options: PreviewStageOptions,
  onLocalCropChange: (crop: CropBox) => void,
): void {
  if (event.button !== 0) return;
  const overlay = item.closest<HTMLOListElement>('.crop-overlay');
  if (!overlay) return;
  const handle = (event.target as HTMLElement | null)?.dataset.resizeHandle as ResizeHandle | undefined;
  const startVisualRect = pdfBoxToVisualRect(crop, page.pageBox);
  const overlayRect = overlay.getBoundingClientRect();
  const visualSize = visualPageSize(page.pageBox, page.pageBox.rotation ?? 0);
  const dragState = {
    clientX: event.clientX,
    clientY: event.clientY,
    crop,
    cropIndex,
    handle,
    item,
    overlayRect,
    page,
    startVisualRect,
    visualSize,
  };
  selectCrop(crop, page, cropIndex, options);
  item.setPointerCapture(event.pointerId);
  event.preventDefault();

  let lastCrop = crop;
  const onPointerMove = (moveEvent: PointerEvent): void => {
    const nextCrop = cropFromPointerDrag(moveEvent, dragState);
    lastCrop = nextCrop;
    onLocalCropChange(nextCrop);
    applyCropOverlayStyle(item, nextCrop, page.pageBox);
  };
  const stopTracking = (endEvent: PointerEvent): void => {
    item.releasePointerCapture(endEvent.pointerId);
    item.removeEventListener('pointermove', onPointerMove);
    item.removeEventListener('pointerup', stopTracking);
    item.removeEventListener('pointercancel', stopTracking);
    if (endEvent.type === 'pointerup') {
      emitCropUpdate(lastCrop, page, cropIndex, handle ? 'resize' : 'move', options);
    }
  };
  item.addEventListener('pointermove', onPointerMove);
  item.addEventListener('pointerup', stopTracking);
  item.addEventListener('pointercancel', stopTracking);
}

function handleCropKeyDown(
  event: KeyboardEvent,
  item: HTMLElement,
  crop: CropBox,
  page: PagePlan,
  cropIndex: number,
  options: PreviewStageOptions,
  onLocalCropChange: (crop: CropBox) => void,
): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectCrop(crop, page, cropIndex, options);
    return;
  }
  if (!isArrowKey(event.key)) return;

  event.preventDefault();
  selectCrop(crop, page, cropIndex, options);
  const step = event.shiftKey ? KEYBOARD_LARGE_NUDGE : KEYBOARD_NUDGE;
  const visualRect = pdfBoxToVisualRect(crop, page.pageBox);
  const visualSize = visualPageSize(page.pageBox, page.pageBox.rotation ?? 0);
  const nextVisualRect = event.altKey
    ? resizeVisualRectWithKeyboard(visualRect, visualSize, event.key, step)
    : moveVisualRectWithKeyboard(visualRect, visualSize, event.key, step);
  const nextCrop = cropBoxFromVisualRect(crop, nextVisualRect, page.pageBox);
  onLocalCropChange(nextCrop);
  applyCropOverlayStyle(item, nextCrop, page.pageBox);
  emitCropUpdate(nextCrop, page, cropIndex, 'keyboard', options);
}

function selectCrop(cropBox: CropBox, page: PagePlan, cropIndex: number, options: PreviewStageOptions): void {
  options.onSelectCropBox?.({
    pageIndex: page.pageIndex,
    cropIndex,
    cropBox,
  });
}

function emitCropUpdate(cropBox: CropBox, page: PagePlan, cropIndex: number, interaction: CropInteraction, options: PreviewStageOptions): void {
  const cropBoxes = page.cropBoxes.map((existingCrop, index) => (index === cropIndex ? cropBox : existingCrop));
  options.onUpdateCropBox?.({
    pageIndex: page.pageIndex,
    cropIndex,
    cropBoxes,
    cropBox,
    interaction,
  });
}

function cropFromPointerDrag(
  event: PointerEvent,
  dragState: {
    clientX: number;
    clientY: number;
    crop: CropBox;
    handle: ResizeHandle | undefined;
    overlayRect: DOMRect;
    page: PagePlan;
    startVisualRect: PdfBox;
    visualSize: VisualSize;
  },
): CropBox {
  const deltaX = ((event.clientX - dragState.clientX) / dragState.overlayRect.width) * dragState.visualSize.width;
  const deltaY = ((event.clientY - dragState.clientY) / dragState.overlayRect.height) * dragState.visualSize.height;
  const nextVisualRect = dragState.handle
    ? resizeVisualRect(dragState.startVisualRect, dragState.visualSize, dragState.handle, deltaX, deltaY)
    : moveVisualRect(dragState.startVisualRect, dragState.visualSize, deltaX, deltaY);
  return cropBoxFromVisualRect(dragState.crop, nextVisualRect, dragState.page.pageBox);
}

function moveVisualRectWithKeyboard(visualRect: PdfBox, visualSize: VisualSize, key: string, step: number): PdfBox {
  const delta = arrowDelta(key, step);
  return moveVisualRect(visualRect, visualSize, delta.x, delta.y);
}

function resizeVisualRectWithKeyboard(visualRect: PdfBox, visualSize: VisualSize, key: string, step: number): PdfBox {
  const delta = arrowDelta(key, step);
  return resizeVisualRect(visualRect, visualSize, 'se', delta.x, delta.y);
}

function moveVisualRect(visualRect: PdfBox, visualSize: VisualSize, deltaX: number, deltaY: number): PdfBox {
  return {
    ...visualRect,
    x: clamp(visualRect.x + deltaX, 0, Math.max(0, visualSize.width - visualRect.width)),
    y: clamp(visualRect.y + deltaY, 0, Math.max(0, visualSize.height - visualRect.height)),
  };
}

function resizeVisualRect(visualRect: PdfBox, visualSize: VisualSize, handle: ResizeHandle, deltaX: number, deltaY: number): PdfBox {
  let left = visualRect.x;
  let top = visualRect.y;
  let right = visualRect.x + visualRect.width;
  let bottom = visualRect.y + visualRect.height;

  if (handle.includes('w')) left = clamp(left + deltaX, 0, right - MIN_VISUAL_CROP_SIZE);
  if (handle.includes('e')) right = clamp(right + deltaX, left + MIN_VISUAL_CROP_SIZE, visualSize.width);
  if (handle.includes('n')) top = clamp(top + deltaY, 0, bottom - MIN_VISUAL_CROP_SIZE);
  if (handle.includes('s')) bottom = clamp(bottom + deltaY, top + MIN_VISUAL_CROP_SIZE, visualSize.height);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function cropBoxFromVisualRect(crop: CropBox, visualRect: PdfBox, pageBox: PageBox): CropBox {
  const pdfRect = visualRectToPdfBox(visualRect, pageBox);
  return {
    ...crop,
    x: pdfRect.x,
    y: pdfRect.y,
    left: pdfRect.x,
    bottom: pdfRect.y,
    width: pdfRect.width,
    height: pdfRect.height,
  };
}

function applyCropOverlayStyle(item: HTMLElement, crop: CropBox, pageBox: PageBox): void {
  const rect = cropBoxToVisualPercentRect(crop, pageBox);
  item.style.left = rect.left;
  item.style.top = rect.top;
  item.style.width = rect.width;
  item.style.height = rect.height;
  item.setAttribute('aria-label', `Crop ${crop.label}, ${formatDimension(crop.width)} by ${formatDimension(crop.height)} PDF points.`);
}

function isArrowKey(key: string): boolean {
  return key === 'ArrowUp' || key === 'ArrowRight' || key === 'ArrowDown' || key === 'ArrowLeft';
}

function arrowDelta(key: string, step: number): { x: number; y: number } {
  switch (key) {
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowDown':
      return { x: 0, y: step };
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDimension(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function cropBoxToVisualPercentRect(crop: PdfBox, pageBox: PageBox): { left: string; top: string; width: string; height: string } {
  const visualSize = visualPageSize(pageBox, pageBox.rotation ?? 0);
  const visualRect = pdfBoxToVisualRect(crop, pageBox);
  return {
    left: toPercent(visualRect.x, visualSize.width),
    top: toPercent(visualRect.y, visualSize.height),
    width: toPercent(visualRect.width, visualSize.width),
    height: toPercent(visualRect.height, visualSize.height),
  };
}

function toPercent(value: number, whole: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(whole) || whole <= 0) return '0%';
  return `${Number(((value / whole) * 100).toFixed(4))}%`;
}

function scaleDimension(value: number, sourceWhole: number, targetWhole: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(sourceWhole) || !Number.isFinite(targetWhole) || sourceWhole <= 0) return 0;
  return (value / sourceWhole) * targetWhole;
}
