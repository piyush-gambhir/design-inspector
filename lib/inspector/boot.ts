// Boot, state, and messaging for the inspector content script
// (PRD INS-01, INS-05, INS-06, section 17.3).
//
// The background worker injects this script with chrome.scripting.executeScript
// and may inject it more than once, so boot is idempotent: it guards on a
// well-known symbol on window. It also tolerates running with no extension
// APIs at all, which is how the browser test harness drives it.

import type {
  AssetReading,
  ElementSnapshot,
  PageSummary,
  Rect,
  SourceContext,
  StackReport,
} from '../contracts';
import { DEFAULT_SETTINGS } from '../contracts';
import type {
  BackgroundRequest,
  ContentEvent,
  ContentRequest,
  ContentResponse,
  InspectorMode,
  InspectorState,
  MockupState,
  OutlineMode,
  PageTools,
} from '../messages';
import { broadcast, isMessage, sendToBackground } from '../messages';
import { toCss, toTailwind, toTailwindClosest, type StyleCategory } from '../exports';
import { readDocumentFonts, type DocumentFontsResult } from '../readings/fonts';
import { getSettings, onSettingsChanged } from '../storage/settings';
import { listAssets } from './assets';
import { gatherEvidence } from './evidence';
import { detectStack } from '../readings/stack-signatures';
import { applyOutlines, currentOutlineMode } from './outlines';
import {
  createOverlay,
  currentLayoutOverlay,
  currentRulers,
  isElementRendered,
  recordBadgeCollapse,
  setLayoutOverlayEnabled,
  setRulersEnabled,
  type Overlay,
} from './overlay';
import { ancestorChain, buildSnapshot, readSourceContext } from './readings';
import { ScanCancelled, startScan, type ScanRun } from './scan';
import { resolveSelection } from './semantic';
import { COPY_QUIET_MS, createSelection, type SelectionController } from './select';

export const INSPECTOR_KEY = Symbol.for('design-inspector');

/** The surface the browser test harness drives when chrome APIs are absent. */
export interface InspectorApi {
  setMode(mode: InspectorMode): void;
  setOutlines(mode: OutlineMode): void;
  getState(): InspectorState;
  scanSummary(cap?: number, globals?: string[]): Promise<PageSummary>;
  listAssets(): AssetReading[];
  detectStack(globals?: string[]): StackReport;
  overlayRoot(): ShadowRoot | null;
  /** The live value of "prefer semantic parents", for tests and the harness. */
  semanticParents(): boolean;
}

interface InspectorGlobal {
  api: InspectorApi;
}

type ChromeRuntime = typeof chrome.runtime;

function runtimeOrNull(): ChromeRuntime | null {
  try {
    if (typeof chrome === 'undefined') return null;
    return chrome.runtime?.onMessage ? chrome.runtime : null;
  } catch {
    return null;
  }
}

function detectUnsupported(doc: Document): string | null {
  if (!doc.body) return 'This page has no document body to inspect.';
  const type = (doc.contentType || '').toLowerCase();
  if (type && type !== 'text/html' && type !== 'application/xhtml+xml') {
    return `Design Inspector supports HTML pages. This document is ${type}.`;
  }
  return null;
}

function isOffscreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return true;
  return (
    rect.bottom <= 0 ||
    rect.right <= 0 ||
    rect.top >= window.innerHeight ||
    rect.left >= window.innerWidth
  );
}

export function bootInspector(): InspectorApi {
  const container = globalThis as unknown as Record<symbol, InspectorGlobal | undefined>;
  const existing = container[INSPECTOR_KEY];
  if (existing) return existing.api;

  const state: InspectorState = {
    tabId: -1,
    mode: 'off',
    pinned: null,
    pageStale: false,
    unsupportedReason: detectUnsupported(document),
    // Outlines are independent of the mode, so the field is always present.
    outlines: currentOutlineMode(),
    // So is the mockup: it can exist before the inspector is ever switched on.
    mockup: null,
    // The page tools the side panel mirrors, and whether the badge has stepped
    // aside to its dot. Both are refreshed before every state leaves here (W2).
    tools: {
      rulers: currentRulers(),
      semanticParents: DEFAULT_SETTINGS.preferSemanticParents,
      layoutOverlay: currentLayoutOverlay(),
    },
    badgeCollapsed: false,
  };

  let overlay: Overlay | null = null;
  let selection: SelectionController | null = null;
  let pinnedElement: Element | null = null;
  /** Breadcrumb targets, in the same order as snapshot.ancestors. */
  let pinnedAncestors: Element[] = [];
  /** The inline wrapper the last click was promoted away from, if any. */
  let pinnedChild: Element | null = null;
  /**
   * The mockup for this page session. Kept here rather than in the overlay so
   * that switching the inspector off hides it without forgetting it, and a
   * fresh `content.setMockup` brings it straight back (competitive Tier 2).
   */
  let mockup: MockupState | null = null;
  /**
   * "Prefer semantic parents". `Settings.preferSemanticParents` supplies the
   * starting value and keeps supplying it while the user has not touched the
   * badge: a change made in the side panel reaches a page that is already open.
   * The badge toggle is a per-session override, so once it has been pressed the
   * stored setting stops writing over the user's choice until the page reloads.
   */
  let preferSemanticParents = DEFAULT_SETTINGS.preferSemanticParents;
  let semanticParentsOverridden = false;
  let scan: ScanRun | null = null;
  let fontsCache: DocumentFontsResult | null = null;
  /**
   * The page facts a snapshot carries. Only the scroll offset and the capture
   * time change between two readings of the same page at the same size, and
   * the rest costs a `getComputedStyle` on the root element, which a hover
   * frame should not be paying sixty times a second (PERF 3).
   */
  let sourceCache: SourceContext | null = null;
  let historyPatch: {
    push: History['pushState'];
    replace: History['replaceState'];
  } | null = null;

  // -------------------------------------------------------------------------
  // Messaging helpers. Every one of these tolerates a missing chrome.

  function emit(event: ContentEvent): void {
    if (!runtimeOrNull()) return;
    try {
      broadcast(event);
    } catch {
      // A closed side panel and a sleeping worker are both normal.
    }
  }

  /**
   * The live value of every tool the badge and the side panel share. The
   * overlay owns rulers and the layout overlay while it is on screen; with the
   * inspector off, the page-session values are still the honest answer (W2).
   */
  function readTools(): PageTools {
    return {
      rulers: overlay ? overlay.rulersOn() : currentRulers(),
      semanticParents: preferSemanticParents,
      layoutOverlay: overlay ? overlay.layoutOverlayOn() : currentLayoutOverlay(),
    };
  }

  /** Refreshes the mirrored fields so no state leaves here out of date. */
  function syncTools(): void {
    state.tools = readTools();
    state.badgeCollapsed = overlay ? overlay.badgeCollapsed() : false;
  }

  function emitState(): void {
    syncTools();
    emit({ type: 'event.state', state: { ...state } });
  }

  async function ask(request: BackgroundRequest): Promise<string | null> {
    if (!runtimeOrNull()) return 'The extension background is not available.';
    try {
      const response = await sendToBackground(request);
      return response.ok ? null : response.error;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  // -------------------------------------------------------------------------
  // Layout outlines

  function setOutlines(mode: OutlineMode): void {
    applyOutlines(mode);
    state.outlines = currentOutlineMode();
    overlay?.setOutlines(state.outlines);
  }

  /**
   * The coloring the user configured, read straight from storage. The content
   * script can read chrome.storage.local itself, so the background is not in
   * the way; an unavailable storage falls back to 'tag'.
   */
  async function configuredColoring(): Promise<'tag' | 'depth'> {
    try {
      const settings = await getSettings();
      return settings.outlineColoring === 'depth' ? 'depth' : 'tag';
    } catch {
      return 'tag';
    }
  }

  // -------------------------------------------------------------------------
  // Settings the content script follows

  /**
   * Take the stored preference, unless the badge has already overridden it for
   * this page session. The badge is told whenever the value actually changes,
   * so its pressed state always matches what the next click will do.
   */
  function applySemanticParentsSetting(enabled: boolean): void {
    if (semanticParentsOverridden) return;
    preferSemanticParents = enabled;
    overlay?.setSemanticParents(preferSemanticParents);
  }

  async function readSettings(): Promise<void> {
    try {
      const settings = await getSettings();
      applySemanticParentsSetting(settings.preferSemanticParents);
    } catch {
      // Unreadable storage leaves the contract default in place.
    }
  }

  function watchSettings(): void {
    try {
      onSettingsChanged((settings) => applySemanticParentsSetting(settings.preferSemanticParents));
    } catch {
      // A page without chrome.storage simply keeps the value it booted with.
    }
  }

  /** Badge button and Alt+O: off becomes the configured coloring, and back. */
  async function toggleOutlines(): Promise<void> {
    const next = state.outlines && state.outlines !== 'off' ? 'off' : await configuredColoring();
    setOutlines(next);
    emitState();
  }

  // -------------------------------------------------------------------------
  // Readings

  function getFonts(): DocumentFontsResult {
    if (!fontsCache) fontsCache = readDocumentFonts(document);
    return fontsCache;
  }

  function invalidateFonts(): void {
    fontsCache = null;
  }

  /** Rebuilt when the viewport changes; refreshed per reading where it must be. */
  function currentSource(): SourceContext {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (
      !sourceCache ||
      sourceCache.viewport.width !== width ||
      sourceCache.viewport.height !== height
    ) {
      sourceCache = readSourceContext(document);
    }
    return {
      ...sourceCache,
      capturedAt: new Date().toISOString(),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  }

  function snapshotOf(element: Element, deep: boolean): ElementSnapshot {
    return buildSnapshot(element, {
      deep,
      fonts: getFonts(),
      source: currentSource(),
      // Only the pinned panel's breadcrumb reads the chain, and a hover card
      // has no breadcrumb, so the hover path does not build one.
      ancestors: deep,
    });
  }

  function exporter<T>(run: () => T): T | null {
    try {
      return run();
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Selection

  function pin(
    element: Element,
    options: { focus?: boolean; child?: Element | null } = {},
  ): void {
    if (!overlay) return;
    // A plain selection click releases a locked measurement (PRD LAY-02).
    overlay.setMeasure(null, { locked: false });
    pinnedElement = element;
    pinnedChild = options.child ?? null;
    pinnedAncestors = ancestorChain(element).map((entry) => entry.element);
    const snapshot = snapshotOf(element, true);
    state.pinned = snapshot;
    overlay.setPinned(snapshot, element, { child: pinnedChild });
    selection?.watch(element);
    if (options.focus) overlay.focusPanel();
    emit({ type: 'event.pinned', snapshot });
    emitState();
  }

  /**
   * A click's real target. A click that lands on a transparent inline wrapper
   * selects the semantic parent instead, and remembers the wrapper so the
   * breadcrumb can offer it (competitive tester note, PRD INS-04). A click on a
   * link the size of a tile selects the heading under the pointer, and the link
   * stays in the breadcrumb as its parent (tester UX note 6).
   */
  function selectFromClick(element: Element, point?: { x: number; y: number }): void {
    const { target, wrapper } = resolveSelection(element, preferSemanticParents, undefined, {
      point: point ?? null,
    });
    pin(target, { child: wrapper });
  }

  function unpin(): void {
    pinnedElement = null;
    pinnedChild = null;
    pinnedAncestors = [];
    state.pinned = null;
    overlay?.setPinned(null, null, { child: null });
    selection?.watch(null);
    emit({ type: 'event.pinned', snapshot: null });
    emitState();
  }

  function refreshPinned(): void {
    if (!pinnedElement || !overlay) return;
    if (!pinnedElement.isConnected) {
      overlay.markPinnedMissing();
      return;
    }
    // A pinned element that a breakpoint has hidden is still the user's
    // selection, so the last readings stay on screen, dimmed, rather than
    // being silently refreshed into nonsense (PRD 19.3).
    if (!isElementRendered(pinnedElement)) {
      overlay.setPinnedHidden(true);
      return;
    }
    overlay.setPinnedHidden(false);
    pinnedAncestors = ancestorChain(pinnedElement).map((entry) => entry.element);
    const snapshot = snapshotOf(pinnedElement, true);
    state.pinned = snapshot;
    overlay.setPinned(snapshot, pinnedElement, { child: pinnedChild });
    emit({ type: 'event.pinned', snapshot });
  }

  function navigate(direction: 'up' | 'down'): void {
    if (!pinnedElement) return;
    const next =
      direction === 'up' ? pinnedElement.parentElement : pinnedElement.firstElementChild;
    if (!next) return;
    if (overlay?.owns(next)) return;
    if (next.tagName.toLowerCase() === 'html') return;
    pin(next, { focus: true });
  }

  function onEscape(): void {
    if (overlay?.closeMenu()) return;
    // A locked edge reading and a locked measurement are both things Escape
    // lets go of before it touches the selection.
    if (overlay?.edgesLocked()) {
      overlay.setEdges(null);
      return;
    }
    if (overlay?.measureLocked()) {
      overlay.setMeasure(null, { locked: false });
      return;
    }
    if (pinnedElement) {
      unpin();
      return;
    }
    applyMode('off');
    emitState();
  }

  // -------------------------------------------------------------------------
  // Mockup overlay (competitive Tier 2 item 1)

  /** The state the side panel persists: everything but the image itself. */
  function mockupSettings(): Omit<MockupState, 'dataUrl'> | null {
    if (!mockup) return null;
    const { dataUrl: _dataUrl, ...settings } = mockup;
    return settings;
  }

  function setMockup(next: MockupState | null): void {
    mockup = next;
    state.mockup = mockupSettings();
    if (next) {
      // A mockup can be set before the inspector is ever switched on, so the
      // surfaces are created for it without changing the mode.
      ensureSurfaces();
      overlay?.setMockup(next);
    } else {
      overlay?.setMockup(null);
      // With the inspector off, the overlay only ever existed to carry the
      // mockup, so removing the mockup leaves the page as we found it.
      if (state.mode === 'off') {
        overlay?.destroy();
        overlay = null;
      }
    }
    emitState();
  }

  /** The image moved on the page. The panel writes the new offset to storage. */
  function onMockupMoved(settings: Omit<MockupState, 'dataUrl'>): void {
    if (!mockup) return;
    mockup = { ...mockup, ...settings };
    state.mockup = mockupSettings();
    emitState();
  }

  function toggleMockupVisible(): void {
    if (!mockup) return;
    setMockup({ ...mockup, visible: !mockup.visible });
  }

  // -------------------------------------------------------------------------
  // Overlay and listener lifecycle

  function ensureSurfaces(): void {
    if (!overlay) {
      overlay = createOverlay({
        onExit: () => {
          applyMode('off');
          emitState();
        },
        onTogglePaused: () => {
          applyMode(state.mode === 'paused' ? 'active' : 'paused');
          emitState();
        },
        onToggleOutlines: () => {
          void toggleOutlines();
        },
        onToggleRulers: () => {
          overlay?.setRulers(!(overlay?.rulersOn() ?? false));
          // The side panel mirrors these toggles, so a badge press is news (W3).
          emitState();
        },
        onToggleSemanticParents: () => {
          semanticParentsOverridden = true;
          preferSemanticParents = !preferSemanticParents;
          overlay?.setSemanticParents(preferSemanticParents);
          emitState();
        },
        onToggleLayoutOverlay: () => {
          emitState();
        },
        onToggleBadge: () => {
          emitState();
        },
        onToggleMockupVisible: () => toggleMockupVisible(),
        onUnpin: () => unpin(),
        onSelectAncestor: (index) => {
          const target = pinnedAncestors[index];
          if (target && target.isConnected && !overlay?.owns(target)) {
            pin(target, { focus: true });
          }
        },
        onSelectChild: () => {
          const child = pinnedChild;
          if (child && child.isConnected && !overlay?.owns(child)) {
            pin(child, { focus: true });
          }
        },
        onNavigate: (direction) => navigate(direction),
        onReread: () => refreshPinned(),
        onDownload: (request) => {
          if (request.url) {
            return ask({ type: 'download.url', url: request.url, filename: request.filename });
          }
          if (request.dataUrl) {
            return ask({
              type: 'download.data',
              dataUrl: request.dataUrl,
              filename: request.filename,
            });
          }
          return Promise.resolve('This asset has no downloadable source.');
        },
        onAssetDetails: async (url) => {
          if (!runtimeOrNull()) return 'The extension background is not available.';
          try {
            // The content script does not know its own tab id; the worker
            // fills it in from the sender when it is -1.
            const response = await sendToBackground({
              type: 'assets.request',
              tabId: state.tabId,
              enrich: true,
            });
            if (!response.ok) return response.error;
            if (!('assets' in response)) return 'No asset details were returned.';
            const match = response.assets.find((asset) => asset.url === url);
            if (!match) return 'This asset is not in the page asset list.';
            return { fileSize: match.fileSize, mimeType: match.mimeType };
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        },
        onSave: (request) => {
          if (!state.pinned) return Promise.resolve('Nothing is pinned to save.');
          return ask({
            type: 'reference.save',
            snapshot: state.pinned,
            title: request.title,
            note: request.note,
            captureScreenshot: request.captureScreenshot,
          });
        },
        cssFor: (category: StyleCategory) => {
          if (!state.pinned) return null;
          const snapshot = state.pinned;
          return exporter(() => toCss(snapshot, category));
        },
        tailwindFor: (category: StyleCategory) => {
          if (!state.pinned) return null;
          const snapshot = state.pinned;
          const output = exporter(() => toTailwind(snapshot, category));
          if (!output) return null;
          return output.unsupportedCss
            ? `${output.classes}\n\n/* ${output.assumption} */\n${output.unsupportedCss}`
            : `${output.classes}\n\n/* ${output.assumption} */`;
        },
        tailwindClosestFor: (category: StyleCategory) => {
          if (!state.pinned) return null;
          const snapshot = state.pinned;
          // The adapter belongs to another workstream and currently throws;
          // `exporter` turns that into a null the button reports honestly.
          const output = exporter(() => toTailwindClosest(snapshot, category));
          if (!output) return null;
          const deviations = output.deviations
            .map(
              (entry) =>
                `/* ${entry.property}: observed ${entry.observed}, class gives ${entry.suggested} (${entry.delta}) */`,
            )
            .join('\n');
          return [
            output.classes,
            '',
            `/* ${output.assumption} */`,
            deviations,
            output.unsupportedCss,
          ]
            .filter((part) => part !== '')
            .join('\n');
        },
        onMockupMoved: (settings) => onMockupMoved(settings),
      });
      overlay.setSemanticParents(preferSemanticParents);
      overlay.setMockup(mockup);
    }

    if (!selection) {
      selection = createSelection({
        owns: (node) => overlay?.owns(node) ?? false,
        onHover: (element) => {
          if (!overlay || state.mode !== 'active' || pinnedElement) return;
          if (!element) {
            overlay.setHover(null, null);
            return;
          }
          overlay.setHover(snapshotOf(element, false), element);
        },
        onPin: (element, point) => selectFromClick(element, point),
        onEscape,
        onViewportChange: () => overlay?.reposition(),
        onRefreshPinned: () => refreshPinned(),
        onPinnedRemoved: () => overlay?.markPinnedMissing(),
        onNavigate: (direction) => navigate(direction),
        onReread: () => refreshPinned(),
        onToggleOutlines: () => {
          void toggleOutlines();
        },
        onMeasureTarget: (element) => {
          if (!overlay || !pinnedElement) return;
          overlay.setMeasure(element);
        },
        onMeasureEnd: () => {
          // Releasing Alt returns to normal hover unless the user locked it.
          if (!overlay || overlay.measureLocked()) return;
          overlay.setMeasure(null, { locked: false });
        },
        onMeasureLock: (element) => {
          overlay?.setMeasure(element, { locked: true });
        },
        onEdgeProbe: (point) => {
          if (!overlay) return;
          // A locked reading is the user's; a null probe must not drop it.
          if (point === null && overlay.edgesLocked()) return;
          overlay.setEdges(point);
        },
        onEdgeLock: (point) => {
          overlay?.setEdges(point, { locked: true });
        },
        // The mockup image takes no pointer events of its own, so its drag is
        // offered every pointerdown and claims only the ones over it.
        mockupDragStart: (point) => overlay?.mockupDragStart(point) ?? false,
        mockupDragMove: (point) => overlay?.mockupDragMove(point),
        mockupDragEnd: () => overlay?.mockupDragEnd(),
        edgesLocked: () => overlay?.edgesLocked() ?? false,
        pinnedElement: () => pinnedElement,
        panelHasFocus: () => overlay?.panelHasFocus() ?? false,
        mayRefresh: () => {
          if (!overlay) return false;
          if (overlay.hasTextSelection()) return false;
          return overlay.msSinceCopy() > COPY_QUIET_MS;
        },
      });
    }
  }

  /**
   * A same-document route change: the document is the same one, so the mode
   * and the overlay stay, while every page-derived reading is stale and the
   * old selection no longer means anything (PRD INS-01).
   */
  function onPageChanged(): void {
    state.pageStale = true;
    if (pinnedElement) unpin();
    overlay?.setHover(null, null);
    overlay?.clearHighlight();
    invalidateFonts();
    // A route change means a new url and title, so the cached page facts are
    // about the page that just left.
    sourceCache = null;
    emit({ type: 'event.pageChanged', url: location.href });
    emitState();
  }

  function patchHistory(): void {
    if (historyPatch) return;
    const push = history.pushState;
    const replace = history.replaceState;
    historyPatch = { push, replace };

    history.pushState = function patchedPushState(
      this: History,
      ...args: Parameters<History['pushState']>
    ): void {
      push.apply(this, args);
      onPageChanged();
    };
    history.replaceState = function patchedReplaceState(
      this: History,
      ...args: Parameters<History['replaceState']>
    ): void {
      replace.apply(this, args);
      onPageChanged();
    };

    window.addEventListener('popstate', onPageChanged);
    window.addEventListener('hashchange', onPageChanged);
  }

  function unpatchHistory(): void {
    if (!historyPatch) return;
    history.pushState = historyPatch.push;
    history.replaceState = historyPatch.replace;
    historyPatch = null;
    window.removeEventListener('popstate', onPageChanged);
    window.removeEventListener('hashchange', onPageChanged);
  }

  function cancelScan(): void {
    scan?.cancel();
    scan = null;
    overlay?.setScanProgress(0, null);
  }

  function applyMode(mode: InspectorMode): void {
    if (state.unsupportedReason) {
      state.mode = 'off';
      return;
    }
    state.mode = mode;

    if (mode === 'off') {
      cancelScan();
      unpatchHistory();
      selection?.destroy();
      selection = null;
      pinnedElement = null;
      pinnedChild = null;
      state.pinned = null;
      overlay?.setMode('off');
      overlay?.destroy();
      overlay = null;
      // Leaving the inspector leaves no trace in the page, outlines included.
      // The mockup goes with the overlay, but it is not forgotten: it is still
      // in `mockup`, and a fresh content.setMockup brings it back.
      setOutlines('off');
      return;
    }

    ensureSurfaces();
    patchHistory();
    overlay?.setMode(mode);
    // 'paused' keeps outlines on: the point of pausing is to scroll and click
    // the page while still reading its skeleton.
    overlay?.setOutlines(state.outlines ?? 'off');
    selection?.setMode(mode);
    if (mode === 'paused') overlay?.setHover(null, null);
  }

  // -------------------------------------------------------------------------
  // Request handling

  function stateResponse(): ContentResponse {
    syncTools();
    return { ok: true, state: { ...state } };
  }

  // -------------------------------------------------------------------------
  // Page tools the side panel drives (W2)

  /** A partial update: a tool the caller left out is not touched. */
  function setTools(tools: Partial<PageTools>): void {
    if (tools.rulers !== undefined) {
      if (overlay) overlay.setRulers(tools.rulers);
      else setRulersEnabled(tools.rulers);
    }
    if (tools.semanticParents !== undefined) {
      // Same override rule as the badge button: once the choice is made here,
      // the stored setting stops writing over it for this page session.
      semanticParentsOverridden = true;
      preferSemanticParents = tools.semanticParents;
      overlay?.setSemanticParents(preferSemanticParents);
    }
    if (tools.layoutOverlay !== undefined) {
      if (overlay) overlay.setLayoutOverlay(tools.layoutOverlay);
      else setLayoutOverlayEnabled(tools.layoutOverlay);
    }
    emitState();
  }

  function setBadge(collapsed: boolean, reason: 'sidepanel' | 'user'): void {
    // A page with no badge on it yet still records the decision, so a later
    // activation starts in the state the side panel's presence asked for.
    if (overlay) overlay.setBadgeCollapsed(collapsed, reason);
    else recordBadgeCollapse(collapsed, reason);
    emitState();
  }

  async function runScan(cap: number, globals: string[] | undefined): Promise<ContentResponse> {
    cancelScan();
    const run = startScan({
      cap,
      globals,
      onProgress: (scanned, total) => {
        overlay?.setScanProgress(scanned, total);
        emit({ type: 'event.scanProgress', scanned, total });
      },
    });
    scan = run;
    try {
      const summary = await run.summary;
      if (scan === run) scan = null;
      state.pageStale = false;
      overlay?.setScanProgress(0, null);
      emitState();
      return { ok: true, summary };
    } catch (error) {
      if (scan === run) scan = null;
      overlay?.setScanProgress(0, null);
      if (error instanceof ScanCancelled) {
        return { ok: false, error: 'Scan cancelled' };
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function pinnedRect(): { rect: Rect | null; devicePixelRatio: number } {
    if (!pinnedElement || !pinnedElement.isConnected) {
      return { rect: null, devicePixelRatio: window.devicePixelRatio };
    }
    const rect = pinnedElement.getBoundingClientRect();
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      devicePixelRatio: window.devicePixelRatio,
    };
  }

  async function handle(request: ContentRequest): Promise<ContentResponse> {
    if (state.unsupportedReason) {
      if (request.type === 'content.getState') return stateResponse();
      if (request.type === 'content.ping') return { ok: true };
      return { ok: false, error: state.unsupportedReason };
    }

    switch (request.type) {
      case 'content.ping':
        return { ok: true };

      case 'content.getState':
        return stateResponse();

      case 'content.setMode':
        applyMode(request.mode);
        emitState();
        return stateResponse();

      case 'content.setOutlines':
        setOutlines(request.mode);
        emitState();
        return stateResponse();

      case 'content.setTools':
        setTools(request.tools);
        return stateResponse();

      case 'content.setBadge':
        setBadge(request.collapsed, request.reason);
        return stateResponse();

      case 'content.notifyNavigation':
        onPageChanged();
        return stateResponse();

      case 'content.cancelScan':
        cancelScan();
        return { ok: true };

      case 'content.getPinnedRect': {
        const { rect, devicePixelRatio } = pinnedRect();
        return { ok: true, rect, devicePixelRatio };
      }

      case 'content.setOverlayVisible':
        overlay?.setVisible(request.visible);
        return { ok: true };

      case 'content.highlight': {
        ensureSurfaces();
        const elements: Element[] = [];
        for (const locator of request.locators.slice(0, 20)) {
          try {
            const found = document.querySelector(locator);
            if (found && !overlay?.owns(found)) elements.push(found);
          } catch {
            // An unusable locator is skipped rather than failing the batch.
          }
        }
        overlay?.highlight(elements);
        return { ok: true };
      }

      case 'content.clearHighlight':
        overlay?.clearHighlight();
        return { ok: true };

      case 'content.select': {
        let element: Element | null = null;
        try {
          element = document.querySelector(request.locator);
        } catch {
          return { ok: false, error: 'That locator is not a valid selector.' };
        }
        if (!element) return { ok: false, error: 'Element is no longer on the page' };
        if (isOffscreen(element)) {
          // Scrolling the page is a side effect on the site, so it happens only
          // when the caller asked for it (PRD INS-03).
          if (!request.scroll) return { ok: false, error: 'Element is offscreen' };
          try {
            element.scrollIntoView({ block: 'center' });
          } catch {
            // A browser without the options form still scrolled, or could not.
          }
        }
        if (state.mode === 'off') applyMode('active');
        else ensureSurfaces();
        pin(element);
        return stateResponse();
      }

      case 'content.setMockup':
        setMockup(request.mockup);
        return stateResponse();

      case 'content.scanSummary':
        return runScan(request.cap, request.globals);

      case 'content.listAssets':
        return { ok: true, assets: listAssets() };

      case 'content.detectStack':
        return { ok: true, stack: detectStack(gatherEvidence(request.globals ?? [])) };

      default:
        return { ok: false, error: 'Unsupported request' };
    }
  }

  // -------------------------------------------------------------------------
  // Listener installation

  const runtime = runtimeOrNull();
  if (runtime) {
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isMessage(message)) return undefined;
      if (!message.type.startsWith('content.')) return undefined;

      handle(message as ContentRequest).then(sendResponse, (error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies ContentResponse);
      });
      return true;
    });
  }

  try {
    document.fonts?.addEventListener?.('loadingdone', invalidateFonts);
  } catch {
    // Font load events are an optimisation, not a requirement.
  }

  // A page leaving should not be able to take our stylesheet with it into a
  // back/forward cache entry and come back outlined.
  window.addEventListener('pagehide', () => {
    applyOutlines('off');
    state.outlines = 'off';
  });

  const api: InspectorApi = {
    setMode(mode) {
      applyMode(mode);
      emitState();
    },
    setOutlines(mode) {
      setOutlines(mode);
      emitState();
    },
    getState() {
      return { ...state };
    },
    async scanSummary(cap = 5000, globals) {
      const response = await runScan(cap, globals);
      if ('summary' in response && response.ok) return response.summary;
      throw new Error(response.ok ? 'No summary was produced.' : response.error);
    },
    listAssets() {
      return listAssets();
    },
    detectStack(globals) {
      return detectStack(gatherEvidence(globals ?? []));
    },
    overlayRoot() {
      return overlay?.root ?? null;
    },
    semanticParents() {
      return preferSemanticParents;
    },
  };

  // The stored preference is read once at boot and then followed until the
  // badge overrides it. Both are fire and forget: nothing below waits on them.
  void readSettings();
  watchSettings();

  container[INSPECTOR_KEY] = { api };
  return api;
}
