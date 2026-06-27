import { describe, expect, it } from 'vitest';
import { deriveOutputFileName, formatBytes, getWorkloadWarnings, isPdfFile } from '../../src/utils/file';

describe('file utilities', () => {
  it('derives a non-overwriting split PDF name', () => {
    expect(deriveOutputFileName('lecture.pdf')).toBe('lecture-slides.pdf');
    expect(deriveOutputFileName('  .pdf')).toBe('split-slides-slides.pdf');
  });

  it('formats common byte sizes for document metadata', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
  });

  it('accepts PDFs by MIME type or extension only', () => {
    expect(isPdfFile(new File(['%PDF'], 'slides.bin', { type: 'application/pdf' }))).toBe(true);
    expect(isPdfFile(new File(['%PDF'], 'slides.PDF', { type: '' }))).toBe(true);
    expect(isPdfFile(new File(['hello'], 'slides.txt', { type: 'text/plain' }))).toBe(false);
  });

  it('surfaces the v1 soft workload guardrails', () => {
    expect(getWorkloadWarnings({ fileSize: 101 * 1024 * 1024 })).toEqual([
      expect.objectContaining({ code: 'large-file' })
    ]);
    expect(getWorkloadWarnings({ fileSize: 1, pageCount: 201, estimatedOutputPages: 1001 })).toEqual([
      expect.objectContaining({ code: 'many-source-pages' }),
      expect.objectContaining({ code: 'many-output-pages' })
    ]);
  });
});
