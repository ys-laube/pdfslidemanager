import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashBytes } from '../../src/pdf/hash';
import { readPdfFile } from '../../src/pdf/load';

const pdfJsMock = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {} as { workerSrc?: string },
}));

vi.mock('pdfjs-dist', () => pdfJsMock);
vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'mock-pdf-worker.mjs' }));

describe('readPdfFile privacy/source immutability', () => {
  beforeEach(() => {
    pdfJsMock.getDocument.mockReset();
    delete pdfJsMock.GlobalWorkerOptions.workerSrc;
  });

  it('parses PDF.js from a copied byte buffer without mutating the selected source file bytes', async () => {
    const sourceBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const sourceBefore = Array.from(sourceBytes);
    const expectedHash = await hashBytes(sourceBytes);
    let pdfJsData: Uint8Array | undefined;
    pdfJsMock.getDocument.mockImplementation(({ data }: { data: Uint8Array }) => {
      pdfJsData = data;
      data.fill(0);
      return {
        promise: Promise.resolve({
          numPages: 1,
          getPage: vi.fn(async () => ({
            view: [0, 0, 612, 792] as [number, number, number, number],
            rotate: 0,
            getViewport: vi.fn(),
            render: vi.fn(),
          })),
        }),
      };
    });

    const file = new File([sourceBytes], 'source.pdf', { type: 'application/pdf' });
    const loaded = await readPdfFile(file);

    expect(pdfJsMock.getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array) }));
    expect(pdfJsData).toBeDefined();
    expect(pdfJsData).not.toBe(loaded.bytes);
    expect(Array.from(pdfJsData!)).toEqual(new Array(sourceBefore.length).fill(0));
    expect(Array.from(sourceBytes)).toEqual(sourceBefore);
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual(sourceBefore);
    expect(Array.from(loaded.bytes)).toEqual(sourceBefore);
    expect(loaded.sourceHash).toBe(expectedHash);
    expect(loaded.pageBoxes).toEqual([{ x: 0, y: 0, width: 612, height: 792, rotation: 0 }]);
  });
});
