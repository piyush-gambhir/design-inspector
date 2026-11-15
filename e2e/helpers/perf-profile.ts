
























import type { BrowserContext, CDPSession, Page, Worker } from '@playwright/test';
import { sendBackground, tabIdFor, type ExtensionSession } from './extension';

export const DEFAULT_WINDOW_MS = 10_000;


export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAACZgbYnAAAAFElEQVR4' +
  'AWP8//8/AzJgYmBgYAAAHAAD/1lC1wAAAABJRU5ErkJggg==';

export interface WindowSample {
  id: string;
  name: string;

  windowMs: number;

  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
  layoutCount: number;
  styleCount: number;

  longTasks: number;
  maxLongTaskMs: number;

  heapDeltaMb: number;
  heapEndMb: number;

  extLiveTimeouts: number;
  extLiveIntervals: number;

  extRafCalls: number;
  extTimeoutCalls: number;

  pageLiveTimeouts: number;
  pageLiveIntervals: number;
  pageRafCalls: number;

  shadowNodesAdded: number;






  tickNodesAdded: number;
}

export interface TargetProfile {
  label: string;
  url: string;
  windows: WindowSample[];

  scan: ScanSample | null;

  panel: PanelSample | null;
  teardown: TeardownCheck;
}

export interface PanelSample {

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

  heapDeltaMb: number;
}

export interface TeardownCheck {
  hostNodes: number;
  mockupNodes: number;
  outlineStyles: number;
  extLiveTimeouts: number;
  extLiveIntervals: number;
}














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

    }
  }, tabId);
}








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




const STILL_POINT = { x: 620, y: 420 };


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

  measureScan?: boolean;

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

  await page.waitForTimeout(2_000);

  const tabId = await tabIdFor(session.worker, page);
  const cdp = await session.context.newCDPSession(page);
  await cdp.send('Performance.enable');
  try {
    await cdp.send('HeapProfiler.enable');
  } catch {

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


  await record('A', 'Idle, extension never activated');



  const installed = await installExtensionProbe(session.worker, tabId);
  if (!installed) log(`[perf] ${label} WARNING: isolated-world probe not installed`);


  await sendBackground(control, { type: 'inspector.toggle', tabId });
  await page.waitForTimeout(500);
  const idleB = await record('B', 'Inspector active, pointer still, nothing pinned');


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



  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);


  await record('D', 'Continuous hover, 60 pointer moves a second', continuousHover, {
    watchShadowTag: HOST_TAG,
  });


  await sendBackground(control, { type: 'outlines.set', tabId, mode: 'tag' });
  await page.waitForTimeout(500);
  await record('E', 'Layout outlines on, pointer still');
  await sendBackground(control, { type: 'outlines.set', tabId, mode: 'off' });
  await page.waitForTimeout(300);


  await sendBackground(control, { type: 'tools.set', tabId, tools: { rulers: true } });
  await page.waitForTimeout(500);
  await record('F', 'Rulers on, scrolling 60 steps a second', continuousScroll, {
    watchShadowTag: HOST_TAG,
  });
  await sendBackground(control, { type: 'tools.set', tabId, tools: { rulers: false } });
  await page.waitForTimeout(300);


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



  let panelSample: PanelSample | null = null;
  try {
    const panelCdp = await session.context.newCDPSession(panel);
    await panelCdp.send('Performance.enable');
    try {
      await panelCdp.send('HeapProfiler.enable');
      await panelCdp.send('HeapProfiler.collectGarbage');
    } catch {

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
