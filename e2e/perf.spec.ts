

















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


const ACTIVATION_BUDGET_MS = 300;

const SCAN_BUDGET_MS = 3_000;

const LONG_TASK_BUDGET_MS = 100;

const MAX_EXTRA_LONG_TASKS = 2;

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


async function hoverTwentyTimes(page: Page): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (let step = 0; step < 20; step += 1) {
    const x = 120 + ((step * 37) % Math.max(200, viewport.width - 240));
    const y = 80 + ((step * 53) % Math.max(200, viewport.height - 160));
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
  }

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


    await resetLongTasks(page);
    await hoverTwentyTimes(page);
    const controlTasks = summarise(await readLongTasks(page));


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



    const outcome = await control.evaluate(async (id: number) => {
      const scan = chrome.runtime.sendMessage({ type: 'summary.request', tabId: id });
      await new Promise(resolve => setTimeout(resolve, 60));
      await chrome.runtime.sendMessage({ type: 'summary.cancel', tabId: id });
      return (await scan) as { ok: boolean; error?: string };
    }, tabId);



    expect(typeof outcome.ok, 'cancel produced a well-formed response').toBe('boolean');

    await sendBackground(control, { type: 'inspector.toggle', tabId });
    await expect(page.locator('design-inspector-host')).toHaveCount(0);

    expect(await page.evaluate(() => document.querySelectorAll('main *').length)).toBeGreaterThan(
      5_000,
    );

    await page.close();
  });
});
