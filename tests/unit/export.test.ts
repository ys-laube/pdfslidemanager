import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { A4_LANDSCAPE_PAGE } from '../../src/pdf/convert';
import {
  buildSplitPdfFileName,
  describeExportDisabledReason,
  exportSplitPdf,
  installNoUploadNetworkGuard,
  type ExportRequest,
} from '../../src/ui/export';

describe('export UI helpers', () => {
  it('creates safe non-overwriting slide output filenames', () => {
    expect(buildSplitPdfFileName('Lecture 01.pdf')).toBe('Lecture 01-slides.pdf');
    expect(buildSplitPdfFileName('Lecture 01.pdf', ['Lecture 01-slides.pdf'])).toBe('Lecture 01-slides-2.pdf');
    expect(buildSplitPdfFileName('bad/name?.pdf')).toBe('bad-name--slides.pdf');
  });

  it('explains disabled export states', () => {
    expect(describeExportDisabledReason({})).toMatch(/Choose a local PDF/);
    expect(describeExportDisabledReason({ sourceBytes: new Uint8Array([1]), plan: { regions: [] } })).toMatch(/at least one slide crop/);
    expect(
      describeExportDisabledReason({
        sourceBytes: new Uint8Array([1]),
        plan: { regions: [] },
        requireReview: true,
        reviewAccepted: false,
      }),
    ).toMatch(/Review the suggested layout/);
    expect(
      describeExportDisabledReason({
        sourceBytes: new Uint8Array([1]),
        plan: { regions: [{ sourcePageIndex: 0, cropBox: { left: 0, bottom: 0, width: 10, height: 10 } }] },
        requireReview: true,
        reviewAccepted: false,
      }),
    ).toMatch(/Review the suggested layout/);
  });

  it('preserves the confirmed plan and reports a local error when conversion fails', async () => {
    const request: ExportRequest = {
      sourceBytes: new Uint8Array([1, 2, 3]),
      originalFileName: 'source.pdf',
      plan: { regions: [{ sourcePageIndex: 0, cropBox: { left: 0, bottom: 0, width: 10, height: 10 } }] },
      reviewAccepted: true,
    };

    const states = [] as string[];
    const finalState = await exportSplitPdf(request, {
      enableNetworkGuard: false,
      convert: async () => {
        throw new Error('fixture failure');
      },
      download: vi.fn(),
      onStateChange: (state) => states.push(state.status),
    });

    expect(states).toEqual(['processing', 'error']);
    expect(finalState.status).toBe('error');
    expect(finalState.message).toContain('Your layout edits are preserved');
    expect(finalState.preservedPlan).toBe(request.plan);
  });

  it('runs the real local conversion path and hands bytes to the download adapter', async () => {
    const sourcePdf = await PDFDocument.create();
    const sourcePage = sourcePdf.addPage([200, 100]);
    sourcePage.drawRectangle({ x: 0, y: 0, width: 200, height: 100 });
    const sourceBytes = await sourcePdf.save();
    const request: ExportRequest = {
      sourceBytes,
      originalFileName: 'deck.pdf',
      plan: {
        regions: [{ sourcePageIndex: 0, cropBox: { left: 0, bottom: 0, width: 100, height: 100 } }],
        sourcePageCount: 1,
      },
      reviewAccepted: true,
    };
    let downloadedBytes: Uint8Array | undefined;

    const finalState = await exportSplitPdf(request, {
      enableNetworkGuard: false,
      download: (bytes, fileName) => {
        downloadedBytes = bytes;
        return { fileName, blob: new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]) };
      },
    });
    const outputPdf = await PDFDocument.load(downloadedBytes!);

    expect(finalState.status).toBe('success');
    expect(finalState.outputFileName).toBe('deck-slides.pdf');
    expect(outputPdf.getPageCount()).toBe(1);
    expect(outputPdf.getPage(0).getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
    expect(outputPdf.getPage(0).getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
  });

  it('blocks write-like network calls while allowing read-only asset requests', async () => {
    const originalFetch = vi.fn(async () => ({ ok: true }));
    const originalSendBeacon = vi.fn(() => true);
    const scope = {
      location: { href: 'https://local.test/app/' },
      fetch: originalFetch,
      navigator: { sendBeacon: originalSendBeacon },
    } as unknown as typeof globalThis;
    const blocked: string[] = [];
    const guard = installNoUploadNetworkGuard({
      scope,
      onBlocked: (event) => blocked.push(`${event.method} ${event.url}`),
    });

    await expect(scope.fetch('https://example.invalid/upload', { method: 'POST', body: new Uint8Array([37, 80, 68, 70]) })).rejects.toThrow(
      /Network upload blocked/,
    );
    expect(scope.navigator.sendBeacon('https://example.invalid/beacon', new Uint8Array([1, 2, 3]))).toBe(false);
    await expect(scope.fetch('/asset.css', { method: 'GET' })).resolves.toEqual({ ok: true });

    guard.dispose();
    await expect(scope.fetch('https://example.invalid/upload', { method: 'POST' })).resolves.toEqual({ ok: true });
    expect(scope.navigator.sendBeacon('https://example.invalid/beacon')).toBe(true);
    expect(blocked).toEqual(['POST https://example.invalid/upload', 'BEACON https://example.invalid/beacon']);
  });
});
