import type {
  ConversionPlan,
  CropBox,
  CropBoxOverride,
  CropOptions,
  CropTemplate,
  CropTemplateRect,
  DetectedCropRect,
  DetectionMetadata,
  DetectionSource,
  GridGutter,
  GridSpec,
  LayoutPresetId,
  PageBox,
  PageBoxes,
  PagePlan,
  PageRangeOverride,
  PdfBox,
  ReadingOrder,
  SavedLayoutTemplate,
  SpacingInsets,
  VisualRect,
} from '../types';
export type { LayoutPresetId } from '../types';

const ZERO_INSETS: SpacingInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const ZERO_GUTTER: GridGutter = Object.freeze({ x: 0, y: 0 });

export const LAYOUT_PRESETS: Readonly<Record<LayoutPresetId, Readonly<GridSpec & { id: LayoutPresetId; label: string }>>> = Object.freeze({
  'one-up': Object.freeze({ id: 'one-up', label: '1x1', columns: 1, rows: 1, readingOrder: 'row-major' }),
  'two-up-horizontal': Object.freeze({ id: 'two-up-horizontal', label: '2x1', columns: 2, rows: 1, readingOrder: 'row-major' }),
  'two-up-vertical': Object.freeze({ id: 'two-up-vertical', label: '1x2', columns: 1, rows: 2, readingOrder: 'row-major' }),
  'two-by-two': Object.freeze({ id: 'two-by-two', label: '2x2', columns: 2, rows: 2, readingOrder: 'row-major' }),
  'two-by-three': Object.freeze({ id: 'two-by-three', label: '2x3', columns: 2, rows: 3, readingOrder: 'row-major' }),
  'three-by-two': Object.freeze({ id: 'three-by-two', label: '3x2', columns: 3, rows: 2, readingOrder: 'row-major' }),
});

export const PRESET_GRIDS = LAYOUT_PRESETS;

export function normalizeInsets(margin: Partial<SpacingInsets> = {}): SpacingInsets {
  return {
    top: margin.top ?? ZERO_INSETS.top,
    right: margin.right ?? ZERO_INSETS.right,
    bottom: margin.bottom ?? ZERO_INSETS.bottom,
    left: margin.left ?? ZERO_INSETS.left,
  };
}

export function normalizeGutter(gutter: Partial<GridGutter> = {}): GridGutter {
  return { x: gutter.x ?? ZERO_GUTTER.x, y: gutter.y ?? ZERO_GUTTER.y };
}

export function gridForPreset(layoutId: LayoutPresetId, overrides: Partial<GridSpec> = {}): GridSpec {
  const base = LAYOUT_PRESETS[layoutId];
  return {
    id: layoutId,
    label: base.label,
    columns: overrides.columns ?? base.columns,
    rows: overrides.rows ?? base.rows,
    readingOrder: overrides.readingOrder ?? base.readingOrder ?? 'row-major',
    margin: { ...base.margin, ...overrides.margin },
    gutter: { ...base.gutter, ...overrides.gutter },
  };
}

function gridWithCropOptions(grid: GridSpec, options: Partial<CropOptions> = {}): GridSpec {
  return {
    ...grid,
    margin: { ...grid.margin, ...options.margin },
    gutter: { ...grid.gutter, ...options.gutter },
  };
}

export function effectivePageBox({ mediaBox, cropBox }: PageBoxes): PdfBox {
  assertPositiveBox(mediaBox, 'mediaBox');
  if (!cropBox) return { ...mediaBox };
  assertPositiveBox(cropBox, 'cropBox');
  if (!isBoxInside(cropBox, mediaBox)) throw new RangeError('cropBox must be inside mediaBox when present');
  return { ...cropBox };
}

export function createCropBoxes(pageIndex: number, pageBox: PageBox | PdfBox, layoutId: LayoutPresetId, options: Partial<CropOptions> = {}): CropBox[] {
  const overrides: Partial<GridSpec> = {};
  if (options.margin) overrides.margin = options.margin;
  if (options.gutter) overrides.gutter = options.gutter;
  const grid = gridForPreset(layoutId, overrides);
  return cropBoxesForGrid(pageIndex, { mediaBox: pageBox }, grid);
}

export interface DetectedPagePlanInput {
  layoutId: LayoutPresetId;
  grid?: GridSpec;
  confidence: PagePlan['confidence'];
  reviewState?: PagePlan['reviewState'];
  reason: string;
  score: number;
  source: DetectionSource;
  analysis?: DetectionMetadata['analysis'];
  detection?: DetectionMetadata;
  visualCropRects?: readonly DetectedCropRect[];
}


export function cropBoxesForGrid(pageIndex: number, boxes: PageBoxes, grid: GridSpec): CropBox[] {
  const effective = effectivePageBox(boxes);
  const rotation = normalizeRotation((boxes.cropBox as PageBox | undefined)?.rotation ?? (boxes.mediaBox as PageBox | undefined)?.rotation ?? 0);
  return materializeCropBoxesFromTemplate(pageIndex, { ...effective, rotation }, createCropTemplate({ ...effective, rotation }, grid));
}

export function createCropTemplate(pageBox: PageBox | PdfBox, grid: GridSpec): CropTemplate {
  validateGridSpec(grid);
  const rotation = normalizeRotation((pageBox as PageBox).rotation ?? 0);
  const margin = normalizeInsets(grid.margin);
  const gutter = normalizeGutter(grid.gutter);
  const visualSize = visualPageSize(pageBox, rotation);
  const horizontalGutters = gutter.x * (grid.columns - 1);
  const verticalGutters = gutter.y * (grid.rows - 1);
  const availableWidth = visualSize.width - margin.left - margin.right - horizontalGutters;
  const availableHeight = visualSize.height - margin.top - margin.bottom - verticalGutters;
  if (availableWidth <= 0 || availableHeight <= 0) throw new RangeError('grid margins/gutters leave no positive crop area');

  const cellWidth = availableWidth / grid.columns;
  const cellHeight = availableHeight / grid.rows;
  const readingOrder: ReadingOrder = grid.readingOrder ?? 'row-major';
  const rects: CropTemplateRect[] = [];

  const pushRect = (row: number, column: number): void => {
    const visualTopEdge = margin.top + row * (cellHeight + gutter.y);
    const order = rects.length + 1;
    rects.push({
      x: margin.left + column * (cellWidth + gutter.x),
      y: visualTopEdge,
      width: cellWidth,
      height: cellHeight,
      order,
      label: String(order),
      row,
      column,
    });
  };

  if (readingOrder === 'row-major') {
    for (let row = 0; row < grid.rows; row += 1) for (let column = 0; column < grid.columns; column += 1) pushRect(row, column);
  } else {
    for (let column = 0; column < grid.columns; column += 1) for (let row = 0; row < grid.rows; row += 1) pushRect(row, column);
  }

  const template: CropTemplate = {
    columns: grid.columns,
    rows: grid.rows,
    readingOrder,
    rects,
  };
  if (grid.id) template.layoutId = grid.id;
  if (grid.label) template.label = grid.label;
  return template;
}

export function materializeCropBoxesFromTemplate(pageIndex: number, pageBox: PageBox | PdfBox, template: CropTemplate): CropBox[] {
  const orderedRects = orderVisualRectsByReadingOrder(template.rects, template.readingOrder);
  const crops = orderedRects.map((visualRect, index) =>
    cropBoxFromVisualRect(pageIndex, pageBox, withOrderedGridMetadata(visualRect, index, template), index),
  );
  assertCropBoxesBounded(crops, pageBox);
  return crops;
}


export function createPagePlan(
  pageIndex: number,
  pageBox: PageBox | PdfBox,
  layoutId: LayoutPresetId,
  confidence: PagePlan['confidence'] = 'medium',
  reason = 'Layout selected from page geometry.',
  score = 0.5,
): PagePlan {
  const normalizedPageBox: PageBox = { ...pageBox };
  const grid = gridForPreset(layoutId);
  const cropOptions: CropOptions = { margin: {}, gutter: {} };
  const cropBoxes = createCropBoxes(pageIndex, normalizedPageBox, layoutId, cropOptions);
  return {
    pageIndex,
    pageNumber: pageIndex + 1,
    layoutId,
    layout: layoutId,
    grid,
    pageBox: normalizedPageBox,
    boxes: { mediaBox: normalizedPageBox },
    cropBoxes,
    crops: cropBoxes,
    confidence,
    reviewState: confidence === 'low' || confidence === 'review-needed' ? 'review-needed' : 'ready',
    reason,
    score,
    overridden: false,
    cropOptions,
    origin: 'manual',
  };
}

export function createDetectedPagePlan(pageIndex: number, pageBox: PageBox | PdfBox, detected: DetectedPagePlanInput): PagePlan {
  const normalizedPageBox: PageBox = { ...pageBox };
  const cropOptions: CropOptions = { margin: {}, gutter: {} };
  const grid = detected.grid ? gridWithCropOptions(detected.grid, cropOptions) : gridForPreset(detected.layoutId, cropOptions);
  const visualCropRects = detected.visualCropRects ?? detected.detection?.cropRects ?? [];
  const readingOrder = grid.readingOrder ?? 'row-major';
  const orderedVisualCropRects = orderVisualRectsByReadingOrder(visualCropRects, readingOrder).map((visualRect, index) =>
    withOrderedGridMetadata(visualRect, index, grid),
  );
  const canProjectDetectedCrops =
    detected.confidence !== 'low' &&
    detected.confidence !== 'review-needed' &&
    detected.reviewState !== 'review-needed' &&
    visualCropRects.length > 0;
  const cropBoxes = canProjectDetectedCrops ? cropBoxesFromVisualRects(pageIndex, normalizedPageBox, orderedVisualCropRects, grid) : [];
  const reviewState = canProjectDetectedCrops ? (detected.reviewState ?? 'ready') : 'review-needed';
  const detectionOutcome = canProjectDetectedCrops
    ? (detected.detection?.outcome ?? (cropBoxes.length === 1 ? 'one-up' : 'detected-grid'))
    : 'review-needed';
  const detection: DetectionMetadata = {
    source: detected.detection?.source ?? detected.source,
    outcome: detectionOutcome,
    layoutId: detected.detection?.layoutId ?? detected.layoutId,
    confidence: detected.detection?.confidence ?? detected.confidence,
    score: detected.detection?.score ?? detected.score,
    columns: detected.detection?.columns ?? grid.columns,
    rows: detected.detection?.rows ?? grid.rows,
    warnings: detected.detection?.warnings ?? [],
    cropProjection: canProjectDetectedCrops ? 'detected-grid' : 'none',
    cropRects: canProjectDetectedCrops ? orderedVisualCropRects : [...visualCropRects],
  };
  const render = detected.detection?.render ?? detected.analysis;
  const analysisAlias = detected.detection?.analysis ?? detected.analysis;
  if (render) detection.render = render;
  if (analysisAlias) detection.analysis = analysisAlias;
  if (detected.detection?.analysisContentRect) detection.analysisContentRect = detected.detection.analysisContentRect;
  if (detected.detection?.visualContentRect) detection.visualContentRect = detected.detection.visualContentRect;
  if (detected.detection?.xRuns) detection.xRuns = detected.detection.xRuns;
  if (detected.detection?.yRuns) detection.yRuns = detected.detection.yRuns;

  return {
    pageIndex,
    pageNumber: pageIndex + 1,
    layoutId: detected.layoutId,
    layout: detected.layoutId,
    grid,
    pageBox: normalizedPageBox,
    boxes: { mediaBox: normalizedPageBox },
    cropBoxes,
    crops: cropBoxes,
    confidence: detected.confidence,
    reviewState,
    reason: detected.reason,
    score: detected.score,
    overridden: false,
    cropOptions,
    origin: 'detected',
    detection,
  };
}

function cropBoxesFromVisualRects(pageIndex: number, pageBox: PageBox, visualRects: readonly DetectedCropRect[], grid: GridSpec): CropBox[] {
  const readingOrder = grid.readingOrder ?? 'row-major';
  const orderedRects = orderVisualRectsByReadingOrder(visualRects, readingOrder);
  const crops = orderedRects.map((visualRect, index) =>
    cropBoxFromVisualRect(pageIndex, pageBox, withOrderedGridMetadata(visualRect, index, grid), index),
  );
  assertCropBoxesBounded(crops, pageBox);
  return crops;
}

function cropBoxFromVisualRect(
  pageIndex: number,
  pageBox: PageBox | PdfBox,
  visualRect: VisualRect & Partial<Pick<CropTemplateRect, 'order' | 'label' | 'row' | 'column'>>,
  index: number,
): CropBox {
  const pdfRect = visualRectToPdfBox(visualRect, pageBox);
  const order = index + 1;
  return {
    pageIndex,
    pageNumber: pageIndex + 1,
    order,
    label: normalizeCropLabel(visualRect.label, visualRect.order, order),
    row: visualRect.row ?? 0,
    column: visualRect.column ?? index,
    x: pdfRect.x,
    y: pdfRect.y,
    left: pdfRect.x,
    bottom: pdfRect.y,
    width: pdfRect.width,
    height: pdfRect.height,
  };
}

function cloneCropBoxes(cropBoxes: readonly CropBox[], pageBox: PageBox | PdfBox, grid: GridSpec): CropBox[] {
  const readingOrder = grid.readingOrder ?? 'row-major';
  const orderedCropBoxes = orderCropBoxesByVisualReadingOrder(cropBoxes, pageBox, readingOrder);
  return orderedCropBoxes.map((cropBox, index) => {
    const order = index + 1;
    const { row, column } = gridPositionForIndex(index, grid.columns, grid.rows, readingOrder);
    return {
      ...cropBox,
      order,
      label: normalizeCropLabel(cropBox.label, cropBox.order, order),
      row,
      column,
      x: cropBox.x,
      y: cropBox.y,
      left: cropBox.left ?? cropBox.x,
      bottom: cropBox.bottom ?? cropBox.y,
    };
  });
}

function withOrderedGridMetadata<T extends VisualRect & Partial<Pick<CropTemplateRect, 'order' | 'label' | 'row' | 'column'>>>(
  rect: T,
  index: number,
  grid: Pick<GridSpec, 'columns' | 'rows' | 'readingOrder'>,
): T & Pick<CropTemplateRect, 'order' | 'label' | 'row' | 'column'> {
  const order = index + 1;
  const { row, column } = gridPositionForIndex(index, grid.columns, grid.rows, grid.readingOrder ?? 'row-major');
  return {
    ...rect,
    order,
    label: normalizeCropLabel(rect.label, rect.order, order),
    row,
    column,
  };
}

function orderVisualRectsByReadingOrder<T extends VisualRect>(rects: readonly T[], readingOrder: ReadingOrder = 'row-major'): T[] {
  return rects
    .map((rect, index) => ({ rect, index }))
    .sort((a, b) => compareVisualRects(a.rect, b.rect, readingOrder) || a.index - b.index)
    .map(({ rect }) => rect);
}

function orderCropBoxesByVisualReadingOrder(cropBoxes: readonly CropBox[], pageBox: PageBox | PdfBox, readingOrder: ReadingOrder): CropBox[] {
  return cropBoxes
    .map((cropBox, index) => ({ cropBox, visualRect: pdfBoxToVisualRect(cropBox, pageBox), index }))
    .sort((a, b) => compareVisualRects(a.visualRect, b.visualRect, readingOrder) || a.index - b.index)
    .map(({ cropBox }) => cropBox);
}

function compareVisualRects(a: VisualRect, b: VisualRect, readingOrder: ReadingOrder): number {
  return readingOrder === 'column-major'
    ? compareNumbers(a.x, b.x) || compareNumbers(a.y, b.y)
    : compareNumbers(a.y, b.y) || compareNumbers(a.x, b.x);
}

function compareNumbers(a: number, b: number): number {
  const delta = a - b;
  return Math.abs(delta) < 0.001 ? 0 : delta;
}

function normalizeCropLabel(label: string | undefined, sourceOrder: number | undefined, order: number): string {
  const trimmed = label?.trim();
  if (!trimmed) return String(order);
  if (/^\d+$/.test(trimmed) || (sourceOrder !== undefined && trimmed === String(sourceOrder))) return String(order);
  return trimmed;
}

function gridPositionForIndex(index: number, columns: number, rows: number, readingOrder: ReadingOrder): { row: number; column: number } {
  return readingOrder === 'column-major'
    ? { row: index % rows, column: Math.floor(index / rows) }
    : { row: Math.floor(index / columns), column: index % columns };
}

function templateFromVisualRects(grid: GridSpec, visualRects: readonly CropTemplateRect[]): CropTemplate {
  const template: CropTemplate = {
    columns: grid.columns,
    rows: grid.rows,
    readingOrder: grid.readingOrder ?? 'row-major',
    rects: [...visualRects],
  };
  if (grid.id) template.layoutId = grid.id;
  if (grid.label) template.label = grid.label;
  return template;
}

export function cloneCropTemplate(template: CropTemplate): CropTemplate {
  const cloned: CropTemplate = {
    columns: template.columns,
    rows: template.rows,
    readingOrder: template.readingOrder,
    rects: template.rects.map((rect) => ({ ...rect })),
  };
  if (template.layoutId) cloned.layoutId = template.layoutId;
  if (template.label) cloned.label = template.label;
  return cloned;
}

export function cloneSavedLayoutTemplate(savedLayout: SavedLayoutTemplate): SavedLayoutTemplate {
  return {
    id: savedLayout.id,
    name: savedLayout.name,
    template: cloneCropTemplate(savedLayout.template),
    sourcePageIndex: savedLayout.sourcePageIndex,
    sourcePageNumber: savedLayout.sourcePageNumber,
  };
}

export interface CreateSavedLayoutTemplateOptions {
  id?: string;
  name?: string;
  existingLayouts?: readonly SavedLayoutTemplate[];
}

export function getNextSavedLayoutName(savedLayouts: readonly Pick<SavedLayoutTemplate, 'name'>[]): string {
  const used = new Set<number>();
  for (const layout of savedLayouts) {
    const match = /^Layout\s+([1-9]\d*)$/i.exec(layout.name.trim());
    if (match) used.add(Number(match[1]));
  }

  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return `Layout ${candidate}`;
}

export function validateSavedLayoutName(
  name: string,
  savedLayouts: readonly Pick<SavedLayoutTemplate, 'id' | 'name'>[],
  currentId?: string,
): string {
  const trimmed = name.trim();
  if (!trimmed) throw new RangeError('Saved layout name must not be empty.');
  const normalized = trimmed.toLocaleLowerCase();
  const duplicate = savedLayouts.some((layout) => layout.id !== currentId && layout.name.trim().toLocaleLowerCase() === normalized);
  if (duplicate) throw new RangeError(`Saved layout name "${trimmed}" must be unique; duplicate names are not allowed.`);
  return trimmed;
}

export function createCropTemplateFromPage(page: PagePlan): CropTemplate {
  if (page.reviewState === 'review-needed') throw new RangeError('Review-needed pages cannot be saved as crop layouts.');
  if (page.cropBoxes.length === 0) throw new RangeError('Current page has no crop boxes to save.');
  const rects = page.cropBoxes.map((cropBox, index) => {
    const visualRect = pdfBoxToVisualRect(cropBox, page.pageBox);
    const order = cropBox.order || index + 1;
    return {
      ...visualRect,
      order,
      label: cropBox.label || String(order),
      row: cropBox.row,
      column: cropBox.column,
    };
  });
  const columns = Math.max(1, ...rects.map((rect) => rect.column + 1));
  const rows = Math.max(1, ...rects.map((rect) => rect.row + 1));
  const layoutId = layoutPresetForDimensions(columns, rows, page.layoutId);
  return {
    layoutId,
    label: LAYOUT_PRESETS[layoutId].label,
    columns,
    rows,
    readingOrder: page.grid.readingOrder ?? 'row-major',
    rects,
  };
}

export const nextSavedLayoutName = getNextSavedLayoutName;

function nextSavedLayoutId(savedLayouts: readonly Pick<SavedLayoutTemplate, 'id'>[]): string {
  const usedIds = new Set(savedLayouts.map((savedLayout) => savedLayout.id));
  for (let index = 1; ; index += 1) {
    const candidate = `saved-layout-${index}`;
    if (!usedIds.has(candidate)) return candidate;
  }
}

function validateSavedLayoutId(id: string, savedLayouts: readonly Pick<SavedLayoutTemplate, 'id'>[], currentLayoutId?: string): string {
  const normalized = id.trim();
  if (!normalized) throw new RangeError('Saved crop layout id must not be empty.');
  const duplicate = savedLayouts.some((savedLayout) => savedLayout.id !== currentLayoutId && savedLayout.id === normalized);
  if (duplicate) throw new RangeError(`Saved crop layout id "${normalized}" is already in use.`);
  return normalized;
}

export function createSavedLayoutTemplateFromPage(page: PagePlan, options?: CreateSavedLayoutTemplateOptions): SavedLayoutTemplate;
export function createSavedLayoutTemplateFromPage(
  page: PagePlan,
  existingLayouts: readonly SavedLayoutTemplate[],
  id?: string,
): SavedLayoutTemplate;
export function createSavedLayoutTemplateFromPage(
  page: PagePlan,
  optionsOrExistingLayouts: CreateSavedLayoutTemplateOptions | readonly SavedLayoutTemplate[] = {},
  requestedId?: string,
): SavedLayoutTemplate {
  const options: CreateSavedLayoutTemplateOptions = Array.isArray(optionsOrExistingLayouts)
    ? { existingLayouts: optionsOrExistingLayouts as readonly SavedLayoutTemplate[], ...(requestedId ? { id: requestedId } : {}) }
    : (optionsOrExistingLayouts as CreateSavedLayoutTemplateOptions);
  const existingLayouts = options.existingLayouts ?? [];
  const id = validateSavedLayoutId(options.id ?? nextSavedLayoutId(existingLayouts), existingLayouts);
  const name = validateSavedLayoutName(options.name ?? getNextSavedLayoutName(existingLayouts), existingLayouts);
  return {
    id,
    name,
    template: createCropTemplateFromPage(page),
    sourcePageIndex: page.pageIndex,
    sourcePageNumber: page.pageNumber,
  };
}

export const createSavedLayoutTemplate = createSavedLayoutTemplateFromPage;

export function renameSavedLayoutTemplate(
  savedLayout: SavedLayoutTemplate,
  name: string,
  savedLayouts?: readonly SavedLayoutTemplate[],
): SavedLayoutTemplate;
export function renameSavedLayoutTemplate(
  savedLayouts: readonly SavedLayoutTemplate[],
  savedLayoutId: string,
  name: string,
): SavedLayoutTemplate[];
export function renameSavedLayoutTemplate(
  layoutOrLayouts: SavedLayoutTemplate | readonly SavedLayoutTemplate[],
  nameOrLayoutId: string,
  nameOrSavedLayouts?: string | readonly SavedLayoutTemplate[],
): SavedLayoutTemplate | SavedLayoutTemplate[] {
  if (Array.isArray(layoutOrLayouts)) {
    if (typeof nameOrSavedLayouts !== 'string') throw new TypeError('Saved crop layout name is required.');
    const savedLayouts = layoutOrLayouts as readonly SavedLayoutTemplate[];
    const savedLayoutId = nameOrLayoutId;
    const normalizedName = validateSavedLayoutName(nameOrSavedLayouts, savedLayouts, savedLayoutId);
    let found = false;
    const renamed = savedLayouts.map((savedLayout) => {
      if (savedLayout.id !== savedLayoutId) return savedLayout;
      found = true;
      return { ...cloneSavedLayoutTemplate(savedLayout), name: normalizedName };
    });
    if (!found) throw new RangeError(`Saved crop layout "${savedLayoutId}" was not found.`);
    return renamed;
  }

  const savedLayout = layoutOrLayouts as SavedLayoutTemplate;
  const savedLayouts = Array.isArray(nameOrSavedLayouts) ? (nameOrSavedLayouts as readonly SavedLayoutTemplate[]) : [];
  const normalizedName = validateSavedLayoutName(nameOrLayoutId, savedLayouts, savedLayout.id);
  return { ...cloneSavedLayoutTemplate(savedLayout), name: normalizedName };
}

export function updateSavedLayoutTemplateFromPage(savedLayout: SavedLayoutTemplate, page: PagePlan): SavedLayoutTemplate;
export function updateSavedLayoutTemplateFromPage(
  savedLayouts: readonly SavedLayoutTemplate[],
  savedLayoutId: string,
  page: PagePlan,
): SavedLayoutTemplate[];
export function updateSavedLayoutTemplateFromPage(
  layoutOrLayouts: SavedLayoutTemplate | readonly SavedLayoutTemplate[],
  pageOrLayoutId: PagePlan | string,
  page?: PagePlan,
): SavedLayoutTemplate | SavedLayoutTemplate[] {
  if (Array.isArray(layoutOrLayouts)) {
    if (typeof pageOrLayoutId !== 'string' || !page) throw new TypeError('Saved crop layout id and source page are required.');
    let found = false;
    const updated = layoutOrLayouts.map((savedLayout) => {
      if (savedLayout.id !== pageOrLayoutId) return savedLayout;
      found = true;
      return refreshSavedLayoutTemplateFromPage(savedLayout, page);
    });
    if (!found) throw new RangeError(`Saved crop layout "${pageOrLayoutId}" was not found.`);
    return updated;
  }

  if (typeof pageOrLayoutId === 'string') throw new TypeError('Source page is required.');
  const savedLayout = layoutOrLayouts as SavedLayoutTemplate;
  return refreshSavedLayoutTemplateFromPage(savedLayout, pageOrLayoutId);
}

export const updateSavedLayoutTemplate = updateSavedLayoutTemplateFromPage;

export function updateSavedLayoutTemplateInList(
  savedLayouts: readonly SavedLayoutTemplate[],
  savedLayoutId: string,
  page: PagePlan,
): SavedLayoutTemplate[] {
  return updateSavedLayoutTemplateFromPage(savedLayouts, savedLayoutId, page);
}

function refreshSavedLayoutTemplateFromPage(savedLayout: SavedLayoutTemplate, page: PagePlan): SavedLayoutTemplate {
  return {
    ...cloneSavedLayoutTemplate(savedLayout),
    template: createCropTemplateFromPage(page),
    sourcePageIndex: page.pageIndex,
    sourcePageNumber: page.pageNumber,
  };
}

export function deleteSavedLayoutTemplate(savedLayouts: readonly SavedLayoutTemplate[], savedLayoutId: string): SavedLayoutTemplate[] {
  return savedLayouts.filter((savedLayout) => savedLayout.id !== savedLayoutId).map(cloneSavedLayoutTemplate);
}

function scaleTemplateToPage(template: CropTemplate, sourcePageBox: PageBox, targetPageBox: PageBox): CropTemplate {
  const sourceSize = visualPageSize(sourcePageBox, sourcePageBox.rotation ?? 0);
  const targetSize = visualPageSize(targetPageBox, targetPageBox.rotation ?? 0);
  const scaleX = targetSize.width / sourceSize.width;
  const scaleY = targetSize.height / sourceSize.height;
  return {
    ...template,
    rects: template.rects.map((rect) => ({
      ...rect,
      x: roundPoint(rect.x * scaleX),
      y: roundPoint(rect.y * scaleY),
      width: roundPoint(rect.width * scaleX),
      height: roundPoint(rect.height * scaleY),
    })),
  };
}

export function updatePageLayout(page: PagePlan, layoutId: LayoutPresetId): PagePlan {
  return updatePageLayoutWithGrid(page, layoutId);
}

function updatePageLayoutWithGrid(page: PagePlan, layoutId: LayoutPresetId, gridOverrides: Partial<GridSpec> = {}): PagePlan {
  const cropOptions: CropOptions = {
    margin: { ...page.cropOptions.margin, ...gridOverrides.margin },
    gutter: { ...page.cropOptions.gutter, ...gridOverrides.gutter },
  };
  const grid = gridForPreset(layoutId, { ...gridOverrides, margin: cropOptions.margin, gutter: cropOptions.gutter });
  const cropBoxes = cropBoxesForGrid(page.pageIndex, page.boxes, grid);
  const { detection: _detection, ...pageWithoutDetection } = page;
  void _detection;
  return {
    ...pageWithoutDetection,
    layoutId,
    layout: layoutId,
    grid,
    cropBoxes,
    crops: cropBoxes,
    confidence: 'high',
    reviewState: 'ready',
    reason: `User selected ${LAYOUT_PRESETS[layoutId].label}.`,
    score: 1,
    overridden: true,
    origin: 'manual',
    cropOptions,
  };
}

export function updatePageCropOptions(page: PagePlan, options: CropOptions): PagePlan {
  const cropOptions: CropOptions = { margin: { ...options.margin }, gutter: { ...options.gutter } };
  const grid = gridWithCropOptions(page.grid, cropOptions);
  const cropBoxes = cropBoxesForGrid(page.pageIndex, page.boxes, grid);
  const { detection: _detection, ...pageWithoutDetection } = page;
  void _detection;
  return {
    ...pageWithoutDetection,
    cropOptions,
    grid,
    cropBoxes,
    crops: cropBoxes,
    confidence: 'high',
    reviewState: 'ready',
    score: 1,
    overridden: true,
    reason: 'User adjusted crop margins or gutters.',
    origin: 'manual',
  };
}

export function applyLayoutToPageRange(pages: readonly PagePlan[], range: string, layoutId: LayoutPresetId): PagePlan[] {
  const indexes = parsePageRange(range, pages.length);
  return pages.map((page, index) => (indexes.has(index) ? updatePageLayout(page, layoutId) : page));
}

export function applyCropTemplateToPageRange(pages: readonly PagePlan[], range: string, sourcePage: PagePlan): PagePlan[] {
  if (sourcePage.cropBoxes.length === 0) throw new RangeError('Current page has no crop boxes to apply.');
  const indexes = parsePageRange(range, pages.length);
  return pages.map((page, index) => (indexes.has(index) ? applyCropTemplateFromPage(page, sourcePage) : page));
}

export function applyCropTemplateFromPage(page: PagePlan, sourcePage: PagePlan): PagePlan {
  if (sourcePage.cropBoxes.length === 0) throw new RangeError('Current page has no crop boxes to apply.');
  const sourceTemplate = createCropTemplateFromPage(sourcePage);
  const template = scaleTemplateToPage(sourceTemplate, sourcePage.pageBox, page.pageBox);
  const cropBoxes = materializeCropBoxesFromTemplate(page.pageIndex, page.pageBox, template);
  const layoutId = template.layoutId ?? sourcePage.layoutId;
  const cropOptions: CropOptions = { margin: {}, gutter: {} };
  const grid: GridSpec = {
    id: layoutId,
    label: template.label ?? LAYOUT_PRESETS[layoutId].label,
    columns: template.columns,
    rows: template.rows,
    readingOrder: template.readingOrder,
  };
  const { detection: _detection, ...pageWithoutDetection } = page;
  void _detection;
  return {
    ...pageWithoutDetection,
    layoutId,
    layout: layoutId,
    grid,
    cropBoxes,
    crops: cropBoxes,
    cropOptions,
    confidence: 'high',
    reviewState: 'ready',
    reason: `Applied crop template from page ${sourcePage.pageNumber}.`,
    score: 1,
    overridden: true,
    origin: 'manual',
  };
}

export function applySavedLayoutTemplateToPageRange(
  pages: readonly PagePlan[],
  range: string,
  savedLayout: SavedLayoutTemplate,
): PagePlan[] {
  if (savedLayout.template.rects.length === 0) throw new RangeError('Saved crop layout has no crop boxes to apply.');
  const sourcePage = pages[savedLayout.sourcePageIndex];
  if (!sourcePage) {
    throw new RangeError(`Saved crop layout source page ${savedLayout.sourcePageIndex + 1} is outside 1-${pages.length}.`);
  }

  const indexes = [...parsePageRange(range, pages.length)].sort((a, b) => a - b);
  const updates = new Map<number, PagePlan>();
  for (const index of indexes) {
    const page = pages[index];
    if (!page) throw new RangeError(`Page index ${index} is outside the loaded PDF.`);
    updates.set(index, applySavedLayoutTemplateToPage(page, savedLayout, sourcePage.pageBox));
  }

  return pages.map((page, index) => updates.get(index) ?? page);
}

export function applySavedLayoutTemplateToPage(
  page: PagePlan,
  savedLayout: SavedLayoutTemplate,
  sourcePageBox: PageBox,
): PagePlan {
  if (savedLayout.template.rects.length === 0) throw new RangeError('Saved crop layout has no crop boxes to apply.');
  const template = scaleTemplateToPage(cloneCropTemplate(savedLayout.template), sourcePageBox, page.pageBox);
  const cropBoxes = materializeCropBoxesFromTemplate(page.pageIndex, page.pageBox, template);
  const layoutId = template.layoutId ?? layoutPresetForDimensions(template.columns, template.rows, page.layoutId);
  const cropOptions: CropOptions = { margin: {}, gutter: {} };
  const grid: GridSpec = {
    id: layoutId,
    label: template.label ?? LAYOUT_PRESETS[layoutId].label,
    columns: template.columns,
    rows: template.rows,
    readingOrder: template.readingOrder,
  };
  const { detection: _detection, ...pageWithoutDetection } = page;
  void _detection;
  return {
    ...pageWithoutDetection,
    layoutId,
    layout: layoutId,
    grid,
    cropBoxes,
    crops: cropBoxes,
    cropOptions,
    confidence: 'high',
    reviewState: 'ready',
    reason: `Applied saved crop layout "${savedLayout.name}".`,
    score: 1,
    overridden: true,
    origin: 'manual',
  };
}

function layoutPresetForDimensions(columns: number, rows: number, fallback: LayoutPresetId): LayoutPresetId {
  if (columns === 1 && rows === 1) return 'one-up';
  if (columns === 2 && rows === 1) return 'two-up-horizontal';
  if (columns === 1 && rows === 2) return 'two-up-vertical';
  if (columns === 2 && rows === 2) return 'two-by-two';
  if (columns === 2 && rows === 3) return 'two-by-three';
  if (columns === 3 && rows === 2) return 'three-by-two';
  return fallback;
}

export function applyPageRangeOverride(plans: readonly PagePlan[], override: PageRangeOverride): PagePlan[] {
  return plans.map((plan) => {
    if (plan.pageIndex < override.startPageIndex || plan.pageIndex > override.endPageIndex) return plan;
    return updatePageLayoutWithGrid(plan, override.layout, override.grid);
  });
}

export function applyCropBoxOverride(page: PagePlan, override: CropBoxOverride): PagePlan {
  const cropOptions: CropOptions = {
    margin: { ...page.cropOptions.margin, ...override.cropOptions?.margin },
    gutter: { ...page.cropOptions.gutter, ...override.cropOptions?.gutter },
  };
  const grid = gridWithCropOptions(page.grid, cropOptions);
  const cropBoxes = override.cropBoxes
    ? cloneCropBoxes(override.cropBoxes, page.pageBox, grid)
    : override.visualRects
      ? materializeCropBoxesFromTemplate(page.pageIndex, page.pageBox, templateFromVisualRects(grid, override.visualRects))
      : cropBoxesForGrid(page.pageIndex, page.boxes, grid);
  assertCropBoxesBounded(cropBoxes, effectivePageBox(page.boxes));
  const { detection: _detection, ...pageWithoutDetection } = page;
  void _detection;
  return {
    ...pageWithoutDetection,
    grid,
    cropBoxes,
    crops: cropBoxes,
    cropOptions,
    confidence: 'high',
    reviewState: 'ready',
    reason: override.reason ?? 'User adjusted crop boxes.',
    score: 1,
    overridden: true,
    origin: 'manual',
  };
}

export function applyOutputCropBoxesOverride(
  page: PagePlan,
  cropBoxes: readonly CropBox[],
  reason = 'User edited output slide pages.',
): PagePlan {
  const normalizedCropBoxes = cropBoxes.map((cropBox, index) => {
    const order = index + 1;
    return {
      ...cropBox,
      pageIndex: page.pageIndex,
      pageNumber: page.pageNumber,
      order,
      label: normalizeCropLabel(cropBox.label, cropBox.order, order),
      left: cropBox.x,
      bottom: cropBox.y,
    };
  });
  assertCropBoxesBounded(normalizedCropBoxes, effectivePageBox(page.boxes));
  const { detection: _detection, ...pageWithoutDetection } = page;
  void _detection;
  return {
    ...pageWithoutDetection,
    cropBoxes: normalizedCropBoxes,
    crops: normalizedCropBoxes,
    confidence: normalizedCropBoxes.length > 0 ? 'high' : 'review-needed',
    reviewState: normalizedCropBoxes.length > 0 ? 'ready' : 'review-needed',
    reason,
    score: normalizedCropBoxes.length > 0 ? 1 : 0,
    overridden: true,
    origin: 'manual',
  };
}

export function parsePageRange(input: string, pageCount: number): Set<number> {
  const indexes = new Set<number>();
  const parts = normalizePageRangeInput(input).split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new RangeError('Enter a page number or range.');

  for (const part of parts) {
    const exclude = part.startsWith('!') || /^-\s*\d/.test(part);
    const token = exclude ? part.replace(/^!|^-/, '').trim() : part;
    const [start, end] = parsePageRangeToken(token, pageCount);
    for (let page = start; page <= end; page += 1) {
      if (exclude) indexes.delete(page - 1);
      else indexes.add(page - 1);
    }
  }

  return indexes;
}

function normalizePageRangeInput(input: string): string {
  return input.replace(/\b(?:except|exclude|excluding|but not)\b/gi, ',!');
}

function parsePageRangeToken(token: string, pageCount: number): [number, number] {
  if (token === '*' || /^all$/i.test(token)) return [1, pageCount];
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
  if (!match) throw new RangeError(`Invalid page range: ${token}`);
  const first = Number(match[1]);
  const second = match[2] ? Number(match[2]) : first;
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  if (start < 1 || end > pageCount) throw new RangeError(`Page range ${token} is outside 1-${pageCount}.`);
  return [start, end];
}

export function previewRectToPdfBox(
  previewRect: PdfBox,
  previewSize: { width: number; height: number },
  pageBox: PageBox | PdfBox,
): PdfBox {
  const rotation = normalizeRotation((pageBox as PageBox).rotation ?? 0);
  const visualSize = visualPageSize(pageBox, rotation);
  const scaleX = visualSize.width / previewSize.width;
  const scaleY = visualSize.height / previewSize.height;
  return visualRectToPdfBox(
    {
      x: previewRect.x * scaleX,
      y: previewRect.y * scaleY,
      width: previewRect.width * scaleX,
      height: previewRect.height * scaleY,
    },
    { ...pageBox, rotation },
  );
}

export function visualRectToPdfBox(visualRect: PdfBox, pageBox: PageBox | PdfBox): PdfBox {
  const rotation = normalizeRotation((pageBox as PageBox).rotation ?? 0);
  const x = visualRect.x;
  const y = visualRect.y;
  const width = visualRect.width;
  const height = visualRect.height;
  // visualRect is measured in the same top-left, rotation-aware coordinate space
  // PDF.js uses for preview canvases. Export crops still need unrotated PDF
  // coordinates, so this is the inverse of PDF.js' page viewport transform.
  switch (rotation) {
    case 90:
      return roundBox({ x: pageBox.x + y, y: pageBox.y + x, width: height, height: width });
    case 180:
      return roundBox({ x: pageBox.x + pageBox.width - x - width, y: pageBox.y + y, width, height });
    case 270:
      return roundBox({ x: pageBox.x + pageBox.width - y - height, y: pageBox.y + pageBox.height - x - width, width: height, height: width });
    case 0:
    default:
      return roundBox({ x: pageBox.x + x, y: pageBox.y + pageBox.height - y - height, width, height });
  }
}

export function pdfBoxToVisualRect(pdfBox: PdfBox, pageBox: PageBox | PdfBox): PdfBox {
  const rotation = normalizeRotation((pageBox as PageBox).rotation ?? 0);
  const x = pdfBox.x;
  const y = pdfBox.y;
  const width = pdfBox.width;
  const height = pdfBox.height;
  // Inverse of visualRectToPdfBox: returned coordinates are measured in the
  // same top-left, rotation-aware visual page space that PDF.js canvases use.
  switch (rotation) {
    case 90:
      return roundBox({ x: y - pageBox.y, y: x - pageBox.x, width: height, height: width });
    case 180:
      return roundBox({ x: pageBox.x + pageBox.width - x - width, y: y - pageBox.y, width, height });
    case 270:
      return roundBox({ x: pageBox.y + pageBox.height - y - height, y: pageBox.x + pageBox.width - x - width, width: height, height: width });
    case 0:
    default:
      return roundBox({ x: x - pageBox.x, y: pageBox.y + pageBox.height - y - height, width, height });
  }
}

export function buildConversionPlan(sourceFileName: string, pages: readonly PagePlan[], sourceByteLength: number): ConversionPlan {
  const outputFileName = deriveOutputFileName(sourceFileName);
  const estimatedOutputPages = pages.reduce((sum, page) => sum + page.cropBoxes.length, 0);
  const warnings = createPlanWarnings(sourceByteLength, pages.length, estimatedOutputPages);
  return {
    sourceFileName,
    outputFileName,
    sourceByteLength,
    sourcePageCount: pages.length,
    estimatedOutputPages,
    pages: pages.map((page) => ({
      pageIndex: page.pageIndex,
      pageNumber: page.pageNumber,
      pageBox: page.pageBox,
      cropBoxes: page.cropBoxes,
    })),
    regions: pages.flatMap((page) => page.cropBoxes.map((cropBox) => ({ sourcePageIndex: page.pageIndex, cropBox, label: cropBox.label }))),
    warnings,
  };
}

export function assertCropBoxesBounded(crops: readonly (PdfBox | { left: number; bottom: number; width: number; height: number })[], pageBox: PdfBox): void {
  for (const [index, crop] of crops.entries()) {
    const rect = normalizeRect(crop);
    if (!isBoxInside(rect, pageBox)) {
      throw new RangeError(`Crop ${index + 1} is outside the effective source page box.`);
    }
  }
}

export function validateGridSpec(grid: GridSpec): void {
  if (!Number.isInteger(grid.columns) || grid.columns <= 0) throw new RangeError('grid.columns must be a positive integer');
  if (!Number.isInteger(grid.rows) || grid.rows <= 0) throw new RangeError('grid.rows must be a positive integer');
  const margin = normalizeInsets(grid.margin);
  const gutter = normalizeGutter(grid.gutter);
  for (const value of [...Object.values(margin), ...Object.values(gutter)]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('grid spacing must be a finite non-negative number');
  }
}

export function estimateWorkloadWarnings(sourceByteLength: number, sourcePageCount: number, estimatedOutputPages: number): string[] {
  return createPlanWarnings(sourceByteLength, sourcePageCount, estimatedOutputPages);
}

function createPlanWarnings(sourceByteLength: number, sourcePageCount: number, estimatedOutputPages: number): string[] {
  const warnings: string[] = [];
  if (sourceByteLength > 100 * 1024 * 1024) warnings.push('Large PDF: browser export memory use may be high, but the file stays local.');
  if (sourcePageCount > 200) warnings.push('This PDF has many source pages; conversion may take a while.');
  if (estimatedOutputPages > 1000) warnings.push('Estimated output is over 1000 pages; review in smaller batches if needed.');
  return warnings;
}

export function visualPageSize(pageBox: Pick<PdfBox, 'width' | 'height'>, rotation = 0): { width: number; height: number } {
  const normalizedRotation = normalizeRotation(rotation);
  return normalizedRotation === 90 || normalizedRotation === 270
    ? { width: pageBox.height, height: pageBox.width }
    : { width: pageBox.width, height: pageBox.height };
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

function roundBox(box: PdfBox): PdfBox {
  return {
    x: roundPoint(box.x),
    y: roundPoint(box.y),
    width: roundPoint(box.width),
    height: roundPoint(box.height),
  };
}

function normalizeRect(rect: PdfBox | { left: number; bottom: number; width: number; height: number }): PdfBox {
  if ('left' in rect) return { x: rect.left, y: rect.bottom, width: rect.width, height: rect.height };
  return rect;
}

function assertPositiveBox(box: PdfBox, label: string): void {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) {
    throw new RangeError(`${label} must have finite coordinates and positive size`);
  }
}

function isBoxInside(inner: PdfBox, outer: PdfBox): boolean {
  const epsilon = 0.001;
  return (
    inner.x + epsilon >= outer.x &&
    inner.y + epsilon >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

function roundPoint(value: number): number {
  return Number(value.toFixed(6));
}

function deriveOutputFileName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim() || 'split-slides';
  return `${base}-slides.pdf`;
}
