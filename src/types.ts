export type LayoutPresetId = 'one-up' | 'two-up-horizontal' | 'two-up-vertical' | 'two-by-two' | 'two-by-three' | 'three-by-two';
export type LayoutPreset = LayoutPresetId;
export type ReadingOrder = 'row-major' | 'column-major';
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'review-needed';
export type ReviewState = 'ready' | 'review-needed';
export type DetectionSource = 'projection-profile' | 'page-geometry' | 'analysis-failed' | 'manual';
export type DetectionOutcome = 'detected-grid' | 'one-up' | 'review-needed' | 'fallback';
export type CropProjectionSource = 'detected-grid' | 'none';
export type DetectionWarningCode =
  | 'geometry-fallback'
  | 'low-confidence'
  | 'mixed-content'
  | 'no-foreground'
  | 'off-center-grid'
  | 'unsupported-grid';

export interface DetectionWarning {
  code: DetectionWarningCode;
  message: string;
}

export interface PdfBox {
  /** Left edge in source PDF points. */
  x: number;
  /** Bottom edge in source PDF points. */
  y: number;
  /** Width in source PDF points. */
  width: number;
  /** Height in source PDF points. */
  height: number;
}

export interface VisualRect {
  /** Left edge in top-left, rotation-aware preview/page coordinates. */
  x: number;
  /** Top edge in top-left, rotation-aware preview/page coordinates. */
  y: number;
  /** Width in visual page units. */
  width: number;
  /** Height in visual page units. */
  height: number;
}

export interface PageBox extends PdfBox {
  rotation?: number;
}

export interface PageBoxes {
  mediaBox: PdfBox;
  cropBox?: PdfBox;
}

export interface SpacingInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GridGutter {
  x: number;
  y: number;
}

export interface GridSpec {
  id?: LayoutPresetId;
  label?: string;
  columns: number;
  rows: number;
  readingOrder?: ReadingOrder;
  margin?: Partial<SpacingInsets>;
  gutter?: Partial<GridGutter>;
}

export interface CropTemplateRect extends VisualRect {
  order: number;
  label: string;
  row: number;
  column: number;
}

export interface CropTemplate {
  layoutId?: LayoutPresetId;
  label?: string;
  columns: number;
  rows: number;
  readingOrder: ReadingOrder;
  rects: CropTemplateRect[];
}

export interface SavedLayoutTemplate {
  id: string;
  name: string;
  template: CropTemplate;
  /** Zero-based page index used to resolve the source page inside the current PDF session. */
  sourcePageIndex: number;
  /** Human-facing trace label only; do not use as a lookup key. */
  sourcePageNumber: number;
}

export interface CropBox extends PdfBox {
  /** Alias used by the export module/pdf-lib. */
  left: number;
  /** Alias used by the export module/pdf-lib. */
  bottom: number;
  pageIndex: number;
  pageNumber: number;
  order: number;
  label: string;
  row: number;
  column: number;
}

export interface AnalysisRenderMetadata {
  pixelWidth: number;
  pixelHeight: number;
  visualWidth: number;
  visualHeight: number;
  scaleX: number;
  scaleY: number;
  pageNumber?: number;
  maxWidth?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  devicePixelRatio?: number;
}

export interface DetectionAxisRun {
  /** Inclusive analysis-pixel start along the projected axis. */
  start: number;
  /** Exclusive analysis-pixel end along the projected axis. */
  end: number;
  center: number;
  meanDensity: number;
  peakDensity: number;
}

export interface DetectedCropRect extends VisualRect {
  order: number;
  label: string;
  row: number;
  column: number;
  /** Rectangle in the rendered analysis bitmap that produced this visual crop. */
  analysisRect: PdfBox;
}

export interface DetectionMetadata {
  source: DetectionSource;
  outcome: DetectionOutcome;
  layoutId: LayoutPresetId;
  confidence: ConfidenceLevel;
  score: number;
  columns: number;
  rows: number;
  warnings: DetectionWarning[];
  /** Compatibility label for old UI/plan code; never used to regenerate detected crops. */
  cropProjection?: CropProjectionSource;
  /** Compatibility alias for render metadata. */
  analysis?: AnalysisRenderMetadata;
  render?: AnalysisRenderMetadata;
  /** Foreground bounds in analysis-pixel coordinates. */
  analysisContentRect?: PdfBox;
  /** Foreground bounds mapped to visual page coordinates. */
  visualContentRect?: PdfBox;
  xRuns?: DetectionAxisRun[];
  yRuns?: DetectionAxisRun[];
  /** Crop rectangles in visual page coordinates; downstream code maps these to PDF crop boxes. */
  cropRects: DetectedCropRect[];
}

export interface CropOptions {
  margin: Partial<SpacingInsets>;
  gutter: Partial<GridGutter>;
}

export interface CropBoxOverride {
  cropBoxes?: readonly CropBox[];
  visualRects?: readonly CropTemplateRect[];
  cropOptions?: Partial<CropOptions>;
  reason?: string;
}

export interface PagePlan {
  pageIndex: number;
  pageNumber: number;
  layoutId: LayoutPresetId;
  /** Back-compat alias for worker-2 geometry helpers. */
  layout: LayoutPresetId;
  grid: GridSpec;
  pageBox: PageBox;
  boxes: PageBoxes;
  /** Authoritative crop geometry for preview overlays and export conversion. */
  cropBoxes: CropBox[];
  /** Back-compat alias for worker-2 geometry helpers. */
  crops: CropBox[];
  confidence: ConfidenceLevel;
  reviewState: ReviewState;
  reason: string;
  score: number;
  overridden: boolean;
  origin?: 'manual' | 'detected';
  cropOptions: CropOptions;
  detection?: DetectionMetadata;
}

export interface PageRangeOverride {
  startPageIndex: number;
  endPageIndex: number;
  layout: LayoutPresetId;
  grid?: Partial<GridSpec>;
}

export interface ConversionPagePlan {
  pageIndex: number;
  pageNumber: number;
  pageBox: PageBox;
  cropBoxes: CropBox[];
}

export interface ConversionRegion {
  sourcePageIndex: number;
  cropBox: PdfBox | { left: number; bottom: number; width: number; height: number };
  label?: string;
}

export interface ConversionPlan {
  sourceFileName: string;
  outputFileName: string;
  sourceByteLength: number;
  sourcePageCount: number;
  estimatedOutputPages: number;
  pages: ConversionPagePlan[];
  regions: ConversionRegion[];
  warnings: string[];
}

export interface ExportResult {
  bytes: Uint8Array;
  outputFileName: string;
  outputPageCount: number;
  sourceHashBefore: string;
  sourceHashAfter: string;
}

export interface WorkloadWarning {
  code: 'large-file' | 'many-source-pages' | 'many-output-pages' | 'large-source-file';
  message: string;
}

export interface LoadedPdfSummary {
  fileName: string;
  fileSize: number;
  sourceHash: string;
  outputFileName: string;
  loadedAt: string;
  warnings: readonly WorkloadWarning[];
}

export interface FixturePageDefinition {
  pageIndex: number;
  label: string;
  boxes: PageBoxes;
  layout: LayoutPresetId;
}

export interface SyntheticPdfFixtureDefinition {
  name: string;
  pages: FixturePageDefinition[];
  expectedOutputPages: number;
}
