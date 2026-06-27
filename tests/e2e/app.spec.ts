import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { A4_LANDSCAPE_PAGE } from '../../src/pdf/convert';
import { writeFixture } from '../fixtures/generate-fixtures';

test.beforeAll(async () => {
  await writeFixture('tests/fixtures/generated/e2e-mixed.pdf', [
    { layoutId: 'one-up' },
    { layoutId: 'two-up-horizontal' },
    { layoutId: 'two-by-two' },
    { layoutId: 'three-by-two' },
  ]);

  const blankPdf = await PDFDocument.create();
  const blankPage = blankPdf.addPage([600, 400]);
  blankPage.drawRectangle({ x: 0, y: 0, width: 600, height: 400, color: rgb(1, 1, 1) });
  const blankPath = resolve('tests/fixtures/generated/e2e-blank.pdf');
  await mkdir(dirname(blankPath), { recursive: true });
  await writeFile(blankPath, await blankPdf.save({ useObjectStreams: false }));
});

test('loads a local PDF, shows preview controls, overrides layouts, converts, and exposes a local download', async ({ page }) => {
  const nonLocalRequests: string[] = [];
  const mutatingRequests: string[] = [];
  await page.goto('/');
  const appOrigin = new URL(page.url()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin && url.protocol !== 'blob:') {
      nonLocalRequests.push(request.url());
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutatingRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await expect(page.getByTestId('dropzone')).toContainText('Processed locally');

  await page.getByTestId('pdf-input').setInputFiles(resolve('tests/fixtures/generated/e2e-mixed.pdf'));
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  const overlay = page.getByTestId('crop-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('li')).toHaveCount(1);
  await expect(page.getByTestId('inspector-panel')).toContainText('Layout');

  const firstCrop = page.getByTestId('crop-overlay-item').first();
  const initialCropSize = parseCropSize(await firstCrop.getAttribute('aria-label'));
  await firstCrop.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async () => {
    const size = parseCropSize(await firstCrop.getAttribute('aria-label'));
    return Number((size.width - initialCropSize.width).toFixed(1));
  }).toBe(-1);
  await expect(page.getByTestId('preview-summary')).toContainText('manual crop');
  await page.getByTestId('reset-page-button').click();
  await expect.poll(async () => {
    const size = parseCropSize(await page.getByTestId('crop-overlay-item').first().getAttribute('aria-label'));
    return `${size.width}x${size.height}`;
  }).toBe(`${initialCropSize.width}x${initialCropSize.height}`);
  await expect(page.getByTestId('preview-summary')).not.toContainText('manual crop');

  await page.getByTestId('layout-three-by-two').click();
  await expect(overlay.locator('li')).toHaveCount(6);
  await expect(page.getByTestId('expected-output-preview')).toContainText('Expected output preview');
  await expect(page.getByTestId('expected-output-canvas')).toHaveCount(6);
  const expectedOutputCard = page.getByTestId('expected-output-canvas').first();
  await expect.poll(async () => expectedOutputCard.evaluate((canvas) => {
    const typedCanvas = canvas as HTMLCanvasElement;
    return {
      width: typedCanvas.width,
      height: typedCanvas.height,
      ratio: Number((typedCanvas.width / typedCanvas.height).toFixed(3)),
    };
  })).toMatchObject({ width: 420, height: 297, ratio: 1.414 });
  const expectedOutputCards = page.getByTestId('expected-output-card');
  const secondCardCropX = await expectedOutputCards.nth(1).getAttribute('data-crop-x');
  expect(secondCardCropX).toBeTruthy();
  await expectedOutputCards.nth(1).dragTo(expectedOutputCards.nth(0));
  await expect.poll(() => page.getByTestId('expected-output-card').first().getAttribute('data-crop-x')).toBe(secondCardCropX);
  await page.getByTestId('expected-output-delete-button').first().click();
  await expect(page.getByTestId('expected-output-card')).toHaveCount(5);
  await expect(page.getByTestId('preview-summary')).toContainText('5 output slides');
  await page.getByTestId('layout-three-by-two').click();
  await expect(page.getByTestId('expected-output-card')).toHaveCount(6);
  const overlayMetrics = await overlay.evaluate((node) => {
    const overlayRect = node.getBoundingClientRect();
    const canvasRect = node.closest('.pdf-preview-page')?.querySelector('canvas')?.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      display: style.display,
      overlayWidth: Math.round(overlayRect.width),
      overlayHeight: Math.round(overlayRect.height),
      canvasWidth: Math.round(canvasRect?.width ?? 0),
      canvasHeight: Math.round(canvasRect?.height ?? 0),
    };
  });
  expect(overlayMetrics).toMatchObject({ display: 'grid' });
  expect(overlayMetrics.overlayWidth).toBe(overlayMetrics.canvasWidth);
  expect(overlayMetrics.overlayHeight).toBe(overlayMetrics.canvasHeight);

  await expect(page.getByTestId('preview-summary')).toContainText('three-by-two');

  await page.getByTestId('layout-two-by-two').click();
  await expect(page.getByTestId('preview-summary')).toContainText('two-by-two');
  await page.getByTestId('range-input').fill('2-3');
  await page.getByTestId('range-layout-select').selectOption('three-by-two');
  await page.getByTestId('apply-range-button').click();
  await expect(page.getByTestId('status-region')).toContainText('Edits saved');
  await page.evaluate(() => {
    window.__pdfSlideSplitterTestHooks = {
      attemptNetworkDuringExport: true,
      blockedNetworkEvents: [],
    };
  });

  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('success-message')).toContainText('pages ready', { timeout: 30_000 });
  const guardProbe = await page.evaluate(() => window.__pdfSlideSplitterTestHooks);
  expect(guardProbe?.guardProbe).toMatchObject({
    fetchBlocked: true,
    sendBeaconReturn: false,
  });
  expect(guardProbe?.guardProbe?.fetchError).toContain('Network upload blocked');
  expect(guardProbe?.blockedNetworkEvents).toEqual([
    expect.stringContaining('POST '),
    expect.stringContaining('BEACON '),
  ]);
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-link').click(),
  ]).then(([downloadEvent]) => downloadEvent);
  expect(download.suggestedFilename()).toBe('e2e-mixed-slides.pdf');
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const outputPdf = await PDFDocument.load(await readFile(downloadedPath!));
  expect(outputPdf.getPage(0).getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
  expect(outputPdf.getPage(0).getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);

  expect(nonLocalRequests).toEqual([]);
  expect(mutatingRequests).toEqual([]);
});

test('saves, renames, updates, reapplies, deletes, and exports a session-local saved crop layout', async ({ page }) => {
  const sourcePath = resolve('tests/fixtures/generated/e2e-mixed.pdf');
  const sourceBefore = await readFile(sourcePath);
  const nonLocalRequests: string[] = [];
  const mutatingRequests: string[] = [];

  await page.goto('/');
  const appOrigin = new URL(page.url()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== appOrigin && url.protocol !== 'blob:') {
      nonLocalRequests.push(request.url());
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutatingRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await expect(page.getByTestId('dropzone')).toContainText('Processed locally');
  await expect(page.getByText('No external upload')).toBeVisible();

  await page.getByTestId('pdf-input').setInputFiles(sourcePath);
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('saved-layout-empty-state')).toContainText('No saved crop layouts yet');
  await expect(page.getByTestId('saved-layout-select')).toBeDisabled();

  await page.getByTestId('layout-two-by-two').click();
  await expectSelectedPageCropLayout(page, 1, 'two-by-two', 4);
  await page.getByTestId('save-current-layout-button').click();
  await expect(page.getByTestId('saved-layout-name-input')).toHaveValue('Layout 1');
  await expect(page.getByTestId('saved-layout-select')).toBeEnabled();
  await expect(page.getByTestId('saved-layout-select').locator('option')).toHaveText(['Choose saved layout', 'Layout 1']);

  await page.getByTestId('saved-layout-name-input').fill('Lecture crops');
  await page.getByTestId('rename-saved-layout-button').click();
  await expect(page.getByTestId('saved-layout-name-input')).toHaveValue('Lecture crops');
  await expect(page.getByTestId('saved-layout-select').locator('option')).toHaveText(['Choose saved layout', 'Lecture crops']);

  await page.getByTestId('range-input').fill('2-3');
  await page.getByTestId('apply-saved-layout-button').click();
  await selectPreviewPage(page, 2);
  await expectSelectedPageCropLayout(page, 2, 'two-by-two', 4);
  await selectPreviewPage(page, 3);
  await expectSelectedPageCropLayout(page, 3, 'two-by-two', 4);

  await selectPreviewPage(page, 1);
  await page.getByTestId('layout-three-by-two').click();
  await expectSelectedPageCropLayout(page, 1, 'three-by-two', 6);
  await selectPreviewPage(page, 2);
  await expectSelectedPageCropLayout(page, 2, 'two-by-two', 4);

  await selectPreviewPage(page, 1);
  await page.getByTestId('update-saved-layout-button').click();
  await selectPreviewPage(page, 2);
  await expectSelectedPageCropLayout(page, 2, 'two-by-two', 4);
  await page.getByTestId('range-input').fill('2');
  await page.getByTestId('apply-saved-layout-button').click();
  await expectSelectedPageCropLayout(page, 2, 'three-by-two', 6);
  await selectPreviewPage(page, 3);
  await expectSelectedPageCropLayout(page, 3, 'two-by-two', 4);

  expect(await readBrowserStorageSnapshot(page)).toEqual({
    cacheKeys: [],
    indexedDbNames: [],
    localStorageKeys: [],
    sessionStorageKeys: [],
  });

  await page.getByTestId('delete-saved-layout-button').click();
  await expect(page.getByTestId('saved-layout-empty-state')).toContainText('No saved crop layouts yet');
  await expect(page.getByTestId('saved-layout-select')).toBeDisabled();
  await expect(page.getByTestId('apply-saved-layout-button')).toBeDisabled();

  await page.evaluate(() => {
    window.__pdfSlideSplitterTestHooks = {
      attemptNetworkDuringExport: true,
      blockedNetworkEvents: [],
    };
  });

  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('success-message')).toContainText('pages ready', { timeout: 30_000 });
  const guardProbe = await page.evaluate(() => window.__pdfSlideSplitterTestHooks);
  expect(guardProbe?.guardProbe).toMatchObject({
    fetchBlocked: true,
    sendBeaconReturn: false,
  });
  expect(guardProbe?.guardProbe?.fetchError).toContain('Network upload blocked');
  expect(guardProbe?.blockedNetworkEvents).toEqual([
    expect.stringContaining('POST '),
    expect.stringContaining('BEACON '),
  ]);

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-link').click(),
  ]).then(([downloadEvent]) => downloadEvent);
  expect(download.suggestedFilename()).toBe('e2e-mixed-slides.pdf');
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const outputPdf = await PDFDocument.load(await readFile(downloadedPath!));
  for (const pdfPage of outputPdf.getPages()) {
    expect(pdfPage.getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
    expect(pdfPage.getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
  }

  const sourceAfter = await readFile(sourcePath);
  expect(sourceAfter.byteLength).toBe(sourceBefore.byteLength);
  expect(sourceAfter.equals(sourceBefore)).toBe(true);
  expect(nonLocalRequests).toEqual([]);
  expect(mutatingRequests).toEqual([]);
});

test('review-needed automatic pages block export until a manual layout override restores crops', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(resolve('tests/fixtures/generated/e2e-blank.pdf'));
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('review-needed-page')).toBeVisible();
  await expect(page.getByTestId('crop-overlay').locator('li')).toHaveCount(0);

  await expect(page.getByTestId('review-needed-notice')).toContainText('need review before export');
  await expect(page.getByTestId('convert-button')).toBeDisabled();

  await page.getByTestId('layout-one-up').click();
  await expect(page.getByTestId('crop-overlay').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('convert-button')).toBeEnabled();
  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('success-message')).toContainText('pages ready', { timeout: 30_000 });
});

test('export failure is graceful and preserves the edit workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(resolve('tests/fixtures/generated/e2e-mixed.pdf'));
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    window.__pdfSlideSplitterTestHooks = { failNextExport: true };
  });
  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('error-message')).toContainText('Export failed gracefully');
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('inspector-panel')).toBeVisible();
});

function parseCropSize(label: string | null): { width: number; height: number } {
  const match = /([0-9.]+) by ([0-9.]+) PDF points/.exec(label ?? '');
  if (!match) throw new Error(`Unable to parse crop size from label: ${label}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function selectPreviewPage(page: Page, pageNumber: number): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^Page ${pageNumber}\\b`) }).click();
  await expect(page.getByTestId('crop-overlay')).toHaveAttribute('aria-label', `Crop boxes for page ${pageNumber}`);
}

async function expectSelectedPageCropLayout(
  page: Page,
  pageNumber: number,
  layoutId: string,
  cropCount: number,
): Promise<void> {
  await expect(page.getByTestId('crop-overlay')).toHaveAttribute('aria-label', `Crop boxes for page ${pageNumber}`);
  await expect(page.getByTestId('preview-summary')).toContainText(layoutId);
  await expect(page.getByTestId('preview-summary')).toContainText(`${cropCount} output slide`);
  await expect(page.getByTestId('crop-overlay').locator('li')).toHaveCount(cropCount);
}

async function readBrowserStorageSnapshot(page: Page): Promise<{
  cacheKeys: string[];
  indexedDbNames: string[];
  localStorageKeys: string[];
  sessionStorageKeys: string[];
}> {
  return page.evaluate(async () => {
    function storageKeys(storage: Storage): string[] {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) keys.push(key);
      }
      return keys.sort();
    }

    const indexedDb = window.indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };

    return {
      cacheKeys: 'caches' in window ? (await caches.keys()).sort() : [],
      indexedDbNames: indexedDb.databases
        ? (await indexedDb.databases()).flatMap((database) => (database.name ? [database.name] : [])).sort()
        : [],
      localStorageKeys: storageKeys(localStorage),
      sessionStorageKeys: storageKeys(sessionStorage),
    };
  });
}
