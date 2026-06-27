import type {
  ConfidenceLevel,
  DetectedCropRect,
  DetectionAxisRun,
  DetectionMetadata,
  DetectionWarning,
  LayoutPresetId,
  PageBox,
  PdfBox,
} from '../types';

export interface ProjectionLayoutDetection extends DetectionMetadata {
  reason: string;
}

interface ProjectionProfile {
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array;
}

interface RunDetectionOptions {
  minDensity?: number;
  minRunRatio?: number;
  maxGapRatio?: number;
}

const FOREGROUND_RGB_SUM_THRESHOLD = 735;
const FRAME_RGB_SUM_THRESHOLD = 420;
const MAX_FRAME_LINE_CANDIDATES = 80;
const MAX_FRAME_INTERVAL_CANDIDATES = 4_096;

export function detectProjectionLayout(imageData: ImageData, pageBox: PageBox): ProjectionLayoutDetection {
  const profile = createProjectionProfile(imageData);
  const render = createRenderMetadata(imageData, pageBox);
  const xRuns = findAxisRuns(projectAxis(profile, 'x'), profile.width);
  const yRuns = findAxisRuns(projectAxis(profile, 'y'), profile.height);
  const warnings: DetectionWarning[] = [];

  const framedGrid = detectFramedGrid(imageData);
  if (framedGrid) {
    const contentRect = analysisContentRect(framedGrid.xRuns, framedGrid.yRuns);
    const offCenter = isOffCenter(contentRect, imageData);
    if (offCenter) {
      warnings.push({
        code: 'off-center-grid',
        message: 'Detected crop rectangles follow the foreground grid bounds instead of the full page, avoiding a blank outer margin.',
      });
    }
    const layoutId = layoutFromProjection(framedGrid.columns, framedGrid.rows);
    return detection({
      layoutId,
      confidence: 'high',
      score: offCenter ? 0.88 : 0.94,
      columns: framedGrid.columns,
      rows: framedGrid.rows,
      warnings,
      render,
      xRuns: framedGrid.xRuns,
      yRuns: framedGrid.yRuns,
      cropRects: createCropRects(framedGrid.xRuns, framedGrid.yRuns, imageData, pageBox),
      outcome: framedGrid.columns === 1 && framedGrid.rows === 1 ? 'one-up' : 'detected-grid',
      reason: `Projection profile detected ${framedGrid.columns} column(s) by ${framedGrid.rows} row(s) slide frame grid.`,
      analysisContentRect: contentRect,
      visualContentRect: analysisRectToVisualRect(contentRect, imageData, pageBox),
    });
  }

  if (xRuns.length === 0 || yRuns.length === 0) {
    warnings.push({ code: 'no-foreground', message: 'No reliable foreground regions were found in the analysis render.' });
    return detection({
      layoutId: 'one-up',
      confidence: 'review-needed',
      score: 0.25,
      columns: 1,
      rows: 1,
      warnings,
      render,
      xRuns,
      yRuns,
      cropRects: [],
      outcome: 'review-needed',
      reason: 'Projection profile found no reliable foreground; review this page manually.',
    });
  }

  const columns = xRuns.length;
  const rows = yRuns.length;
  const rowColumnCounts = yRuns.map((run) => findAxisRuns(projectAxis(profile, 'x', { y: run }), profile.width).length);
  const columnRowCounts = xRuns.map((run) => findAxisRuns(projectAxis(profile, 'y', { x: run }), profile.height).length);
  const mixedContent = rowColumnCounts.some((count) => count !== columns) || columnRowCounts.some((count) => count !== rows);
  const contentRect = analysisContentRect(xRuns, yRuns);
  const cropRects = createCropRects(xRuns, yRuns, imageData, pageBox);
  const offCenter = isOffCenter(contentRect, imageData);
  const layoutId = layoutFromProjection(columns, rows);

  if (offCenter) {
    warnings.push({
      code: 'off-center-grid',
      message: 'Detected crop rectangles follow the foreground grid bounds instead of the full page, avoiding a blank outer margin.',
    });
  }

  if (mixedContent) {
    if (shouldTreatMixedContentAsOneUp(xRuns, yRuns, imageData)) {
      const oneUpXRuns = [fullAxisRun(imageData.width)];
      const oneUpYRuns = [fullAxisRun(imageData.height)];
      const fullPageAnalysisRect = fullImageRect(imageData);
      return detection({
        layoutId: 'one-up',
        confidence: 'medium',
        score: 0.66,
        columns: 1,
        rows: 1,
        warnings,
        render,
        xRuns: oneUpXRuns,
        yRuns: oneUpYRuns,
        cropRects: createCropRects(oneUpXRuns, oneUpYRuns, imageData, pageBox),
        outcome: 'one-up',
        reason: 'Projection profile found one broad page-wide content region with internal bands; treating this page as 1-up.',
        analysisContentRect: fullPageAnalysisRect,
        visualContentRect: analysisRectToVisualRect(fullPageAnalysisRect, imageData, pageBox),
      });
    }
    warnings.push({
      code: 'mixed-content',
      message: 'Projection rows or columns are inconsistent, which often indicates a header, footer, or mixed content outside the grid.',
    });
    return detection({
      layoutId,
      confidence: 'review-needed',
      score: 0.48,
      columns,
      rows,
      warnings,
      render,
      xRuns,
      yRuns,
      cropRects,
      outcome: 'review-needed',
      reason: `Projection profile found mixed ${columns} column by ${rows} row content; review before export.`,
      analysisContentRect: contentRect,
      visualContentRect: analysisRectToVisualRect(contentRect, imageData, pageBox),
    });
  }

  if (!isSupportedGrid(columns, rows)) {
    warnings.push({
      code: 'unsupported-grid',
      message: `Detected ${columns} column(s) by ${rows} row(s), which is not a supported automatic split profile.`,
    });
    return detection({
      layoutId,
      confidence: 'review-needed',
      score: 0.46,
      columns,
      rows,
      warnings,
      render,
      xRuns,
      yRuns,
      cropRects,
      outcome: 'review-needed',
      reason: `Projection profile found unsupported ${columns} column by ${rows} row content; review this page manually.`,
      analysisContentRect: contentRect,
      visualContentRect: analysisRectToVisualRect(contentRect, imageData, pageBox),
    });
  }

  const outcome = columns === 1 && rows === 1 ? 'one-up' : 'detected-grid';
  const baseScore = outcome === 'one-up' ? 0.69 : 0.86;
  const score = clampScore(baseScore - (offCenter ? 0.04 : 0));
  const confidence = confidenceFromScore(score);
  return detection({
    layoutId,
    confidence,
    score,
    columns,
    rows,
    warnings,
    render,
    xRuns,
    yRuns,
    cropRects,
    outcome,
    reason:
      outcome === 'one-up'
        ? 'Projection profile found one foreground region; treating this page as 1-up.'
        : `Projection profile detected ${columns} column(s) by ${rows} row(s) crop regions.`,
    analysisContentRect: contentRect,
    visualContentRect: analysisRectToVisualRect(contentRect, imageData, pageBox),
  });
}

export function geometryFallbackDetection(pageBox: PageBox, layoutId: LayoutPresetId, confidence: ConfidenceLevel, reason: string, score: number): ProjectionLayoutDetection {
  const warnings: DetectionWarning[] = [{ code: 'geometry-fallback', message: reason }];
  return detection({
    source: 'page-geometry',
    outcome: 'fallback',
    layoutId,
    confidence,
    score,
    columns: layoutId === 'two-up-horizontal' ? 2 : 1,
    rows: layoutId === 'two-up-vertical' ? 2 : 1,
    warnings,
    cropRects: [],
    reason,
  });
}

function detection(input: Omit<ProjectionLayoutDetection, 'source'> & { source?: ProjectionLayoutDetection['source'] }): ProjectionLayoutDetection {
  const result: ProjectionLayoutDetection = {
    source: input.source ?? 'projection-profile',
    outcome: input.outcome,
    layoutId: input.layoutId,
    confidence: input.confidence,
    score: input.score,
    columns: input.columns,
    rows: input.rows,
    warnings: input.warnings,
    cropProjection: input.cropRects.length > 0 ? 'detected-grid' : 'none',
    cropRects: input.cropRects,
    reason: input.reason,
  };
  if (input.render) result.render = input.render;
  if (input.analysisContentRect) result.analysisContentRect = input.analysisContentRect;
  if (input.visualContentRect) result.visualContentRect = input.visualContentRect;
  if (input.xRuns) result.xRuns = input.xRuns;
  if (input.yRuns) result.yRuns = input.yRuns;
  return result;
}

interface FrameGridDetection {
  columns: number;
  rows: number;
  xRuns: DetectionAxisRun[];
  yRuns: DetectionAxisRun[];
}

interface BoundaryInterval {
  start: number;
  end: number;
  size: number;
}

function detectFramedGrid(imageData: ImageData): FrameGridDetection | undefined {
  const verticalLines = findLongStraightLines(imageData, 'x');
  const horizontalLines = findLongStraightLines(imageData, 'y');
  const xIntervals = selectRepeatedIntervals(verticalLines, imageData.width, [1, 2, 3]);
  const yIntervals = selectRepeatedIntervals(horizontalLines, imageData.height, [1, 2, 3]);
  if (xIntervals.length === 0 || yIntervals.length === 0) return undefined;
  if (xIntervals.length === 1 && yIntervals.length === 1) return undefined;
  if (!isSupportedGrid(xIntervals.length, yIntervals.length)) return undefined;

  return {
    columns: xIntervals.length,
    rows: yIntervals.length,
    xRuns: intervalsToRuns(xIntervals),
    yRuns: intervalsToRuns(yIntervals),
  };
}

function findLongStraightLines(imageData: ImageData, axis: 'x' | 'y'): number[] {
  const { width, height, data } = imageData;
  const length = axis === 'x' ? width : height;
  const cross = axis === 'x' ? height : width;
  const minLineLength = Math.max(48, Math.floor(cross * (axis === 'x' ? 0.08 : 0.16)));
  const candidates: number[] = [];

  for (let index = 0; index < length; index += 1) {
    let run = 0;
    let longest = 0;
    for (let crossIndex = 0; crossIndex < cross; crossIndex += 1) {
      const x = axis === 'x' ? index : crossIndex;
      const y = axis === 'x' ? crossIndex : index;
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] ?? 255;
      const red = data[offset] ?? 255;
      const green = data[offset + 1] ?? 255;
      const blue = data[offset + 2] ?? 255;
      if (alpha > 0 && red + green + blue < FRAME_RGB_SUM_THRESHOLD) {
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
    if (longest >= minLineLength) candidates.push(index);
  }

  return compactLineCandidates(candidates);
}

function compactLineCandidates(candidates: readonly number[]): number[] {
  const groups = groupConsecutive(candidates);
  return groups.map((group) => Math.round((group.start + group.end) / 2));
}

function selectRepeatedIntervals(lines: readonly number[], axisLength: number, allowedCounts: readonly number[]): BoundaryInterval[] {
  if (lines.length > MAX_FRAME_LINE_CANDIDATES) return [];
  const intervals: BoundaryInterval[] = [];
  const minSize = axisLength * 0.12;
  const maxSize = axisLength * 0.72;
  for (let startIndex = 0; startIndex < lines.length - 1; startIndex += 1) {
    for (let endIndex = startIndex + 1; endIndex < lines.length; endIndex += 1) {
      const start = lines[startIndex]!;
      const end = lines[endIndex]!;
      const size = end - start;
      if (size >= minSize && size <= maxSize) intervals.push({ start, end, size });
      if (intervals.length > MAX_FRAME_INTERVAL_CANDIDATES) return [];
    }
  }

  let best: BoundaryInterval[] = [];
  for (const seed of intervals) {
    const similar = intervals
      .filter((interval) => hasSimilarSizes(interval.size, seed.size))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    for (const count of allowedCounts) {
      const group = chooseNonOverlappingIntervals(similar, count);
      if (group.length === count && intervalGroupScore(group) > intervalGroupScore(best)) {
        best = group;
      }
    }
  }
  return best;
}

function chooseNonOverlappingIntervals(intervals: readonly BoundaryInterval[], count: number): BoundaryInterval[] {
  const group: BoundaryInterval[] = [];
  for (const interval of intervals) {
    const previous = group[group.length - 1];
    if (previous && interval.start <= previous.end) continue;
    group.push(interval);
    if (group.length === count) return group;
  }
  return [];
}

function hasSimilarSizes(a: number, b: number): boolean {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return max / Math.max(1, min) <= 1.28;
}

function intervalGroupScore(intervals: readonly BoundaryInterval[]): number {
  if (intervals.length === 0) return 0;
  const coverage = intervals.reduce((sum, interval) => sum + interval.size, 0);
  const gaps = intervals.slice(1).reduce((sum, interval, index) => sum + Math.max(0, interval.start - intervals[index]!.end), 0);
  return intervals.length * 10_000 + coverage - gaps * 0.15;
}

function intervalsToRuns(intervals: readonly BoundaryInterval[]): DetectionAxisRun[] {
  return intervals.map((interval) => ({
    start: interval.start,
    end: interval.end,
    center: interval.start + interval.size / 2,
    meanDensity: 1,
    peakDensity: 1,
  }));
}

function groupConsecutive(values: readonly number[]): Array<{ start: number; end: number }> {
  const groups: Array<{ start: number; end: number }> = [];
  if (values.length === 0) return groups;
  let start = values[0]!;
  let previous = values[0]!;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    if (value <= previous + 1) {
      previous = value;
      continue;
    }
    groups.push({ start, end: previous });
    start = value;
    previous = value;
  }
  groups.push({ start, end: previous });
  return groups;
}

function createProjectionProfile(imageData: ImageData): ProjectionProfile {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  for (let offset = 0, pixel = 0; offset < data.length; offset += 4, pixel += 1) {
    const alpha = data[offset + 3] ?? 255;
    const red = data[offset] ?? 255;
    const green = data[offset + 1] ?? 255;
    const blue = data[offset + 2] ?? 255;
    mask[pixel] = alpha > 0 && red + green + blue < FOREGROUND_RGB_SUM_THRESHOLD ? 1 : 0;
  }
  return { width, height, mask };
}

function projectAxis(profile: ProjectionProfile, axis: 'x' | 'y', band: Partial<Record<'x' | 'y', DetectionAxisRun>> = {}): number[] {
  const xStart = Math.max(0, Math.floor(band.x?.start ?? 0));
  const xEnd = Math.min(profile.width, Math.ceil(band.x?.end ?? profile.width));
  const yStart = Math.max(0, Math.floor(band.y?.start ?? 0));
  const yEnd = Math.min(profile.height, Math.ceil(band.y?.end ?? profile.height));
  const length = axis === 'x' ? profile.width : profile.height;
  const crossLength = Math.max(1, axis === 'x' ? yEnd - yStart : xEnd - xStart);
  const projection = new Array<number>(length).fill(0);

  if (axis === 'x') {
    for (let x = 0; x < profile.width; x += 1) {
      if (x < xStart || x >= xEnd) continue;
      let ink = 0;
      for (let y = yStart; y < yEnd; y += 1) ink += profile.mask[y * profile.width + x] ?? 0;
      projection[x] = ink / crossLength;
    }
  } else {
    for (let y = 0; y < profile.height; y += 1) {
      if (y < yStart || y >= yEnd) continue;
      let ink = 0;
      for (let x = xStart; x < xEnd; x += 1) ink += profile.mask[y * profile.width + x] ?? 0;
      projection[y] = ink / crossLength;
    }
  }

  return projection;
}

function findAxisRuns(projection: readonly number[], length: number, options: RunDetectionOptions = {}): DetectionAxisRun[] {
  const peak = Math.max(0, ...projection);
  if (peak <= 0) return [];
  const threshold = Math.max(options.minDensity ?? 0.015, Math.min(0.12, peak * 0.22));
  const minRun = Math.max(3, Math.floor(length * (options.minRunRatio ?? 0.025)));
  const maxGap = Math.max(1, Math.floor(length * (options.maxGapRatio ?? 0.006)));
  const runs: DetectionAxisRun[] = [];
  let start = -1;
  let gap = 0;

  for (let index = 0; index <= projection.length; index += 1) {
    const active = index < projection.length && (projection[index] ?? 0) >= threshold;
    if (active) {
      if (start < 0) start = index;
      gap = 0;
      continue;
    }
    if (start >= 0 && gap < maxGap && index < projection.length) {
      gap += 1;
      continue;
    }
    if (start >= 0) {
      const end = Math.max(start, index - gap);
      if (end - start >= minRun) runs.push(createAxisRun(projection, start, end));
      start = -1;
      gap = 0;
    }
  }

  return runs;
}

function createAxisRun(projection: readonly number[], start: number, end: number): DetectionAxisRun {
  const values = projection.slice(start, end);
  const meanDensity = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const peakDensity = Math.max(0, ...values);
  return { start, end, center: start + (end - start) / 2, meanDensity, peakDensity };
}

function fullAxisRun(length: number): DetectionAxisRun {
  return { start: 0, end: length, center: length / 2, meanDensity: 1, peakDensity: 1 };
}

function fullImageRect(imageData: ImageData): PdfBox {
  return { x: 0, y: 0, width: imageData.width, height: imageData.height };
}

function shouldTreatMixedContentAsOneUp(xRuns: readonly DetectionAxisRun[], yRuns: readonly DetectionAxisRun[], imageData: ImageData): boolean {
  if (xRuns.length !== 1 || yRuns.length < 3) return false;
  const xRun = xRuns[0]!;
  const xCoverage = (xRun.end - xRun.start) / Math.max(1, imageData.width);
  return xCoverage >= 0.72;
}

function createCropRects(xRuns: readonly DetectionAxisRun[], yRuns: readonly DetectionAxisRun[], imageData: ImageData, pageBox: PageBox): DetectedCropRect[] {
  const crops: DetectedCropRect[] = [];
  for (let row = 0; row < yRuns.length; row += 1) {
    for (let column = 0; column < xRuns.length; column += 1) {
      const xRun = xRuns[column]!;
      const yRun = yRuns[row]!;
      const analysisRect = {
        x: xRun.start,
        y: yRun.start,
        width: xRun.end - xRun.start,
        height: yRun.end - yRun.start,
      };
      const visualRect = analysisRectToVisualRect(analysisRect, imageData, pageBox);
      const order = crops.length + 1;
      crops.push({ ...visualRect, analysisRect, order, label: String(order), row, column });
    }
  }
  return crops;
}

function analysisContentRect(xRuns: readonly DetectionAxisRun[], yRuns: readonly DetectionAxisRun[]): PdfBox {
  const firstX = xRuns[0]!;
  const lastX = xRuns[xRuns.length - 1]!;
  const firstY = yRuns[0]!;
  const lastY = yRuns[yRuns.length - 1]!;
  return { x: firstX.start, y: firstY.start, width: lastX.end - firstX.start, height: lastY.end - firstY.start };
}

function analysisRectToVisualRect(rect: PdfBox, imageData: ImageData, pageBox: PageBox): PdfBox {
  const visualSize = visualPageSize(pageBox);
  const scaleX = visualSize.width / Math.max(1, imageData.width);
  const scaleY = visualSize.height / Math.max(1, imageData.height);
  return roundBox({ x: rect.x * scaleX, y: rect.y * scaleY, width: rect.width * scaleX, height: rect.height * scaleY });
}

function createRenderMetadata(imageData: ImageData, pageBox: PageBox) {
  const visualSize = visualPageSize(pageBox);
  return {
    pixelWidth: imageData.width,
    pixelHeight: imageData.height,
    visualWidth: visualSize.width,
    visualHeight: visualSize.height,
    scaleX: visualSize.width / Math.max(1, imageData.width),
    scaleY: visualSize.height / Math.max(1, imageData.height),
  };
}

function layoutFromProjection(columns: number, rows: number): LayoutPresetId {
  if (columns === 2 && rows === 3) return 'two-by-three';
  if (columns === 3 && rows === 2) return 'three-by-two';
  if (columns === 2 && rows === 2) return 'two-by-two';
  if (columns >= 2 && rows === 1) return 'two-up-horizontal';
  if (columns === 1 && rows >= 2) return 'two-up-vertical';
  return 'one-up';
}

function isSupportedGrid(columns: number, rows: number): boolean {
  return (
    (columns === 1 && rows === 1) ||
    (columns === 2 && rows === 1) ||
    (columns === 1 && rows === 2) ||
    (columns === 2 && rows === 2) ||
    (columns === 2 && rows === 3) ||
    (columns === 3 && rows === 2)
  );
}

function isOffCenter(rect: PdfBox, imageData: ImageData): boolean {
  const leftMargin = rect.x;
  const rightMargin = imageData.width - rect.x - rect.width;
  const topMargin = rect.y;
  const bottomMargin = imageData.height - rect.y - rect.height;
  const horizontalDelta = Math.abs(leftMargin - rightMargin);
  const verticalDelta = Math.abs(topMargin - bottomMargin);
  return horizontalDelta > imageData.width * 0.08 || verticalDelta > imageData.height * 0.08;
}

function confidenceFromScore(score: number): ConfidenceLevel {
  if (score >= 0.76) return 'high';
  if (score >= 0.58) return 'medium';
  return 'low';
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function visualPageSize(pageBox: PageBox): { width: number; height: number } {
  const rotation = normalizeRotation(pageBox.rotation ?? 0);
  return rotation === 90 || rotation === 270
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

function roundPoint(value: number): number {
  return Number(value.toFixed(6));
}
