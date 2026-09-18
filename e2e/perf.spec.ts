// Performance evidence for PRD 19.1 and release gate 20.3 item 10.
//
// The budgets are measured on e2e/fixtures/large.html: 6,001 elements, all
// local, nothing animating. What is measured here:
//
//   Activation      the inspector.toggle round trip, which covers injecting the
//                   content script and getting a usable overlay back. Budget
//                   300ms (PRD 19.1).
//   Hover           20 pointer moves. Long tasks are not attributable to an
//                   origin, so the same 20 moves run first with the inspector
//                   off as a control, and the assertion is on the delta: at
//                   most two more long tasks than the page produces by itself,
//                   and no more tasks over 100ms than the control had.
//   Scan            the summary.request round trip. Budget 3s, with the scope
//                   capped at the default 5,000 and progress events observed.
//
// Numbers are printed as `[perf] ...` lines and transcribed into store/QA.md.
// They are machine-specific; the assertions are the contract, not the numbers.
import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PageSummary } from '../lib/contracts';
import {
  FIXTURES_DIR,
  launchWithExtension,
  openControlPage,
  sendBackground,
  tabIdFor,
  type ExtensionSession,
} from './helpers/extension';

/** PRD 19.1: activation to usable overlay. */
const ACTIVATION_BUDGET_MS = 300;
/** PRD 19.1 read against gate 10: the initial summary on a large page. */
const SCAN_BUDGET_MS = 3_000;
/** A task this long is a visible stall, whoever caused it. */
const LONG_TASK_BUDGET_MS = 100;
/** Extra long tasks the inspector may add over the control run. */
const MAX_EXTRA_LONG_TASKS = 2;
/** The shipped default scan cap (lib/contracts DEFAULT_SETTINGS). */
const EXPECTED_CAP = 5_000;

interface LongTask {
  name: string;
  start: number;
  duration: number;
}

let server: Server;
let baseUrl: string;
let session: ExtensionSession;
let control: Page;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const file = path.join(FIXTURES_DIR, path.basename(new URL(req.url ?? '/', 'http://x').pathname));
    try {
      const body = await readFile(file);
      res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
  session = await launchWithExtension();
  control = await openControlPage(session);
});

test.afterAll(async () => {
  await session?.context.close();
  await new Promise<void>(resolve => server?.close(() => resolve()));
});

/** Twenty pointer moves down the page, spaced so each one settles. */
async function hoverTwentyTimes(page: Page): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (let step = 0; step < 20; step += 1) {
    const x = 120 + ((step * 37) % Math.max(200, viewport.width - 240));
    const y = 80 + ((step * 53) % Math.max(200, viewport.height - 160));
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
  }
  // The observer reports a long task after the task ends; give the queue a beat.
  await page.waitForTimeout(250);
}

async function readLongTasks(page: Page): Promise<LongTask[]> {
  return page.evaluate(() => (window as unknown as { __longTasks: LongTask[] }).__longTasks);
}

async function resetLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __resetLongTasks: () => void }).__resetLongTasks());
}

function summarise(tasks: LongTask[]): { count: number; longest: number; overBudget: number } {
  return {
    count: tasks.length,
    longest: tasks.reduce((high, task) => Math.max(high, task.duration), 0),
    overBudget: tasks.filter(task => task.duration > LONG_TASK_BUDGET_MS).length,
  };
}

test.describe('performance on a 6,000 element page', () => {
  test('activates, hovers, and scans inside the budgets', async () => {
    test.slow();
    const page = await session.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${baseUrl}/large.html`);

    // The fixture has to be the page the budgets were written for.
    expect(
      await page.evaluate(
        () => (window as unknown as { __longTaskSupported: boolean }).__longTaskSupported,
      ),
      'PerformanceObserver longtask support',
    ).toBe(true);
    const elementCount = await page.evaluate(
      () => (window as unknown as { __fixtureElementCount: number }).__fixtureElementCount,
    );
    expect(elementCount, 'fixture element count').toBeGreaterThanOrEqual(6_000);

    const tabId = await tabIdFor(session.worker, page);

    // --- Control: the same hover work with no inspector on the page. --------
    await resetLongTasks(page);
    await hoverTwentyTimes(page);
    const controlTasks = summarise(await readLongTasks(page));

    // --- Activation --------------------------------------------------------
    await resetLongTasks(page);
    const startedAt = Date.now();
    const activated = await sendBackground<{ ok: boolean; state?: { mode: string } }>(control, {
      type: 'inspector.toggle',
      tabId,
    });
    const activationMs = Date.now() - startedAt;
    expect(activated).toMatchObject({ ok: true, state: { mode: 'active' } });
    await expect(page.locator('design-inspector-host')).toHaveCount(1);
    expect(activationMs, 'activation to usable overlay').toBeLessThan(ACTIVATION_BUDGET_MS);

    // --- Hover with the inspector live -------------------------------------
    await resetLongTasks(page);
    await hoverTwentyTimes(page);
    const hoverTasks = summarise(await readLongTasks(page));

    expect(
      hoverTasks.count - controlTasks.count,
      `long tasks added by the inspector (control ${controlTasks.count}, live ${hoverTasks.count})`,
    ).toBeLessThanOrEqual(MAX_EXTRA_LONG_TASKS);
    expect(
      hoverTasks.overBudget,
      `tasks over ${LONG_TASK_BUDGET_MS}ms while inspecting (control had ${controlTasks.overBudget})`,
    ).toBeLessThanOrEqual(controlTasks.overBudget);

    // --- Scan --------------------------------------------------------------
    // Progress is a broadcast, so the control page listens for it the way the
    // side panel does. A scan that reports nothing is a scan with no cancel
    // affordance, which the PRD treats as a defect (19.1).
    await control.evaluate(() => {
      const holder = window as unknown as { __progress: { scanned: number; total: number }[] };
      holder.__progress = [];
      chrome.runtime.onMessage.addListener((message: { type?: string; scanned?: number; total?: number }) => {
        if (message?.type === 'event.scanProgress') {
          holder.__progress.push({ scanned: message.scanned ?? 0, total: message.total ?? 0 });
        }
      });
    });

    const scanStartedAt = Date.now();
    const scanned = await sendBackground<{ ok: boolean; summary?: PageSummary; error?: string }>(
      control,
      { type: 'summary.request', tabId },
    );
    const scanMs = Date.now() - scanStartedAt;
    expect(scanned.ok, scanned.error ?? 'scan failed').toBe(true);

    const summary = scanned.summary;
    expect(summary, 'summary payload').toBeTruthy();
    if (!summary) throw new Error('no summary');

    expect(scanMs, 'summary.request round trip').toBeLessThan(SCAN_BUDGET_MS);
    expect(summary.scope.cap, 'scan cap').toBe(EXPECTED_CAP);
    expect(summary.scope.capped, 'scope.capped on a 6,000 element page').toBe(true);
    expect(summary.scope.scannedElements, 'scanned elements').toBe(EXPECTED_CAP);
    expect(
      summary.limitations.concat(summary.scope.notes).join(' '),
      'the partial result says it is partial',
    ).toContain(`cap of ${EXPECTED_CAP}`);

    const progress = await control.evaluate(
      () => (window as unknown as { __progress: { scanned: number; total: number }[] }).__progress,
    );
    expect(progress.length, 'scan progress events observed').toBeGreaterThan(0);
    expect(progress[progress.length - 1]?.total, 'progress reports a total').toBeGreaterThan(0);

    // --- Evidence for store/QA.md ------------------------------------------
    // eslint-disable-next-line no-console
    console.log(
      [
        `[perf] elements=${elementCount}`,
        `activation=${activationMs}ms (budget ${ACTIVATION_BUDGET_MS})`,
        `hover long tasks control=${controlTasks.count}/longest ${controlTasks.longest.toFixed(0)}ms`,
        `live=${hoverTasks.count}/longest ${hoverTasks.longest.toFixed(0)}ms`,
        `scan=${scanMs}ms (budget ${SCAN_BUDGET_MS})`,
        `scanned=${summary.scope.scannedElements}/cap ${summary.scope.cap}`,
        `internal duration=${Math.round(summary.scope.durationMs)}ms`,
        `progress events=${progress.length}`,
      ].join(' '),
    );

    // Stopping cancels the work and takes the overlay off the page (PRD 19.1).
    await sendBackground(control, { type: 'inspector.toggle', tabId });
    await expect(page.locator('design-inspector-host')).toHaveCount(0);

    await page.close();
  });

  test('a scan can be cancelled and leaves the page usable', async () => {
    test.slow();
    const page = await session.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${baseUrl}/large.html`);
    const tabId = await tabIdFor(session.worker, page);

    await sendBackground(control, { type: 'inspector.toggle', tabId });

    // Fire the scan and the cancel from the same page without awaiting the
    // scan, which is how the panel's Cancel button behaves.
    const outcome = await control.evaluate(async (id: number) => {
      const scan = chrome.runtime.sendMessage({ type: 'summary.request', tabId: id });
      await new Promise(resolve => setTimeout(resolve, 60));
      await chrome.runtime.sendMessage({ type: 'summary.cancel', tabId: id });
      return (await scan) as { ok: boolean; error?: string };
    }, tabId);

    // Either the scan finished before the cancel landed or it reports the
    // cancellation. What must never happen is an unhandled failure.
    expect(typeof outcome.ok, 'cancel produced a well-formed response').toBe('boolean');

    await sendBackground(control, { type: 'inspector.toggle', tabId });
    await expect(page.locator('design-inspector-host')).toHaveCount(0);
    // The page still answers after the inspector leaves.
    expect(await page.evaluate(() => document.querySelectorAll('main *').length)).toBeGreaterThan(
      5_000,
    );

    await page.close();
  });
});
