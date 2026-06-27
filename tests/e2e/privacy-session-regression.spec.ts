import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { A4_LANDSCAPE_PAGE } from '../../src/pdf/convert';
import { writeFixture } from '../fixtures/generate-fixtures';

const SESSION_FIXTURE = 'tests/fixtures/generated/e2e-session-privacy.pdf';
const NEXT_FIXTURE = 'tests/fixtures/generated/e2e-session-next.pdf';

test.beforeAll(async () => {
  await writeFixture(SESSION_FIXTURE, [
    { layoutId: 'one-up' },
    { layoutId: 'one-up' },
  ]);
  await writeFixture(NEXT_FIXTURE, [{ layoutId: 'two-up-horizontal' }]);
});

test('forgets saved crop layouts across reload and the next loaded PDF without browser storage', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(resolve(SESSION_FIXTURE));
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('saved-layout-empty-state')).toContainText('No saved crop layouts yet');

  await page.getByTestId('layout-three-by-two').click();
  await expect(page.getByTestId('crop-overlay').locator('li')).toHaveCount(6);
  await page.getByTestId('save-current-layout-button').click();
  await expect(page.getByTestId('saved-layout-select')).toHaveValue('saved-layout-1');
  await expect(page.getByTestId('saved-layout-select')).toContainText('Layout 1');

  await page.getByTestId('saved-layout-name-input').fill('Session Layout');
  await page.getByTestId('rename-saved-layout-button').click();
  await expect(page.getByTestId('saved-layout-select')).toContainText('Session Layout');
  await expect(page.getByTestId('saved-layout-name-input')).toHaveValue('Session Layout');
  await expect.poll(() => browserStorageSnapshot(page)).toEqual({ localStorageKeys: [], sessionStorageKeys: [] });

  await page.reload();
  await expect(page.getByTestId('dropzone')).toContainText('Processed locally');
  await expect.poll(() => browserStorageSnapshot(page)).toEqual({ localStorageKeys: [], sessionStorageKeys: [] });

  await page.getByTestId('pdf-input').setInputFiles(resolve(NEXT_FIXTURE));
  await expect(page.getByTestId('export-panel')).toContainText('e2e-session-next.pdf', { timeout: 20_000 });
  await expect(page.getByTestId('saved-layout-empty-state')).toContainText('No saved crop layouts yet');
  await expect(page.getByTestId('saved-layout-select')).toBeDisabled();
});

test('exports locally without source mutation and every downloaded page is A4 landscape', async ({ page }) => {
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

  const fixturePath = resolve(SESSION_FIXTURE);
  const sourceBefore = await readFile(fixturePath);
  await page.getByTestId('pdf-input').setInputFiles(fixturePath);
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('layout-three-by-two').click();
  await page.getByTestId('range-input').fill('2');
  await page.getByTestId('range-layout-select').selectOption('three-by-two');
  await page.getByTestId('apply-range-button').click();
  await expect(page.getByTestId('status-region')).toContainText('Edits saved locally in this browser session.');

  await page.getByTestId('convert-button').click();
  await expect(page.getByTestId('success-message')).toContainText('12 pages ready', { timeout: 30_000 });
  await expect(page.getByTestId('success-message')).toContainText('Source file hash is unchanged');

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-link').click(),
  ]).then(([downloadEvent]) => downloadEvent);
  expect(download.suggestedFilename()).toBe('e2e-session-privacy-slides.pdf');
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const outputPdf = await PDFDocument.load(await readFile(downloadedPath!));
  expect(outputPdf.getPageCount()).toBe(12);
  for (const outputPage of outputPdf.getPages()) {
    expect(outputPage.getWidth()).toBeCloseTo(A4_LANDSCAPE_PAGE.width, 6);
    expect(outputPage.getHeight()).toBeCloseTo(A4_LANDSCAPE_PAGE.height, 6);
  }
  expect([...await readFile(fixturePath)]).toEqual([...sourceBefore]);
  expect(await browserStorageSnapshot(page)).toEqual({ localStorageKeys: [], sessionStorageKeys: [] });
  expect(nonLocalRequests).toEqual([]);
  expect(mutatingRequests).toEqual([]);
});

async function browserStorageSnapshot(page: Page): Promise<{ localStorageKeys: string[]; sessionStorageKeys: string[] }> {
  return page.evaluate(() => ({
    localStorageKeys: Object.keys(localStorage).sort(),
    sessionStorageKeys: Object.keys(sessionStorage).sort(),
  }));
}
