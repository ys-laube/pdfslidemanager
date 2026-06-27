import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { degrees, PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { LAYOUT_PRESETS } from '../../src/pdf/grid';
import type { LayoutPresetId } from '../../src/types';

export interface FixturePageSpec {
  layoutId: LayoutPresetId;
  width?: number;
  height?: number;
  cropBox?: { x: number; y: number; width: number; height: number };
  rotation?: 0 | 90 | 180 | 270;
}

const COLORS = [
  rgb(0.93, 0.33, 0.27),
  rgb(0.14, 0.48, 0.96),
  rgb(0.18, 0.66, 0.34),
  rgb(0.96, 0.62, 0.12),
  rgb(0.54, 0.34, 0.86),
  rgb(0.05, 0.64, 0.72),
];

export async function createGridFixturePdf(pages: FixturePageSpec[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const [pageIndex, spec] of pages.entries()) {
    const preset = LAYOUT_PRESETS[spec.layoutId];
    const width = spec.width ?? Math.max(520, preset.columns * 260);
    const height = spec.height ?? Math.max(360, preset.rows * 170);
    const page = pdf.addPage([width, height]);
    if (spec.cropBox) page.setCropBox(spec.cropBox.x, spec.cropBox.y, spec.cropBox.width, spec.cropBox.height);
    if (spec.rotation !== undefined) page.setRotation(degrees(spec.rotation));
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });

    const margin = 18;
    const gap = 18;
    const cellWidth = (width - margin * 2 - gap * (preset.columns - 1)) / preset.columns;
    const cellHeight = (height - margin * 2 - gap * (preset.rows - 1)) / preset.rows;

    for (let row = 0; row < preset.rows; row += 1) {
      for (let column = 0; column < preset.columns; column += 1) {
        const order = row * preset.columns + column;
        const x = margin + column * (cellWidth + gap);
        const y = margin + (preset.rows - 1 - row) * (cellHeight + gap);
        page.drawRectangle({
          x,
          y,
          width: cellWidth,
          height: cellHeight,
          color: COLORS[order % COLORS.length] ?? rgb(0.2, 0.2, 0.2),
          borderColor: rgb(0.08, 0.08, 0.09),
          borderWidth: 1,
        });
        page.drawText(`${pageIndex + 1}.${order + 1}`, {
          x: x + 14,
          y: y + cellHeight - 36,
          size: 22,
          font,
          color: rgb(1, 1, 1),
        });
      }
    }
  }

  return pdf.save({ useObjectStreams: false });
}

export function createGridImageData(columns: number, rows: number, width = 360, height = 240): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }

  const margin = Math.max(8, Math.round(Math.min(width, height) * 0.06));
  const gap = Math.max(8, Math.round(Math.min(width, height) * 0.06));
  const cellWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
  const cellHeight = (height - margin * 2 - gap * (rows - 1)) / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const order = row * columns + column;
      const color = [60 + (order * 45) % 160, 70 + (order * 75) % 140, 80 + (order * 95) % 130];
      const startX = Math.round(margin + column * (cellWidth + gap));
      const endX = Math.round(startX + cellWidth);
      const startY = Math.round(margin + row * (cellHeight + gap));
      const endY = Math.round(startY + cellHeight);
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const offset = (y * width + x) * 4;
          data[offset] = color[0] ?? 80;
          data[offset + 1] = color[1] ?? 90;
          data[offset + 2] = color[2] ?? 100;
          data[offset + 3] = 255;
        }
      }
    }
  }

  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

export async function writeFixture(path: string, pages: FixturePageSpec[]): Promise<void> {
  const bytes = await createGridFixturePdf(pages);
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
}

async function main(): Promise<void> {
  await writeFixture('tests/fixtures/generated/three-by-two.pdf', [{ layoutId: 'three-by-two' }]);
  await writeFixture('tests/fixtures/generated/two-by-two.pdf', [{ layoutId: 'two-by-two' }]);
  await writeFixture('tests/fixtures/generated/mixed.pdf', [
    { layoutId: 'one-up' },
    { layoutId: 'two-up-horizontal' },
    { layoutId: 'two-by-two' },
    { layoutId: 'three-by-two' },
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
