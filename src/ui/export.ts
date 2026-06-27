import { createSplitPdf } from '../pdf/convert';
import type { ConversionPlan } from '../types';
import type { AppState } from '../state/store';
import { element, formatBytes } from './dom';

export interface ExportPanelOptions {
  state: AppState;
  objectUrl: string;
  onConvert(): void;
  onReset(): void;
}

export interface ExportRequest {
  sourceBytes?: Uint8Array;
  originalFileName?: string;
  plan?: ConversionPlan | { regions: Array<{ sourcePageIndex: number; cropBox: { left: number; bottom: number; width: number; height: number } }>; sourcePageCount?: number };
  requireReview?: boolean;
  reviewAccepted?: boolean;
}

export interface ExportState {
  status: 'idle' | 'processing' | 'success' | 'error';
  message: string;
  outputFileName?: string;
  preservedPlan?: ExportRequest['plan'];
}

export interface ExportAdapters {
  enableNetworkGuard?: boolean;
  convert?: (sourceBytes: Uint8Array, plan: NonNullable<ExportRequest['plan']>) => Promise<{ bytes: Uint8Array; outputPageCount: number }>;
  download?: (bytes: Uint8Array, fileName: string) => unknown;
  onStateChange?: (state: ExportState) => void;
}

export function createExportPanel({ state, objectUrl, onConvert, onReset }: ExportPanelOptions): HTMLElement {
  const plan = state.plan;
  const panel = element('section', { className: 'export-panel', attrs: { 'aria-label': 'Export status', 'data-testid': 'export-panel' } });
  const reviewNeeded = state.pages.filter((page) => page.reviewState === 'review-needed').length;
  const canConvert = Boolean(plan) && reviewNeeded === 0 && ['ready', 'success', 'error'].includes(state.phase);
  const convertButton = element('button', {
    className: 'button button-primary',
    text: state.phase === 'processing' ? 'Converting…' : 'Convert to one slide per page',
    attrs: { type: 'button', 'data-testid': 'convert-button', 'aria-describedby': 'export-help' },
  }) as HTMLButtonElement;
  convertButton.disabled = !canConvert;
  convertButton.addEventListener('click', onConvert);

  panel.append(
    element('div', { className: 'export-summary' }, [
      element('span', { className: 'privacy-badge', text: 'Processed locally in your browser' }),
      element('strong', { text: plan ? `${plan.estimatedOutputPages} output pages` : 'No PDF loaded' }),
      element('span', { className: 'muted', text: state.sourceFileName ? `${state.sourceFileName} · ${formatBytes(state.sourceByteLength)}` : 'Source PDF stays unchanged.' }),
    ]),
  );

  if (reviewNeeded > 0) {
    panel.append(element('div', { className: 'notice notice-warning', text: `${reviewNeeded} page${reviewNeeded === 1 ? '' : 's'} need review before export.`, attrs: { 'data-testid': 'review-needed-notice' } }));
  }
  for (const warning of plan?.warnings ?? []) {
    panel.append(element('div', { className: 'notice notice-warning', text: warning, attrs: { 'data-testid': 'workload-warning' } }));
  }
  if (state.errorMessage) {
    panel.append(element('div', { className: 'notice notice-error', text: state.errorMessage, attrs: { role: 'alert', 'data-testid': 'error-message' } }));
  }

  panel.append(
    element('p', { className: 'muted', attrs: { id: 'export-help' }, text: 'Each crop is centered on an A4 landscape page with white padding; embedded PDF regions preserve vector/text quality where supported.' }),
    convertButton,
  );

  if (state.exportResult && objectUrl) {
    panel.append(
      element('div', { className: 'notice notice-success', attrs: { 'data-testid': 'success-message' } }, [
        element('strong', { text: `${state.exportResult.outputPageCount} pages ready.` }),
        element('span', { text: state.exportResult.sourceHashBefore === state.exportResult.sourceHashAfter ? ' Source file hash is unchanged.' : ' Warning: source hash changed unexpectedly.' }),
      ]),
      element('a', { className: 'button button-success', text: 'Download split PDF', attrs: { href: objectUrl, download: state.exportResult.outputFileName, 'data-testid': 'download-link' } }),
    );
  }

  const resetButton = element('button', { className: 'button button-ghost', text: 'Start over', attrs: { type: 'button', 'data-testid': 'reset-button' } });
  resetButton.addEventListener('click', onReset);
  panel.append(resetButton);
  return panel;
}

export function buildSplitPdfFileName(originalFileName: string, existingNames: readonly string[] = []): string {
  const safeBase = originalFileName.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'split-slides';
  let candidate = `${safeBase}-slides.pdf`;
  let suffix = 2;
  while (existingNames.includes(candidate)) {
    candidate = `${safeBase}-slides-${suffix}.pdf`;
    suffix += 1;
  }
  return candidate;
}

export function describeExportDisabledReason(request: ExportRequest): string | undefined {
  if (!request.sourceBytes) return 'Choose a local PDF before exporting.';
  const regions = request.plan && 'regions' in request.plan ? request.plan.regions : [];
  if (request.requireReview && !request.reviewAccepted) return 'Review the suggested layout before exporting.';
  if (regions.length === 0) return 'Create at least one slide crop before exporting.';
  return undefined;
}

export async function exportSplitPdf(request: ExportRequest, adapters: ExportAdapters = {}): Promise<ExportState> {
  const disabledReason = describeExportDisabledReason(request);
  if (disabledReason) return emit({ status: 'idle', message: disabledReason }, adapters);
  const guard = adapters.enableNetworkGuard === false ? undefined : installNoUploadNetworkGuard();
  const processing = emit({ status: 'processing', message: 'Converting locally in this browser…' }, adapters);
  try {
    const sourceBytes = request.sourceBytes as Uint8Array;
    const plan = request.plan as NonNullable<ExportRequest['plan']>;
    const outputFileName = buildSplitPdfFileName(request.originalFileName ?? 'split.pdf');
    const converted = adapters.convert ? await adapters.convert(sourceBytes, plan) : await createSplitPdf(sourceBytes, plan as ConversionPlan);
    adapters.download?.(converted.bytes, outputFileName);
    return emit({ status: 'success', message: 'Split PDF ready for local download.', outputFileName }, adapters);
  } catch (error) {
    return emit({ status: 'error', message: `Your layout edits are preserved. ${error instanceof Error ? error.message : String(error)}`, preservedPlan: request.plan }, adapters);
  } finally {
    guard?.dispose();
    void processing;
  }
}

export function installNoUploadNetworkGuard(options: { scope?: typeof globalThis; onBlocked?: (event: { method: string; url: string }) => void } = {}): { dispose(): void } {
  const scope = options.scope ?? globalThis;
  const originalFetch = scope.fetch?.bind(scope);
  const navigatorWithBeacon = (scope as { navigator?: Pick<Navigator, 'sendBeacon'> }).navigator;
  const originalSendBeacon = typeof navigatorWithBeacon?.sendBeacon === 'function' ? navigatorWithBeacon.sendBeacon.bind(navigatorWithBeacon) : undefined;
  let sendBeaconReplaced = false;
  if (!originalFetch) return { dispose: () => undefined };
  if (navigatorWithBeacon && originalSendBeacon) {
    try {
      Object.defineProperty(navigatorWithBeacon, 'sendBeacon', {
        configurable: true,
        value: (url: string | URL, data?: BodyInit | null): boolean => {
          const baseUrl = scope.location?.href ?? globalThis.location?.href ?? 'http://localhost/';
          const resolvedUrl = new URL(String(url), baseUrl).href;
          options.onBlocked?.({ method: 'BEACON', url: resolvedUrl });
          void data;
          return false;
        },
      });
      sendBeaconReplaced = true;
    } catch {
      sendBeaconReplaced = false;
    }
  }
  scope.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestLike = input instanceof Request ? input : undefined;
    const method = (init?.method ?? requestLike?.method ?? 'GET').toUpperCase();
    const rawUrl = requestLike?.url ?? String(input);
    const baseUrl = scope.location?.href ?? globalThis.location?.href ?? 'http://localhost/';
    const resolvedUrl = new URL(rawUrl, baseUrl).href;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      options.onBlocked?.({ method, url: resolvedUrl });
      throw new Error(`Network upload blocked: ${method} ${resolvedUrl}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  return {
    dispose: () => {
      scope.fetch = originalFetch;
      if (navigatorWithBeacon && originalSendBeacon && sendBeaconReplaced) {
        Object.defineProperty(navigatorWithBeacon, 'sendBeacon', { configurable: true, value: originalSendBeacon });
      }
    },
  };
}

function emit(state: ExportState, adapters: ExportAdapters): ExportState {
  adapters.onStateChange?.(state);
  return state;
}
