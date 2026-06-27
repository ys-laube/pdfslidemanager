import type { LoadedPdfSummary, WorkloadWarning } from '../types';

const LARGE_FILE_BYTES = 100 * 1024 * 1024;
const MANY_SOURCE_PAGES = 200;
const MANY_OUTPUT_PAGES = 1_000;

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function deriveOutputFileName(fileName: string): string {
  const withoutPdfExtension = fileName.replace(/\.pdf$/i, '');
  const safeBaseName = withoutPdfExtension.trim() || 'split-slides';
  return `${safeBaseName}-slides.pdf`;
}

export function getWorkloadWarnings(input: {
  readonly fileSize: number;
  readonly pageCount?: number;
  readonly estimatedOutputPages?: number;
}): readonly WorkloadWarning[] {
  const warnings: WorkloadWarning[] = [];

  if (input.fileSize > LARGE_FILE_BYTES) {
    warnings.push({
      code: 'large-file',
      message: `This PDF is ${formatBytes(input.fileSize)}. Large files may need more memory, but your edits will stay in this browser.`
    });
  }

  if (typeof input.pageCount === 'number' && input.pageCount > MANY_SOURCE_PAGES) {
    warnings.push({
      code: 'many-source-pages',
      message: `This PDF has ${input.pageCount} pages. Review in sections if your browser becomes slow.`
    });
  }

  if (typeof input.estimatedOutputPages === 'number' && input.estimatedOutputPages > MANY_OUTPUT_PAGES) {
    warnings.push({
      code: 'many-output-pages',
      message: `The split PDF may create about ${input.estimatedOutputPages} pages. Export may take a while.`
    });
  }

  return warnings;
}

export async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function summarizeLocalPdf(file: File): Promise<LoadedPdfSummary> {
  if (!isPdfFile(file)) {
    throw new Error('Choose a PDF file to continue.');
  }

  const buffer = await file.arrayBuffer();
  const sourceHash = await hashBuffer(buffer);

  return {
    fileName: file.name,
    fileSize: file.size,
    sourceHash,
    outputFileName: deriveOutputFileName(file.name),
    loadedAt: new Date().toISOString(),
    warnings: getWorkloadWarnings({ fileSize: file.size })
  };
}
