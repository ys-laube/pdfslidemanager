import { describe, expect, it } from 'vitest';
import { suggestLayoutFromImage, suggestLayoutFromPageBox } from '../../src/pdf/layout-detect';
import type { PageBox } from '../../src/types';

const PAGE_BOX: PageBox = { x: 0, y: 0, width: 600, height: 900 };

describe('synthetic projection layout detection', () => {
  it('detects a clean 2x2 projection grid', () => {
    const suggestion = suggestLayoutFromImage(
      syntheticPageImage({
        width: 240,
        height: 240,
        blocks: [
          { x: 16, y: 16, width: 86, height: 86 },
          { x: 138, y: 16, width: 86, height: 86 },
          { x: 16, y: 138, width: 86, height: 86 },
          { x: 138, y: 138, width: 86, height: 86 },
        ],
      }),
      PAGE_BOX,
    );

    expect(suggestion.layoutId).toBe('two-by-two');
    expect(suggestion.confidence).toBe('high');
  });

  it('detects repeated slide frames as a 2x3 grid even when slide interiors contain text-like ink', () => {
    const suggestion = suggestLayoutFromImage(
      syntheticFramedGridImage({
        width: 300,
        height: 420,
        columns: 2,
        rows: 3,
        left: 24,
        top: 34,
        cellWidth: 104,
        cellHeight: 82,
        gapX: 16,
        gapY: 18,
      }),
      PAGE_BOX,
    );

    expect(suggestion.layoutId).toBe('two-by-three');
    expect(suggestion.grid).toMatchObject({ columns: 2, rows: 3 });
    expect(suggestion.visualCropRects).toHaveLength(6);
    expect(suggestion.reviewState).toBe('ready');
  });

  it('keeps a 3x2 projection grid distinct from 2x3', () => {
    const suggestion = suggestLayoutFromImage(
      syntheticFramedGridImage({
        width: 420,
        height: 300,
        columns: 3,
        rows: 2,
        left: 34,
        top: 24,
        cellWidth: 82,
        cellHeight: 104,
        gapX: 18,
        gapY: 16,
      }),
      { x: 0, y: 0, width: 900, height: 600 },
    );

    expect(suggestion.layoutId).toBe('three-by-two');
    expect(suggestion.grid).toMatchObject({ columns: 3, rows: 2 });
    expect(suggestion.visualCropRects).toHaveLength(6);
    expect(suggestion.reviewState).toBe('ready');
  });

  it('treats a broad page-wide one-up cover with internal bands as a ready one-up page', () => {
    const suggestion = suggestLayoutFromImage(
      syntheticPageImage({
        width: 240,
        height: 320,
        blocks: [
          { x: 0, y: 0, width: 240, height: 44 },
          { x: 44, y: 112, width: 54, height: 26 },
          { x: 140, y: 112, width: 58, height: 26 },
          { x: 0, y: 252, width: 240, height: 48 },
        ],
      }),
      { x: 0, y: 0, width: 600, height: 800 },
    );

    expect(suggestion).toMatchObject({ layoutId: 'one-up', confidence: 'medium', reviewState: 'ready' });
    expect(suggestion.visualCropRects).toHaveLength(1);
  });

  it('does not false-positive six-up on a one-up slide', () => {
    const suggestion = suggestLayoutFromImage(
      syntheticPageImage({
        width: 240,
        height: 180,
        blocks: [{ x: 30, y: 28, width: 180, height: 124 }],
      }),
      { x: 0, y: 0, width: 960, height: 720 },
    );

    expect(suggestion.layoutId).toBe('one-up');
    expect(suggestion.score).toBeLessThan(0.7);
  });

  it('keeps ambiguous analysis results in review-needed confidence territory', () => {
    const suggestion = suggestLayoutFromPageBox({ x: 0, y: 0, width: 600, height: 600 });

    expect(suggestion.layoutId).toBe('one-up');
    expect(suggestion.confidence).toBe('low');
    expect(suggestion.reason).toMatch(/review/i);
  });

  it('marks geometry-only fallback suggestions review-needed because they have no detected crop rectangles', () => {
    const suggestion = suggestLayoutFromPageBox({ x: 0, y: 0, width: 1000, height: 400 });

    expect(suggestion.layoutId).toBe('two-up-horizontal');
    expect(suggestion.confidence).toBe('medium');
    expect(suggestion.reviewState).toBe('review-needed');
    expect(suggestion.visualCropRects).toEqual([]);
  });
});

interface SyntheticImageInput {
  width: number;
  height: number;
  blocks: Array<{ x: number; y: number; width: number; height: number }>;
}

function syntheticPageImage({ width, height, blocks }: SyntheticImageInput): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  }
  for (const block of blocks) {
    for (let y = block.y; y < block.y + block.height; y += 1) {
      for (let x = block.x; x < block.x + block.width; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 24;
        data[offset + 1] = 24;
        data[offset + 2] = 24;
      }
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

interface SyntheticFramedGridInput {
  width: number;
  height: number;
  columns: number;
  rows: number;
  left: number;
  top: number;
  cellWidth: number;
  cellHeight: number;
  gapX: number;
  gapY: number;
}

function syntheticFramedGridImage(input: SyntheticFramedGridInput): ImageData {
  const data = new Uint8ClampedArray(input.width * input.height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  }

  const setDark = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= input.width || y >= input.height) return;
    const offset = (y * input.width + x) * 4;
    data[offset] = 20;
    data[offset + 1] = 20;
    data[offset + 2] = 20;
  };

  for (let row = 0; row < input.rows; row += 1) {
    for (let column = 0; column < input.columns; column += 1) {
      const x = input.left + column * (input.cellWidth + input.gapX);
      const y = input.top + row * (input.cellHeight + input.gapY);
      for (let dx = 0; dx <= input.cellWidth; dx += 1) {
        setDark(x + dx, y);
        setDark(x + dx, y + input.cellHeight);
      }
      for (let dy = 0; dy <= input.cellHeight; dy += 1) {
        setDark(x, y + dy);
        setDark(x + input.cellWidth, y + dy);
      }
      for (let line = 0; line < 4; line += 1) {
        const textY = y + 14 + line * 12;
        for (let dx = 12; dx < input.cellWidth - 12; dx += 2) setDark(x + dx, textY);
      }
    }
  }
  return { width: input.width, height: input.height, data, colorSpace: 'srgb' } as ImageData;
}
