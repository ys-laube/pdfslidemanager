import type { ConfidenceLevel, DetectedCropRect, DetectionMetadata, GridSpec, LayoutPresetId, PageBox, ReviewState } from '../types';
import { LAYOUT_PRESETS } from './grid';
import { detectProjectionLayout, geometryFallbackDetection } from './projection-detect';

export interface LayoutSuggestion {
  layoutId: LayoutPresetId;
  grid?: GridSpec;
  confidence: ConfidenceLevel;
  reviewState?: ReviewState;
  reason: string;
  score: number;
  detection: DetectionMetadata;
  visualCropRects: DetectedCropRect[];
}

export const GRID_PRESETS = LAYOUT_PRESETS;

export function suggestLayoutFromPageBox(pageBox: PageBox): LayoutSuggestion {
  const aspect = pageBox.width / Math.max(1, pageBox.height);
  if (aspect > 1.8) return suggestionFromDetection(geometryFallbackDetection(pageBox, 'two-up-horizontal', 'medium', 'Wide page suggests two landscape slides side by side.', 0.62));
  if (aspect < 0.72) return suggestionFromDetection(geometryFallbackDetection(pageBox, 'two-up-vertical', 'medium', 'Tall page suggests two stacked slides.', 0.6));
  return suggestionFromDetection(geometryFallbackDetection(pageBox, 'one-up', 'low', 'No reliable separators detected; review this page manually.', 0.45));
}

export function suggestLayoutFromImage(imageData: ImageData, pageBox: PageBox): LayoutSuggestion {
  return suggestionFromDetection(detectProjectionLayout(imageData, pageBox));
}

export function suggestLayout(input: { width: number; height: number; bitmapSignals?: unknown }): LayoutSuggestion {
  return suggestLayoutFromPageBox({ x: 0, y: 0, width: input.width, height: input.height });
}

function suggestionFromDetection(detection: DetectionMetadata & { reason: string }): LayoutSuggestion {
  const reviewState: ReviewState =
    detection.cropRects.length === 0 ||
    detection.outcome === 'review-needed' ||
    detection.confidence === 'low' ||
    detection.confidence === 'review-needed'
      ? 'review-needed'
      : 'ready';
  return {
    layoutId: detection.layoutId,
    ...(detection.cropRects.length > 0 ? { grid: gridFromDetection(detection) } : {}),
    confidence: detection.confidence,
    reviewState,
    reason: detection.reason,
    score: detection.score,
    detection,
    visualCropRects: detection.cropRects,
  };
}

function gridFromDetection(detection: DetectionMetadata): GridSpec {
  const preset = LAYOUT_PRESETS[detection.layoutId];
  return {
    id: detection.layoutId,
    label:
      detection.outcome === 'detected-grid'
        ? `Detected ${detection.columns}×${detection.rows} slide grid`
        : preset.label,
    columns: detection.columns,
    rows: detection.rows,
    readingOrder: 'row-major',
  };
}
