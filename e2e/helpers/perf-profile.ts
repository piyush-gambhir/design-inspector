// The measurement engine behind e2e/perf-profile.spec.ts and `pnpm perf`.
//
// What it does, and why it is built this way:
//
//   CDP Performance.getMetrics is the only source that separates script time
//   from style and layout time for a whole renderer, and the inspector's
//   content script shares the page's renderer, so its cost lands in the same
//   counters. Every window is a fixed wall-clock slice, and every number is
//   reported as a rate per second so the windows compare directly.
//
//   Long tasks come from a PerformanceObserver installed in the page's main
//   world before anything else. Long tasks are per-frame, not per-world, so a
//   main-world observer sees the content script's tasks too.
//
//   Live timers are counted in BOTH worlds. The page's main world is wrapped
//   from an init script; the extension's isolated world is wrapped by injecting
//   the same wrapper through chrome.scripting.executeScript before the
//   inspector is ever switched on, which lands in the very world the content
//   script later boots into. The isolated-world numbers are the extension's
//   alone, which is what the budget is about; the main-world numbers are the
//   page's own noise and are reported only as context.
//
//   Heap is sampled after an explicit HeapProfiler.collectGarbage on both ends
//   of a window, so a delta is a retained-bytes delta and not a GC artefact.

import type { BrowserContext, CDPSession, Page, Worker } from '@playwright/test';
import { sendBackground, tabIdFor, type ExtensionSession } from './extension';

export const DEFAULT_WINDOW_MS = 10_000;

/** A 2x2 transparent PNG: enough to be a real mockup layer, no decode cost. */
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAACZgbYnAAAAFElEQVR4' +
  'AWP8//8/AzJgYmBgYAAAHAAD/1lC1wAAAABJRU5ErkJggg==';

export interface WindowSample {
  id: string;
  name: string;
  /** Wall-clock length of the window, in ms. */
  windowMs: number;
  /** CDP renderer counters, in ms accumulated over the window. */
  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
  layoutCount: number;
  styleCount: number;
  /** Long tasks recorded by the page's PerformanceObserver during the window. */
  longTasks: number;
  maxLongTaskMs: number;
  /** Heap retained at the end minus at the start, both after a forced GC. */
  heapDeltaMb: number;
  heapEndMb: number;
  /** Extension isolated world: handles still alive when the window ended. */
  extLiveTimeouts: number;
  extLiveIntervals: number;
  /** Extension isolated world: registrations made during the window. */
  extRafCalls: number;
  extTimeoutCalls: number;
  /** Page main world, for context only. */
  pageLiveTimeouts: number;
  pageLiveIntervals: number;
  pageRafCalls: number;
  /** Nodes added anywhere inside the inspector's shadow root during the window. */
  shadowNodesAdded: number;
  /**
   * Nodes added to the ruler tick strips specifically. This is the number the
   * "transform only" budget is about: the box highlight and the ruler's accent
   * marks legitimately follow the element as the page scrolls under them, so
   * counting every node in the shadow root would conflate the two.
   */
  tickNodesAdded: number;
}

export interface TargetProfile {
  label: string;
  url: string;
  windows: WindowSample[];
  /** Scan measurements, only taken on the fixture target. */
  scan: ScanSample | null;
  /** What the side panel itself costs once its summary has arrived. */
  panel: PanelSample | null;
  teardown: TeardownCheck;
}

export interface PanelSample {
  /** Elements in the panel document with the Summary tab rendered. */
  nodes: number;
  heapMb: number;
  summaryComplete: boolean;
}

export interface ScanSample {
  roundTripMs: number;
  internalMs: number;
  longTasks: number;
  maxLongTaskMs: number;
  scannedElements: number;
  /** Heap after the summary was delivered, minus the idle-inspector baseline. */
  heapDeltaMb: number;
}

export interface TeardownCheck {
  hostNodes: number;
  mockupNodes: number;
  outlineStyles: number;
  extLiveTimeouts: number;
  extLiveIntervals: number;
}

// ---------------------------------------------------------------------------
// Probe source. One string, installed in both worlds.

/**
 * Wraps the scheduling globals of whatever realm it runs in and records both
 * the handles still alive and the registrations made since the last reset.
 *
 * Written as a plain, self-contained function with no TypeScript in its body:
 * it is used three ways. Playwright serialises it for `addInitScript` (the
 * page's main world), and its `toString()` is inlined into the source that
 * `chrome.scripting.executeScript` injects (the extension's isolated world).
 * Nothing outside the body may be referenced.
 */
export function installProbe(): string {
  const w = globalThis as unknown as Record<string, unknown> & typeof globalThis;
  if ((w as { __diPerfProbe?: unknown }).__diPerfProbe) return 'already';
  const live = {
    timeout: new Set<unknown>(),
    interval: new Set<unknown>(),
    raf: new Set<unknown>(),
  };
  const totals = { timeout: 0, interval: 0, raf: 0 };
  const rawSetTimeout = w.setTimeout;
  const rawClearTimeout = w.clearTimeout;
  const rawSetInterval = w.setInterval;
  const rawClearInterval = w.clearInterval;
  const rawRaf = typeof w.requestAnimationFrame === 'function' ? w.requestAnimationFrame : null;
  const rawCancelRaf =
    typeof w.cancelAnimationFrame === 'function' ? w.cancelAnimationFrame : null;

  w.setTimeout = function (handler: unknown, delay?: number, ...args: unknown[]): number {
    if (typeof handler !== 'function') {
      return (rawSetTimeout as Function).call(w, handler, delay, ...args) as number;
    }
    let id = 0;
    id = (rawSetTimeout as Function).call(
      w,
      function (...called: unknown[]) {
        live.timeout.delete(id);
        (handler as Function)(...called);
      },
      delay,
      ...args,
    ) as number;
    live.timeout.add(id);
    totals.timeout += 1;
    return id;
  } as typeof w.setTimeout;

  w.clearTimeout = function (id?: number): void {
    live.timeout.delete(id);
    (rawClearTimeout as Function).call(w, id);
  } as typeof w.clearTimeout;

  w.setInterval = function (handler: unknown, delay?: number, ...args: unknown[]): number {
    const id = (rawSetInterval as Function).call(w, handler, delay, ...args) as number;
    live.interval.add(id);
    totals.interval += 1;
    return id;
  } as typeof w.setInterval;

  w.clearInterval = function (id?: number): void {
    live.interval.delete(id);
    (rawClearInterval as Function).call(w, id);
  } as typeof w.clearInterval;

  if (rawRaf) {
    w.requestAnimationFrame = function (handler: unknown): number {
      let id = 0;
      id = (rawRaf as Function).call(w, function (time: number) {
        live.raf.delete(id);
        (handler as Function)(time);
      }) as number;
      live.raf.add(id);
      totals.raf += 1;
      return id;
    } as typeof w.requestAnimationFrame;
  }
  if (rawCancelRaf) {
    w.cancelAnimationFrame = function (id: number): void {
      live.raf.delete(id);
      (rawCancelRaf as Function).call(w, id);
    } as typeof w.cancelAnimationFrame;
  }

  (w as { __diPerfProbe?: unknown }).__diPerfProbe = {
    reset: function () {
      totals.timeout = 0;
      totals.interval = 0;
      totals.raf = 0;
    },
    read: function () {
      return {
        liveTimeouts: live.timeout.size,
        liveIntervals: live.interval.size,
        liveRafs: live.raf.size,
        timeoutCalls: totals.timeout,
        intervalCalls: totals.interval,
        rafCalls: totals.raf,
      };
    },
  };
  return 'installed';
}

/** Long-task recorder and shadow-root mutation counter, page world only. */
export function installObservers(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__diPerfTasks) return;
  w.__diPerfTasks = [] as number[];
  w.__diPerfShadowAdds = 0;
  w.__diPerfTickAdds = 0;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        (w.__diPerfTasks as number[]).push(entry.duration);
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    w.__diPerfTasksUnsupported = true;
  }
  let shadowObserver: MutationObserver | null = null;
  w.__diPerfWatchShadow = (tag: string): boolean => {
    if (shadowObserver) {
      shadowObserver.disconnect();
      shadowObserver = null;
    }
    const host = document.querySelector(tag);
    const root = host ? host.shadowRoot : null;
    if (!root) return false;
    shadowObserver = new MutationObserver((records) => {
      for (const record of records) {
        w.__diPerfShadowAdds = (w.__diPerfShadowAdds as number) + record.addedNodes.length;
        const parent = record.target as Element;
        if (parent && parent.classList && parent.classList.contains('ruler-strip')) {
          w.__diPerfTickAdds = (w.__diPerfTickAdds as number) + record.addedNodes.length;
        }
      }
    });
    shadowObserver.observe(root, { childList: true, subtree: true });
    return true;
  };
  w.__diPerfUnwatchShadow = (): void => {
    if (shadowObserver) {
      shadowObserver.disconnect();
      shadowObserver = null;
    }
  };
}

// ---------------------------------------------------------------------------
// CDP helpers

interface Counters {
  timestamp: number;
  task: number;
  script: number;
  layout: number;
  style: number;
  layoutCount: number;
  styleCount: number;
  heap: number;
}

async function readCounters(cdp: CDPSession, gc: boolean): Promise<Counters> {
  if (gc) {
    try {
      await cdp.send('HeapProfiler.collectGarbage');
    } catch {
      // Without a forced GC the heap delta is noisier, not wrong.
    }
  }
  const { metrics } = await cdp.send('Performance.getMetrics');
  const byName = new Map(metrics.map((metric) => [metric.name, metric.value]));
  const value = (name: string): number => byName.get(name) ?? 0;
  return {
    timestamp: value('Timestamp'),
    task: value('TaskDuration'),
    script: value('ScriptDuration'),
    layout: value('LayoutDuration'),
    style: value('RecalcStyleDuration'),
    layoutCount: value('LayoutCount'),
    styleCount: value('RecalcStyleCount'),
    heap: value('JSHeapUsedSize'),
  };
}

interface ProbeReading {
  liveTimeouts: number;
  liveIntervals: number;
  liveRafs: number;
  timeoutCalls: number;
  intervalCalls: number;
  rafCalls: number;
}

const EMPTY_PROBE: ProbeReading = {
  liveTimeouts: 0,
  liveIntervals: 0,
  liveRafs: 0,
  timeoutCalls: 0,
  intervalCalls: 0,
  rafCalls: 0,
};

/** Read the wrapper counters inside the extension's own isolated world. */
async function readExtensionProbe(worker: Worker, tabId: number): Promise<ProbeReading> {
  const result = await worker.evaluate(async (id: number) => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => {
          const probe = (globalThis as unknown as { __diPerfProbe?: { read(): unknown } })
            .__diPerfProbe;
          return probe ? probe.read() : null;
        },
      });
      return (results?.[0]?.result ?? null) as ProbeReading | null;
    } catch {
      return null;
    }
  }, tabId);
  return result ?? EMPTY_PROBE;
}

async function resetExtensionProbe(worker: Worker, tabId: number): Promise<void> {
  await worker.evaluate(async (id: number) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        func: () => {
          const probe = (globalThis as unknown as { __diPerfProbe?: { reset(): void } })
            .__diPerfProbe;
          probe?.reset();
        },
      });
    } catch {
      // A page the worker cannot script reports zeros, which the table shows.
    }
  }, tabId);
}

/**
 * Install the wrapper in the isolated world the content script will boot into.
 *
 * The installer's source is inlined into the expression the service worker
 * evaluates, so `chrome.scripting.executeScript` receives a real function
 * object and nothing anywhere calls eval: an MV3 worker's own CSP forbids it.
 */
export async function installExtensionProbe(worker: Worker, tabId: number): Promise<boolean> {
  const expression = `(async () => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: ${tabId} },
        func: ${installProbe.toString()},
      });
      const value = results && results[0] ? results[0].result : null;
      return value === 'installed' || value === 'already';
    } catch (error) {
      return false;
    }
  })()`;
  return worker.evaluate(expression) as Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Window runner

interface RunContext {
  page: Page;
  cdp: CDPSession;
  worker: Worker;
  tabId: number;
  windowMs: number;
}

async function readPageProbe(page: Page): Promise<ProbeReading> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __diPerfProbe?: { read(): ProbeReading } }).__diPerfProbe;
    return probe ? probe.read() : null;
  }) as Promise<ProbeReading>;
}

/**
 * Run one measurement window. `during` is awaited inside the window; anything
 * it does not consume is spent idle, so a window is always `windowMs` long.
 */
async function measureWindow(
  ctx: RunContext,
  id: string,
  name: string,
  during?: (ctx: RunContext) => Promise<void>,
  options: { watchShadowTag?: string } = {},
): Promise<WindowSample> {
  const { page, cdp, worker, tabId, windowMs } = ctx;

  await page.evaluate(
    ([tag]: [string | null]) => {
      const w = window as unknown as {
        __diPerfTasks: number[];
        __diPerfShadowAdds: number;
        __diPerfTickAdds: number;
        __diPerfProbe?: { reset(): void };
        __diPerfWatchShadow?: (tag: string) => boolean;
        __diPerfUnwatchShadow?: () => void;
      };
      w.__diPerfTasks = [];
      w.__diPerfShadowAdds = 0;
      w.__diPerfTickAdds = 0;
      w.__diPerfProbe?.reset();
      w.__diPerfUnwatchShadow?.();
      if (tag) w.__diPerfWatchShadow?.(tag);
    },
    [options.watchShadowTag ?? null] as [string | null],
  );
  await resetExtensionProbe(worker, tabId);

  const start = await readCounters(cdp, true);
  const startedAt = Date.now();
  if (during) await during(ctx);
  const remaining = windowMs - (Date.now() - startedAt);
  if (remaining > 0) await page.waitForTimeout(remaining);
  const end = await readCounters(cdp, true);

  const observed = await page.evaluate(() => {
    const w = window as unknown as {
      __diPerfTasks: number[];
      __diPerfShadowAdds: number;
      __diPerfTickAdds: number;
      __diPerfUnwatchShadow?: () => void;
    };
    w.__diPerfUnwatchShadow?.();
    return {
      tasks: w.__diPerfTasks ?? [],
      shadowAdds: w.__diPerfShadowAdds ?? 0,
      tickAdds: w.__diPerfTickAdds ?? 0,
    };
  });
  const ext = await readExtensionProbe(worker, tabId);
  const pageProbe = await readPageProbe(page);

  const elapsedMs = Math.max(1, (end.timestamp - start.timestamp) * 1000);
  const ms = (from: number, to: number): number => (to - from) * 1000;

  return {
    id,
    name,
    windowMs: Math.round(elapsedMs),
    taskMs: ms(start.task, end.task),
    scriptMs: ms(start.script, end.script),
    layoutMs: ms(start.layout, end.layout),
    styleMs: ms(start.style, end.style),
    layoutCount: end.layoutCount - start.layoutCount,
    styleCount: end.styleCount - start.styleCount,
    longTasks: observed.tasks.length,
    maxLongTaskMs: observed.tasks.reduce((high, value) => Math.max(high, value), 0),
    heapDeltaMb: (end.heap - start.heap) / 1024 / 1024,
    heapEndMb: end.heap / 1024 / 1024,
    extLiveTimeouts: ext.liveTimeouts,
    extLiveIntervals: ext.liveIntervals,
    extRafCalls: ext.rafCalls,
    extTimeoutCalls: ext.timeoutCalls,
    pageLiveTimeouts: pageProbe?.liveTimeouts ?? 0,
    pageLiveIntervals: pageProbe?.liveIntervals ?? 0,
    pageRafCalls: pageProbe?.rafCalls ?? 0,
    shadowNodesAdded: observed.shadowAdds,
    tickNodesAdded: observed.tickAdds,
  };
}

// ---------------------------------------------------------------------------
// The nine windows

const STILL_POINT = { x: 620, y: 420 };

/** Pointer moves at 60 a second for the length of the window. */
async function continuousHover(ctx: RunContext): Promise<void> {
  const cdp = ctx.cdp;
  const steps = Math.round((ctx.windowMs / 1000) * 60);
  const startedAt = Date.now();
  for (let step = 0; step < steps; step += 1) {
    const x = 160 + ((step * 17) % 900);
    const y = 120 + ((step * 29) % 600);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
    const due = startedAt + ((step + 1) * ctx.windowMs) / steps;
    const wait = due - Date.now();
    if (wait > 1) await ctx.page.waitForTimeout(wait);
    if (Date.now() - startedAt >= ctx.windowMs) break;
  }
}

/**
 * Wheel scrolling at 60 steps a second, dispatched as real input so no page
 * script runs: a scroll driven by page.evaluate would charge its own cost to
 * the extension's column.
 */
async function continuousScroll(ctx: RunContext): Promise<void> {
  const cdp = ctx.cdp;
  const steps = Math.round((ctx.windowMs / 1000) * 60);
  const startedAt = Date.now();
  for (let step = 0; step < steps; step += 1) {
    const down = Math.floor(step / 30) % 2 === 0;
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: STILL_POINT.x,
      y: STILL_POINT.y,
      deltaX: 0,
      deltaY: down ? 40 : -40,
    });
    const due = startedAt + ((step + 1) * ctx.windowMs) / steps;
    const wait = due - Date.now();
    if (wait > 1) await ctx.page.waitForTimeout(wait);
    if (Date.now() - startedAt >= ctx.windowMs) break;
  }
}

export interface ProfileOptions {
  session: ExtensionSession;
  control: Page;
  url: string;
  label: string;
  windowMs?: number;
  /** Fixture targets also measure the scan; real pages do not. */
  measureScan?: boolean;
  /** Opens a side panel page for window H. */
  openPanel: (tabId: number) => Promise<Page>;
  log?: (line: string) => void;
}

const HOST_TAG = 'design-inspector-host';
const MOCKUP_TAG = 'design-inspector-mockup';

export async function profileTarget(options: ProfileOptions): Promise<TargetProfile> {
  const { session, control, url, label, openPanel } = options;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const log = options.log ?? (() => undefined);

  const page = await session.context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(installObservers);
  await page.addInitScript(installProbe);
  await page.goto(url, { waitUntil: 'load' });
  // Let the page's own load work drain before the baseline window opens.
  await page.waitForTimeout(2_000);

  const tabId = await tabIdFor(session.worker, page);
  const cdp = await session.context.newCDPSession(page);
  await cdp.send('Performance.enable');
  try {
    await cdp.send('HeapProfiler.enable');
  } catch {
    // Forced GC is an accuracy aid, not a requirement.
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: STILL_POINT.x,
    y: STILL_POINT.y,
    buttons: 0,
  });

  const ctx: RunContext = { page, cdp, worker: session.worker, tabId, windowMs };
  const windows: WindowSample[] = [];
  const record = async (
    id: string,
    name: string,
    during?: (ctx: RunContext) => Promise<void>,
    opts?: { watchShadowTag?: string },
  ): Promise<WindowSample> => {
    const sample = await measureWindow(ctx, id, name, during, opts);
    windows.push(sample);
    log(
      `[perf] ${label} ${id} script=${sample.scriptMs.toFixed(1)}ms ` +
        `task=${sample.taskMs.toFixed(1)}ms layout=${sample.layoutMs.toFixed(1)}ms ` +
        `style=${sample.styleMs.toFixed(1)}ms longTasks=${sample.longTasks}/` +
        `${sample.maxLongTaskMs.toFixed(0)}ms heap=${sample.heapDeltaMb.toFixed(2)}MB ` +
        `extTimers=${sample.extLiveTimeouts}/${sample.extLiveIntervals} ` +
        `extRaf=${sample.extRafCalls} shadowAdds=${sample.shadowNodesAdded} ` +
        `tickAdds=${sample.tickNodesAdded}`,
    );
    return sample;
  };

  // --- A: nothing activated -------------------------------------------------
  await record('A', 'Idle, extension never activated');

  // The wrapper goes into the extension's isolated world before the content
  // script has ever run there, so it sees every handle the inspector opens.
  const installed = await installExtensionProbe(session.worker, tabId);
  if (!installed) log(`[perf] ${label} WARNING: isolated-world probe not installed`);

  // --- B: inspector active, pointer still ----------------------------------
  await sendBackground(control, { type: 'inspector.toggle', tabId });
  await page.waitForTimeout(500);
  const idleB = await record('B', 'Inspector active, pointer still, nothing pinned');

  // --- C: element pinned ----------------------------------------------------
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: STILL_POINT.x,
    y: STILL_POINT.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: STILL_POINT.x,
    y: STILL_POINT.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await page.waitForTimeout(500);
  await record('C', 'Inspector active, element pinned, pointer still');

  // Unpin: hover is suppressed while something is pinned, so window D needs
  // the selection released first.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- D: continuous hover --------------------------------------------------
  await record('D', 'Continuous hover, 60 pointer moves a second', continuousHover, {
    watchShadowTag: HOST_TAG,
  });

  // --- E: layout outlines on ------------------------------------------------
  await sendBackground(control, { type: 'outlines.set', tabId, mode: 'tag' });
  await page.waitForTimeout(500);
  await record('E', 'Layout outlines on, pointer still');
  await sendBackground(control, { type: 'outlines.set', tabId, mode: 'off' });
  await page.waitForTimeout(300);

  // --- F: rulers on, page scrolling ----------------------------------------
  await sendBackground(control, { type: 'tools.set', tabId, tools: { rulers: true } });
  await page.waitForTimeout(500);
  await record('F', 'Rulers on, scrolling 60 steps a second', continuousScroll, {
    watchShadowTag: HOST_TAG,
  });
  await sendBackground(control, { type: 'tools.set', tabId, tools: { rulers: false } });
  await page.waitForTimeout(300);

  // --- G: mockup on, unlocked ----------------------------------------------
  await sendBackground(control, {
    type: 'mockup.set',
    tabId,
    mockup: {
      dataUrl: TINY_PNG,
      opacity: 0.5,
      x: 0,
      y: 0,
      scale: 200,
      visible: true,
      blend: 'normal',
      locked: false,
    },
  });
  await page.waitForTimeout(500);
  await record('G', 'Mockup on and unlocked, pointer still');
  await sendBackground(control, { type: 'mockup.set', tabId, mockup: null });
  await page.waitForTimeout(300);

  // --- H: side panel open with a completed summary -------------------------
  const panel = await openPanel(tabId);
  let panelReady = false;
  try {
    const button = panel.getByRole('button', { name: /Scan this page|Refresh$/ }).first();
    await button.click({ timeout: 15_000 });
    await panel
      .getByRole('heading', { name: 'Palette' })
      .waitFor({ state: 'visible', timeout: 60_000 });
    panelReady = true;
  } catch {
    log(`[perf] ${label} WARNING: the side panel summary did not complete`);
  }
  await page.waitForTimeout(500);
  await record(
    'H',
    panelReady
      ? 'Side panel open with a completed summary, pointer still'
      : 'Side panel open (summary did not complete), pointer still',
  );

  // The panel runs in its own renderer, so its cost never shows up in the
  // page's counters. It is measured separately rather than left unmeasured.
  let panelSample: PanelSample | null = null;
  try {
    const panelCdp = await session.context.newCDPSession(panel);
    await panelCdp.send('Performance.enable');
    try {
      await panelCdp.send('HeapProfiler.enable');
      await panelCdp.send('HeapProfiler.collectGarbage');
    } catch {
      // Forced GC is an accuracy aid, not a requirement.
    }
    const { metrics } = await panelCdp.send('Performance.getMetrics');
    const heap = metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0;
    const nodes = await panel.evaluate(() => document.querySelectorAll('*').length);
    panelSample = { nodes, heapMb: heap / 1024 / 1024, summaryComplete: panelReady };
    log(
      `[perf] ${label} side panel nodes=${nodes} heap=${(heap / 1024 / 1024).toFixed(2)}MB ` +
        `summary=${panelReady ? 'complete' : 'incomplete'}`,
    );
    await panelCdp.detach().catch(() => undefined);
  } catch {
    log(`[perf] ${label} WARNING: the side panel could not be measured`);
  }

  await panel.close();
  await page.waitForTimeout(300);

  // --- Scan on the fixture --------------------------------------------------
  let scan: ScanSample | null = null;
  if (options.measureScan) {
    await page.evaluate(() => {
      const w = window as unknown as { __diPerfTasks: number[] };
      w.__diPerfTasks = [];
    });
    const before = await readCounters(cdp, true);
    const startedAt = Date.now();
    const response = await sendBackground<{
      ok: boolean;
      summary?: { scope: { durationMs: number; scannedElements: number } };
    }>(control, { type: 'summary.request', tabId });
    const roundTripMs = Date.now() - startedAt;
    // Records are released on the next turn; give the heap a beat to settle.
    await page.waitForTimeout(1_500);
    const after = await readCounters(cdp, true);
    const tasks = await page.evaluate(
      () => (window as unknown as { __diPerfTasks: number[] }).__diPerfTasks ?? [],
    );
    scan = {
      roundTripMs,
      internalMs: Math.round(response.summary?.scope.durationMs ?? 0),
      longTasks: tasks.length,
      maxLongTaskMs: tasks.reduce((high, value) => Math.max(high, value), 0),
      scannedElements: response.summary?.scope.scannedElements ?? 0,
      heapDeltaMb: (after.heap - before.heap) / 1024 / 1024,
    };
    log(
      `[perf] ${label} scan roundTrip=${scan.roundTripMs}ms internal=${scan.internalMs}ms ` +
        `longTasks=${scan.longTasks}/${scan.maxLongTaskMs.toFixed(0)}ms ` +
        `heapVsB=${scan.heapDeltaMb.toFixed(2)}MB (B ended at ${idleB.heapEndMb.toFixed(1)}MB)`,
    );
  }

  // --- I: teardown ----------------------------------------------------------
  await sendBackground(control, { type: 'inspector.setMode', tabId, mode: 'off' });
  await page.waitForTimeout(500);
  await record('I', 'After setMode off, pointer still (teardown)');

  const domCounts = await page.evaluate(
    ([host, mockup]: [string, string]) => ({
      hostNodes: document.querySelectorAll(host).length,
      mockupNodes: document.querySelectorAll(mockup).length,
      outlineStyles: document.querySelectorAll('style[data-design-inspector-outlines]').length,
    }),
    [HOST_TAG, MOCKUP_TAG] as [string, string],
  );
  const finalProbe = await readExtensionProbe(session.worker, tabId);
  const teardown: TeardownCheck = {
    ...domCounts,
    extLiveTimeouts: finalProbe.liveTimeouts,
    extLiveIntervals: finalProbe.liveIntervals,
  };

  await page.close();
  await cdp.detach().catch(() => undefined);

  return { label, url, windows, scan, panel: panelSample, teardown };
}

// ---------------------------------------------------------------------------
// Budgets

export interface BudgetFinding {
  window: string;
  check: string;
  measured: string;
  budget: string;
  pass: boolean;
}

const IDLE_WINDOWS = ['B', 'C', 'E', 'G', 'H'];

function rate(sample: WindowSample, value: number): number {
  return value / sample.windowMs;
}

/** Every budget in the spec, evaluated against one target's samples. */
export function checkBudgets(profile: TargetProfile): BudgetFinding[] {
  const findings: BudgetFinding[] = [];
  const byId = new Map(profile.windows.map((sample) => [sample.id, sample]));
  const baseline = byId.get('A');
  if (!baseline) return findings;

  const addedScript = (sample: WindowSample): number =>
    rate(sample, sample.scriptMs) - rate(baseline, baseline.scriptMs);
  const addedLayout = (sample: WindowSample): number =>
    rate(sample, sample.layoutMs) - rate(baseline, baseline.layoutMs);

  for (const id of IDLE_WINDOWS) {
    const sample = byId.get(id);
    if (!sample) continue;
    const percent = addedScript(sample) * 100;
    findings.push({
      window: id,
      check: 'added script time',
      measured: `${percent.toFixed(2)}%`,
      budget: 'under 1%',
      pass: percent < 1,
    });
    findings.push({
      window: id,
      check: 'long tasks',
      measured: String(sample.longTasks),
      budget: '0',
      pass: sample.longTasks === 0,
    });
    findings.push({
      window: id,
      check: 'live extension timers and intervals',
      measured: `${sample.extLiveTimeouts} timeouts, ${sample.extLiveIntervals} intervals`,
      budget: '0',
      pass: sample.extLiveTimeouts === 0 && sample.extLiveIntervals === 0,
    });
    findings.push({
      window: id,
      check: 'extension rAF registrations',
      measured: String(sample.extRafCalls),
      budget: '0',
      pass: sample.extRafCalls === 0,
    });
    findings.push({
      window: id,
      check: 'heap delta',
      measured: `${sample.heapDeltaMb.toFixed(2)} MB`,
      budget: 'under 5 MB',
      pass: sample.heapDeltaMb < 5,
    });
  }

  const hover = byId.get('D');
  if (hover) {
    const percent = addedScript(hover) * 100;
    findings.push({
      window: 'D',
      check: 'added script time',
      measured: `${percent.toFixed(2)}%`,
      budget: 'under 8%',
      pass: percent < 8,
    });
    findings.push({
      window: 'D',
      check: 'long tasks over 50ms',
      measured: `${hover.maxLongTaskMs.toFixed(0)}ms longest, ${hover.longTasks} tasks`,
      budget: 'none over 50ms',
      pass: hover.maxLongTaskMs <= 50,
    });
    const layoutPercent = addedLayout(hover) * 100;
    findings.push({
      window: 'D',
      check: 'added layout time',
      measured: `${layoutPercent.toFixed(2)}%`,
      budget: 'under 2%',
      pass: layoutPercent < 2,
    });
  }

  const scroll = byId.get('F');
  if (scroll) {
    const percent = addedScript(scroll) * 100;
    findings.push({
      window: 'F',
      check: 'added script time',
      measured: `${percent.toFixed(2)}%`,
      budget: 'under 5%',
      pass: percent < 5,
    });
    findings.push({
      window: 'F',
      check: 'long tasks',
      measured: String(scroll.longTasks),
      budget: '0',
      pass: scroll.longTasks === 0,
    });
    findings.push({
      window: 'F',
      check: 'ruler ticks rebuilt while scrolling',
      measured:
        `${scroll.tickNodesAdded} tick nodes ` +
        `(${scroll.shadowNodesAdded} overlay nodes in total, which is the box ` +
        `highlight and the ruler marks following the element)`,
      budget: 'under 100 tick nodes (transform only)',
      pass: scroll.tickNodesAdded < 100,
    });
  }

  if (profile.scan) {
    findings.push({
      window: 'scan',
      check: 'longest task',
      measured: `${profile.scan.maxLongTaskMs.toFixed(0)}ms`,
      budget: 'none over 50ms',
      pass: profile.scan.maxLongTaskMs <= 50,
    });
    findings.push({
      window: 'scan',
      check: 'total time',
      measured: `${profile.scan.roundTripMs}ms round trip`,
      budget: 'under 1500ms',
      pass: profile.scan.roundTripMs < 1500,
    });
    findings.push({
      window: 'scan',
      check: 'heap after the summary, versus idle B',
      measured: `${profile.scan.heapDeltaMb.toFixed(2)} MB`,
      budget: 'within 5 MB',
      pass: Math.abs(profile.scan.heapDeltaMb) < 5,
    });
  }

  const teardown = byId.get('I');
  if (teardown) {
    const percent = addedScript(teardown) * 100;
    findings.push({
      window: 'I',
      check: 'added script time versus A',
      measured: `${percent.toFixed(2)}%`,
      budget: 'under 1% (noise)',
      pass: percent < 1,
    });
    findings.push({
      window: 'I',
      check: 'long tasks',
      measured: String(teardown.longTasks),
      budget: '0',
      pass: teardown.longTasks === 0,
    });
    findings.push({
      window: 'I',
      check: 'extension rAF registrations',
      measured: String(teardown.extRafCalls),
      budget: '0',
      pass: teardown.extRafCalls === 0,
    });
  }

  findings.push({
    window: 'I',
    check: 'inspector host, mockup host and outline sheet removed',
    measured:
      `host ${profile.teardown.hostNodes}, mockup ${profile.teardown.mockupNodes}, ` +
      `outline sheets ${profile.teardown.outlineStyles}`,
    budget: 'all 0',
    pass:
      profile.teardown.hostNodes === 0 &&
      profile.teardown.mockupNodes === 0 &&
      profile.teardown.outlineStyles === 0,
  });
  findings.push({
    window: 'I',
    check: 'extension timers alive after teardown',
    measured: `${profile.teardown.extLiveTimeouts} timeouts, ${profile.teardown.extLiveIntervals} intervals`,
    budget: 'all 0',
    pass: profile.teardown.extLiveTimeouts === 0 && profile.teardown.extLiveIntervals === 0,
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Reporting

export function windowTable(profile: TargetProfile): string {
  const baseline = profile.windows.find((sample) => sample.id === 'A');
  const base = baseline ? baseline.scriptMs / baseline.windowMs : 0;
  const baseLayout = baseline ? baseline.layoutMs / baseline.windowMs : 0;
  const baseStyle = baseline ? baseline.styleMs / baseline.windowMs : 0;
  const rows = profile.windows.map((sample) => {
    const addedScript = (sample.scriptMs / sample.windowMs - base) * 100;
    const addedLayout = (sample.layoutMs / sample.windowMs - baseLayout) * 100;
    const addedStyle = (sample.styleMs / sample.windowMs - baseStyle) * 100;
    return [
      `${sample.id}. ${sample.name}`,
      `${sample.scriptMs.toFixed(1)} ms`,
      sample.id === 'A' ? 'baseline' : `${addedScript >= 0 ? '+' : ''}${addedScript.toFixed(2)}%`,
      sample.id === 'A'
        ? 'baseline'
        : `${addedStyle >= 0 ? '+' : ''}${addedStyle.toFixed(2)}% / ${addedLayout >= 0 ? '+' : ''}${addedLayout.toFixed(2)}%`,
      `${sample.longTasks} / ${sample.maxLongTaskMs.toFixed(0)} ms`,
      `${sample.heapDeltaMb >= 0 ? '+' : ''}${sample.heapDeltaMb.toFixed(2)} MB`,
      `${sample.extLiveTimeouts}t ${sample.extLiveIntervals}i ${sample.extRafCalls}raf`,
      `${sample.shadowNodesAdded} (${sample.tickNodesAdded} tick)`,
    ].join(' | ');
  });
  return [
    '| Window | Script time | Added script vs A | Added style / layout vs A | Long tasks (count / max) | Heap delta | Extension timers | Overlay nodes added |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
  ].join('\n');
}

export function budgetTable(findings: BudgetFinding[]): string {
  return [
    '| Window | Check | Budget | Measured | Verdict |',
    '| --- | --- | --- | --- | --- |',
    ...findings.map(
      (finding) =>
        `| ${finding.window} | ${finding.check} | ${finding.budget} | ${finding.measured} | ${finding.pass ? 'pass' : 'FAIL'} |`,
    ),
  ].join('\n');
}

export async function chromiumVersion(context: BrowserContext): Promise<string> {
  const browser = context.browser();
  if (browser) return `Chromium ${browser.version()}`;
  return 'Chromium (version unavailable)';
}
