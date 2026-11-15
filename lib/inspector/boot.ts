







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
import {
  readDocumentFonts,
  resetRenderCheckCache,
  type DocumentFontsResult,
} from '../readings/fonts';
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


export interface InspectorApi {
  setMode(mode: InspectorMode): void;
  setOutlines(mode: OutlineMode): void;
  getState(): InspectorState;
  scanSummary(cap?: number, globals?: string[]): Promise<PageSummary>;
  listAssets(): AssetReading[];
  detectStack(globals?: string[]): StackReport;
  overlayRoot(): ShadowRoot | null;

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

    outlines: currentOutlineMode(),

    mockup: null,


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

  let pinnedAncestors: Element[] = [];

  let pinnedChild: Element | null = null;





  let mockup: MockupState | null = null;







  let preferSemanticParents = DEFAULT_SETTINGS.preferSemanticParents;
  let semanticParentsOverridden = false;
  let scan: ScanRun | null = null;
  let fontsCache: DocumentFontsResult | null = null;






  let sourceCache: SourceContext | null = null;
  let historyPatch: {
    push: History['pushState'];
    replace: History['replaceState'];
  } | null = null;




  function emit(event: ContentEvent): void {
    if (!runtimeOrNull()) return;
    try {
      broadcast(event);
    } catch {

    }
  }






  function readTools(): PageTools {
    return {
      rulers: overlay ? overlay.rulersOn() : currentRulers(),
      semanticParents: preferSemanticParents,
      layoutOverlay: overlay ? overlay.layoutOverlayOn() : currentLayoutOverlay(),
    };
  }


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




  function setOutlines(mode: OutlineMode): void {
    applyOutlines(mode);
    state.outlines = currentOutlineMode();
    overlay?.setOutlines(state.outlines);
  }






  async function configuredColoring(): Promise<'tag' | 'depth'> {
    try {
      const settings = await getSettings();
      return settings.outlineColoring === 'depth' ? 'depth' : 'tag';
    } catch {
      return 'tag';
    }
  }









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

    }
  }

  function watchSettings(): void {
    try {
      onSettingsChanged((settings) => applySemanticParentsSetting(settings.preferSemanticParents));
    } catch {

    }
  }


  async function toggleOutlines(): Promise<void> {
    const next = state.outlines && state.outlines !== 'off' ? 'off' : await configuredColoring();
    setOutlines(next);
    emitState();
  }




  function getFonts(): DocumentFontsResult {
    if (!fontsCache) fontsCache = readDocumentFonts(document);
    return fontsCache;
  }

  function invalidateFonts(): void {
    fontsCache = null;


    resetRenderCheckCache();
  }


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




  function pin(
    element: Element,
    options: { focus?: boolean; child?: Element | null } = {},
  ): void {
    if (!overlay) return;

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





  function mockupSettings(): Omit<MockupState, 'dataUrl'> | null {
    if (!mockup) return null;
    const { dataUrl: _dataUrl, ...settings } = mockup;
    return settings;
  }

  function setMockup(next: MockupState | null): void {
    mockup = next;
    state.mockup = mockupSettings();
    if (next) {


      ensureSurfaces();
      overlay?.setMockup(next);
    } else {
      overlay?.setMockup(null);


      if (state.mode === 'off') {
        overlay?.destroy();
        overlay = null;
      }
    }
    emitState();
  }


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
        onIdentifyFont: async (url) => {
          if (!runtimeOrNull()) return 'The extension background is not available.';
          try {


            const response = await sendToBackground({ type: 'font.identify', url });
            if (!response.ok) return response.error;
            if (!('identity' in response)) return 'The font file returned no identity.';
            return response.identity;
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

          if (!overlay || overlay.measureLocked()) return;
          overlay.setMeasure(null, { locked: false });
        },
        onMeasureLock: (element) => {
          overlay?.setMeasure(element, { locked: true });
        },
        onEdgeProbe: (point) => {
          if (!overlay) return;

          if (point === null && overlay.edgesLocked()) return;
          overlay.setEdges(point);
        },
        onEdgeLock: (point) => {
          overlay?.setEdges(point, { locked: true });
        },


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






  function onPageChanged(): void {
    state.pageStale = true;
    if (pinnedElement) unpin();
    overlay?.setHover(null, null);
    overlay?.clearHighlight();
    invalidateFonts();


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



      setOutlines('off');
      return;
    }

    ensureSurfaces();
    patchHistory();
    overlay?.setMode(mode);


    overlay?.setOutlines(state.outlines ?? 'off');
    selection?.setMode(mode);
    if (mode === 'paused') overlay?.setHover(null, null);
  }




  function stateResponse(): ContentResponse {
    syncTools();
    return { ok: true, state: { ...state } };
  }





  function setTools(tools: Partial<PageTools>): void {
    if (tools.rulers !== undefined) {
      if (overlay) overlay.setRulers(tools.rulers);
      else setRulersEnabled(tools.rulers);
    }
    if (tools.semanticParents !== undefined) {


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


          if (!request.scroll) return { ok: false, error: 'Element is offscreen' };
          try {
            element.scrollIntoView({ block: 'center' });
          } catch {

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

  }



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



  void readSettings();
  watchSettings();

  container[INSPECTOR_KEY] = { api };
  return api;
}
