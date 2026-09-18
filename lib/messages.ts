// Message protocol between the content script, background worker, popup, and
// side panel. Every message is a discriminated union member keyed on `type`.
//
// Routing:
// - Popup and side panel talk to the background worker with chrome.runtime.sendMessage.
// - The background worker talks to a tab's content script with chrome.tabs.sendMessage.
// - The content script broadcasts events with chrome.runtime.sendMessage; the
//   background worker and side panel both listen.
//
// All page-derived strings are untrusted input. Consumers render them as text.

import type {
  AssetReading,
  ElementSnapshot,
  PageSummary,
  Rect,
  SavedReference,
  StackReport,
} from './contracts';

export type InspectorMode = 'off' | 'active' | 'paused';

/**
 * Layout outlines (Pesticide-style): every element gets a thin outline so the
 * page's layout skeleton is visible at once. 'tag' colors by element type,
 * 'depth' colors by nesting level. Independent of hover and pin; survives
 * 'paused' so the user can scroll and click with outlines on.
 */
export type OutlineMode = 'off' | 'tag' | 'depth';

/**
 * A reference image laid over the page at adjustable opacity, offset and scale
 * (PerfectPixel-style). The image travels as a data URL; the side panel keeps
 * the original blob in IndexedDB per origin.
 */
export interface MockupState {
  /** data: URL of the image. */
  dataUrl: string;
  /** 0..1 */
  opacity: number;
  /** CSS px offset from the page's top-left, in document coordinates. */
  x: number;
  y: number;
  /** 1 = natural size. */
  scale: number;
  visible: boolean;
  /** 'normal' or 'difference' blend for pixel comparison. */
  blend: 'normal' | 'difference';
  /** True locks pointer dragging of the mockup. */
  locked: boolean;
}

export interface InspectorState {
  tabId: number;
  mode: InspectorMode;
  /** Present while an element is pinned. */
  pinned: ElementSnapshot | null;
  /** True after a same-document route change until the summary refreshes. */
  pageStale: boolean;
  /** Set when the page cannot be inspected (browser page, denied access). */
  unsupportedReason: string | null;
  /** Current layout-outline mode. Absent means 'off'. */
  outlines?: OutlineMode;
  /** Current mockup overlay, without the image (too large to echo). */
  mockup?: Omit<MockupState, 'dataUrl'> | null;
  /** Page tools the badge also exposes, so the side panel can mirror them. */
  tools?: PageTools;
  /** True while the badge is collapsed to its dot (for example because the side panel is open). */
  badgeCollapsed?: boolean;
}

/** On-page tool toggles that both the badge and the side panel can drive. */
export interface PageTools {
  rulers: boolean;
  semanticParents: boolean;
  layoutOverlay: boolean;
}

// ---------------------------------------------------------------------------
// Requests handled by the background worker (from popup / side panel)

export type BackgroundRequest =
  | { type: 'inspector.toggle'; tabId: number }
  | { type: 'inspector.setMode'; tabId: number; mode: InspectorMode }
  | { type: 'inspector.getState'; tabId: number }
  | { type: 'outlines.set'; tabId: number; mode: OutlineMode }
  /** Partial update of the on-page tools from the side panel. */
  | { type: 'tools.set'; tabId: number; tools: Partial<PageTools> }
  /**
   * Sent by the side panel on mount with `open: true` and on unmount with
   * `open: false` (also inferred by the background from the panel's port
   * disconnecting). The background collapses the badge while a panel is open.
   */
  | { type: 'sidepanel.presence'; tabId: number; open: boolean }
  | { type: 'inspector.openSidePanel'; tabId: number }
  | { type: 'download.url'; url: string; filename: string }
  | { type: 'download.data'; dataUrl: string; filename: string }
  | { type: 'screenshot.capture'; tabId: number; rect: Rect; devicePixelRatio: number }
  | { type: 'summary.request'; tabId: number }
  /** Cancels a running scan in that tab. */
  | { type: 'summary.cancel'; tabId: number }
  /** `enrich` true also HEAD-fetches file size and MIME from each asset's host. Default false. */
  | { type: 'assets.request'; tabId: number; enrich?: boolean }
  | { type: 'stack.request'; tabId: number }
  | { type: 'element.highlight'; tabId: number; locators: string[] }
  /** `scroll` true scrolls an offscreen match into view first (user asked). */
  | { type: 'element.select'; tabId: number; locator: string; scroll?: boolean }
  /** Pixel-perfect mockup overlay (competitive Tier 2). null clears it. */
  | { type: 'mockup.set'; tabId: number; mockup: MockupState | null }
  | { type: 'element.clearHighlight'; tabId: number }
  /**
   * Sent by the content script's Save button (tabId comes from sender.tab) or by
   * the side panel (which passes tabId explicitly).
   */
  | {
      type: 'reference.save';
      tabId?: number;
      snapshot: ElementSnapshot | PageSummary;
      title: string;
      note: string;
      captureScreenshot: boolean;
    };

export type BackgroundResponse =
  | { ok: true; state: InspectorState }
  | { ok: true; summary: PageSummary }
  | { ok: true; assets: AssetReading[] }
  | { ok: true; stack: StackReport }
  | { ok: true; screenshotDataUrl: string; isCrop: boolean }
  /** `warning` is set when the reference saved but an optional step (screenshot) failed. */
  | { ok: true; reference: SavedReference; warning?: string }
  | { ok: true; downloadId: number }
  | { ok: true }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Requests handled by the content script (from background)

export type ContentRequest =
  | { type: 'content.ping' }
  | { type: 'content.setMode'; mode: InspectorMode }
  | { type: 'content.setOutlines'; mode: OutlineMode }
  | { type: 'content.setTools'; tools: Partial<PageTools> }
  /** Collapse or expand the badge. `reason` lets the badge explain itself on hover. */
  | { type: 'content.setBadge'; collapsed: boolean; reason: 'sidepanel' | 'user' }
  /**
   * The background saw the tab's URL change while this content script stayed
   * alive (same-document navigation). The script marks page data stale, clears
   * the pinned element, and broadcasts event.pageChanged (PRD INS-01).
   */
  | { type: 'content.notifyNavigation'; url: string }
  | { type: 'content.getState' }
  /** `globals` = window property names found by the background's MAIN-world probe. */
  | { type: 'content.scanSummary'; cap: number; globals?: string[] }
  | { type: 'content.cancelScan' }
  | { type: 'content.listAssets' }
  | { type: 'content.detectStack'; globals?: string[] }
  | { type: 'content.highlight'; locators: string[] }
  | { type: 'content.select'; locator: string; scroll?: boolean }
  | { type: 'content.setMockup'; mockup: MockupState | null }
  | { type: 'content.clearHighlight' }
  | { type: 'content.getPinnedRect' }
  /** Hide every overlay node before a screenshot, show again after. */
  | { type: 'content.setOverlayVisible'; visible: boolean };

export type ContentResponse =
  | { ok: true; state: InspectorState }
  | { ok: true; summary: PageSummary }
  | { ok: true; assets: AssetReading[] }
  | { ok: true; stack: StackReport }
  | { ok: true; rect: Rect | null; devicePixelRatio: number }
  | { ok: true }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Events broadcast by the content script (to background and side panel)
//
// A content script does not know its own tab id, so it omits `tabId` (and sets
// InspectorState.tabId to -1). The background reads `sender.tab.id`, stamps it
// onto the event, and re-broadcasts. Extension pages should trust the stamped
// `tabId` (or `state.tabId`) and fall back to `sender.tab?.id` only for events
// that arrive straight from a tab.

export type ContentEvent =
  | { type: 'event.state'; state: InspectorState }
  | { type: 'event.pinned'; tabId?: number; snapshot: ElementSnapshot | null }
  | { type: 'event.pageChanged'; tabId?: number; url: string }
  | { type: 'event.scanProgress'; tabId?: number; scanned: number; total: number };

/** Emitted by the side panel or background when the saved collection changes. */
export type StorageEvent = { type: 'event.savedChanged'; references: SavedReference[] };

export type AnyMessage =
  | BackgroundRequest
  | ContentRequest
  | ContentEvent
  | StorageEvent;

// ---------------------------------------------------------------------------
// Typed helpers

export function isMessage(value: unknown): value is AnyMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

export async function sendToBackground<R extends BackgroundResponse = BackgroundResponse>(
  request: BackgroundRequest,
): Promise<R> {
  const response = (await chrome.runtime.sendMessage(request)) as R | undefined;
  if (!response) return { ok: false, error: 'No response from background' } as R;
  return response;
}

export async function sendToTab<R extends ContentResponse = ContentResponse>(
  tabId: number,
  request: ContentRequest,
): Promise<R> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, request)) as R | undefined;
    if (!response) return { ok: false, error: 'No response from content script' } as R;
    return response;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) } as R;
  }
}

export function broadcast(event: ContentEvent | StorageEvent): void {
  // Fire and forget. No listener is a normal condition (side panel closed).
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}
