// Page design summary scan (PRD SUM-01 to SUM-05).
//
// The scan is bounded, chunked, cancellable, and honest about what it left
// out. It collects one record per eligible element and hands the whole set to
// the pure aggregator, which owns the grouping rules.

import type {
  ColorValue,
  ElementScanRecord,
  FontConfidence,
  FontRecord,
  PageSummary,
  ScanScope,
  SourceContext,
} from '../contracts';
import { aggregateSummary } from '../readings/summary-aggregate';
import { detectStack } from '../readings/stack-signatures';
import { parseColor } from '../readings/color';
import {
  classifyFontSource,
  identifyFamily,
  readDocumentFonts,
  splitFontFamilyStack,
  type DocumentFontsResult,
  isGenericFamily,
} from '../readings/fonts';
import { buildLocator, hasOwnText, labelOf, textSample } from '../readings/locator';
import { parsePx, splitCssList } from '../readings/units';
import { HOST_TAG } from './overlay';
import { gatherEvidence } from './evidence';
import {
  colorSides,
  computedWeight,
  isSvgElement,
  pxSides,
  radiusCorners,
  readSourceContext,
  styleSides,
} from './readings';

const CHUNK_SIZE = 200;
const SKIPPED_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'head',
  'meta',
  'link',
  'title',
  HOST_TAG,
]);

export interface ScanOptions {
  cap: number;
  globals?: string[];
  onProgress?(scanned: number, total: number): void;
  doc?: Document;
}

export interface ScanRun {
  summary: Promise<PageSummary>;
  cancel(): void;
}

export class ScanCancelled extends Error {
  constructor() {
    super('Scan cancelled');
    this.name = 'ScanCancelled';
  }
}

/** Collects candidate elements, descending into open shadow roots. */
function collectCandidates(doc: Document): { elements: Element[]; shadowRoots: number } {
  const elements: Element[] = [];
  let shadowRoots = 0;

  const walkRoot = (root: Node): void => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const element = node as Element;
        const tag = element.tagName.toLowerCase();
        if (SKIPPED_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node = walker.nextNode();
    while (node) {
      const element = node as Element;
      elements.push(element);
      if (element.shadowRoot) {
        shadowRoots += 1;
        walkRoot(element.shadowRoot);
      }
      node = walker.nextNode();
    }
  };

  if (doc.body) walkRoot(doc.body);
  return { elements, shadowRoots };
}

function isExtensionUi(element: Element): boolean {
  if (element.tagName.toLowerCase() === HOST_TAG) return true;
  return !!element.closest(HOST_TAG);
}

type SkipReason = 'hidden' | 'zero-size' | 'extension-ui';

function visibilityOf(element: Element): SkipReason | null {
  if (isExtensionUi(element)) return 'extension-ui';

  const withCheck = element as Element & {
    checkVisibility?(options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }): boolean;
  };
  if (typeof withCheck.checkVisibility === 'function') {
    let visible = true;
    try {
      visible = withCheck.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    } catch {
      visible = true;
    }
    if (!visible) return 'hidden';
  } else if (element.getClientRects().length === 0) {
    return 'hidden';
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return 'zero-size';
  return null;
}

function nullWhenTransparent(color: ColorValue): ColorValue | null {
  return color.alpha === 0 ? null : color;
}

/** One record per eligible element, for the pure aggregator. */
export function buildScanRecord(
  element: Element,
  style: CSSStyleDeclaration,
  identify: (family: string, weight: number) => { reading: string; confidence: FontConfidence },
): ElementScanRecord {
  const ownText = hasOwnText(element);
  const svg = isSvgElement(element);
  const display = style.display || '';

  const borderWidth = pxSides(style, 'border');
  const borderStyle = styleSides(style);
  const borderColor = colorSides(style);
  const borderColors: ColorValue[] = [];
  (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
    const width = borderWidth[side];
    const kind = borderStyle[side];
    if (width > 0 && kind !== 'none' && kind !== 'hidden') borderColors.push(borderColor[side]);
  });

  let typography: ElementScanRecord['typography'] = null;
  if (ownText) {
    const stack = splitFontFamilyStack(style.fontFamily);
    const weight = computedWeight(style);
    const identified = identify(stack[0] ?? '', weight);
    typography = {
      familyReading: identified.reading,
      familyConfidence: identified.confidence,
      weight,
      style: (style.fontStyle || 'normal').trim(),
      sizePx: parsePx(style.fontSize),
      lineHeightRaw: (style.lineHeight || 'normal').trim(),
      letterSpacingRaw: (style.letterSpacing || 'normal').trim(),
      color: parseColor(style.color),
      sample: textSample(element, 60) ?? '',
    };
  }

  const fillRaw = svg ? (style.fill ?? '').trim() : '';
  const strokeRaw = svg ? (style.stroke ?? '').trim() : '';
  const isContainer = display.includes('flex') || display.includes('grid');

  return {
    locator: buildLocator(element),
    label: labelOf(element),
    hasOwnText: ownText,
    typography,
    backgroundColor: nullWhenTransparent(parseColor(style.backgroundColor)),
    backgroundLayers: splitCssList(style.backgroundImage),
    borderColors,
    fill: fillRaw && fillRaw !== 'none' ? parseColor(fillRaw) : null,
    stroke: strokeRaw && strokeRaw !== 'none' ? parseColor(strokeRaw) : null,
    padding: pxSides(style, 'padding'),
    margin: pxSides(style, 'margin'),
    gap: isContainer ? { row: parsePx(style.rowGap), column: parsePx(style.columnGap) } : null,
    radius: radiusCorners(style),
    boxShadow: splitCssList(style.boxShadow),
  };
}

/**
 * Font inventory: declared faces from the document merged with the families
 * actually seen in the scanned content (PRD SUM-05).
 */
export function buildFontRecords(
  fonts: DocumentFontsResult,
  records: ElementScanRecord[],
  pageOrigin: string | undefined,
): FontRecord[] {
  const seenInContent = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.typography) continue;
    const key = record.typography.familyReading.toLowerCase();
    const weights = seenInContent.get(key) ?? new Set<string>();
    weights.add(String(record.typography.weight));
    seenInContent.set(key, weights);
  }

  const out: FontRecord[] = [];
  const byFamily = new Map<string, typeof fonts.faces>();
  for (const face of fonts.faces) {
    const key = face.family.toLowerCase();
    const list = byFamily.get(key) ?? [];
    list.push(face);
    byFamily.set(key, list);
  }

  for (const [key, faces] of byFamily) {
    const family = faces[0]?.family ?? key;
    const statuses = faces.map((face) => face.status).filter((status) => status !== null);
    out.push({
      family,
      declared: true,
      loaded: statuses.length === 0 ? null : statuses.includes('loaded'),
      matchedToContent: seenInContent.has(key),
      source: classifyFontSource(
        family,
        faces.flatMap((face) => face.urls),
        { pageOrigin, providerUrls: fonts.providerUrls },
      ),
      weights: Array.from(new Set(faces.map((face) => face.weight))),
      faces,
    });
  }

  for (const [key, weights] of seenInContent) {
    if (byFamily.has(key)) continue;
    // `sans-serif`, `monospace` and friends are CSS generics, not faces (SUM-05).
    if (isGenericFamily(key)) continue;
    const family =
      records.find((record) => record.typography?.familyReading.toLowerCase() === key)?.typography
        ?.familyReading ?? key;
    out.push({
      family,
      declared: false,
      loaded: null,
      matchedToContent: true,
      source: classifyFontSource(family, [], { pageOrigin, providerUrls: fonts.providerUrls }),
      weights: Array.from(weights),
      faces: [],
    });
  }

  return out;
}

function countInaccessibleFrames(doc: Document): number {
  let count = 0;
  doc.querySelectorAll('iframe').forEach((frame) => {
    try {
      if (!(frame as HTMLIFrameElement).contentDocument) count += 1;
    } catch {
      count += 1;
    }
  });
  return count;
}

interface ChunkHandle {
  id: number;
  kind: 'idle' | 'timer';
}

/**
 * The scan must never be the reason a frame is late, so a chunk runs in the
 * browser's idle time and stops as soon as the browser says the idle period is
 * over. `timeout` keeps it progressing on a page that is never idle, and a
 * hidden document (or a browser without the API) falls back to a macrotask,
 * where there are no frames to protect (PRD 19.1, PERF 3).
 */
const IDLE_TIMEOUT_MS = 250;
/** Time left in the idle period below which the chunk yields, in ms. */
const IDLE_FLOOR_MS = 1;
/** Elements between two checks of the deadline. */
const DEADLINE_EVERY = 25;
/** What a macrotask fallback pretends it has, so it still yields every 200. */
const FALLBACK_BUDGET_MS = 8;

type IdleWindow = Window &
  typeof globalThis & {
    requestIdleCallback?(
      callback: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void,
      options?: { timeout: number },
    ): number;
    cancelIdleCallback?(handle: number): void;
  };

function nextChunk(callback: (timeRemainingMs: () => number) => void): ChunkHandle {
  const view = window as IdleWindow;
  if (!document.hidden && typeof view.requestIdleCallback === 'function') {
    const id = view.requestIdleCallback(
      (deadline) => callback(() => deadline.timeRemaining()),
      { timeout: IDLE_TIMEOUT_MS },
    );
    return { id, kind: 'idle' };
  }
  return {
    id: window.setTimeout(() => callback(() => FALLBACK_BUDGET_MS), 0),
    kind: 'timer',
  };
}

function cancelChunk(handle: ChunkHandle | null): void {
  if (!handle) return;
  if (handle.kind === 'timer') {
    window.clearTimeout(handle.id);
    return;
  }
  const view = window as IdleWindow;
  if (typeof view.cancelIdleCallback === 'function') view.cancelIdleCallback(handle.id);
}

/**
 * Starts a chunked scan. Cancelling rejects the promise with ScanCancelled,
 * which callers treat as an ordinary outcome, not an error (PRD 19.1).
 */
export function startScan(options: ScanOptions): ScanRun {
  const doc = options.doc ?? document;
  const cap = Math.max(1, options.cap);
  const startedAt = Date.now();
  const source: SourceContext = readSourceContext(doc);

  let cancelled = false;
  let handle: ChunkHandle | null = null;
  let abort: ((error: unknown) => void) | null = null;

  const summary = new Promise<PageSummary>((resolve, reject) => {
    abort = reject;
    const { elements, shadowRoots } = collectCandidates(doc);
    const total = elements.length;
    const records: ElementScanRecord[] = [];
    const skipped = new Map<SkipReason, number>();
    const fonts = readDocumentFonts(doc);
    const identificationCache = new Map<string, { reading: string; confidence: FontConfidence }>();

    let pageOrigin: string | undefined;
    try {
      pageOrigin = source.url ? new URL(source.url).origin : undefined;
    } catch {
      pageOrigin = undefined;
    }

    const identify = (
      family: string,
      weight: number,
    ): { reading: string; confidence: FontConfidence } => {
      const key = `${family.toLowerCase()}|${weight}`;
      const cached = identificationCache.get(key);
      if (cached) return cached;
      const identified = identifyFamily([family], weight, fonts.faces, {
        pageOrigin,
        providerUrls: fonts.providerUrls,
      });
      const value = {
        reading: identified.familyReading,
        confidence: identified.familyConfidence,
      };
      identificationCache.set(key, value);
      return value;
    };

    let index = 0;
    let eligible = 0;
    let capped = false;

    const finish = (): void => {
      const scope: ScanScope = {
        eligibleElements: eligible,
        scannedElements: records.length,
        capped,
        cap,
        durationMs: Date.now() - startedAt,
        skipped: Array.from(skipped, ([reason, count]) => ({ reason, count })),
        inaccessibleFrames: countInaccessibleFrames(doc),
        openShadowRoots: shadowRoots,
        notes: [
          'Hidden elements were skipped, so a hidden mobile navigation does not inflate the inventory.',
          'Other breakpoints and unopened states were not scanned.',
          'Counts are element and property occurrences, not visual area.',
          ...(capped ? [`The scan stopped at the cap of ${cap} elements.`] : []),
          ...fonts.limitations,
        ],
      };

      const fontRecords = buildFontRecords(fonts, records, pageOrigin);
      const stack = detectStack(gatherEvidence(options.globals ?? [], doc));

      try {
        const summaryValue = aggregateSummary({
          records,
          fonts: fontRecords,
          stack,
          source,
          scope,
        });
        // The summary is the whole point of the scan; the per-element records
        // and the element list behind them are scaffolding. Dropping them here
        // rather than waiting for the closure to become garbage is what keeps
        // a 6,000 element page from leaving its DOM pinned in memory (PERF 2).
        records.length = 0;
        elements.length = 0;
        identificationCache.clear();
        skipped.clear();
        resolve(summaryValue);
      } catch (error) {
        records.length = 0;
        elements.length = 0;
        identificationCache.clear();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const step = (timeRemainingMs: () => number): void => {
      if (cancelled) {
        reject(new ScanCancelled());
        return;
      }

      let processed = 0;
      while (index < total && processed < CHUNK_SIZE) {
        if (records.length >= cap) {
          capped = true;
          break;
        }

        const element = elements[index];
        index += 1;
        processed += 1;
        if (element) {
          const skipReason = visibilityOf(element);
          if (skipReason) {
            skipped.set(skipReason, (skipped.get(skipReason) ?? 0) + 1);
          } else {
            eligible += 1;
            try {
              records.push(buildScanRecord(element, getComputedStyle(element), identify));
            } catch {
              skipped.set('hidden', (skipped.get('hidden') ?? 0) + 1);
            }
          }
        }

        // Yield the moment the browser wants the thread back, but never
        // before some progress has been made: a page that is never idle
        // still finishes, one deadline-sized bite at a time.
        if (processed % DEADLINE_EVERY === 0 && timeRemainingMs() <= IDLE_FLOOR_MS) break;
      }

      options.onProgress?.(records.length, total);

      if (capped || index >= total) {
        finish();
        return;
      }
      handle = nextChunk(step);
    };

    handle = nextChunk(step);
  });

  return {
    summary,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      cancelChunk(handle);
      handle = null;
      // Settle immediately: the scheduled chunk that would have rejected has
      // just been cancelled.
      abort?.(new ScanCancelled());
    },
  };
}
