import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FIXTURES_DIR,
  launchWithExtension,
  openControlPage,
  tabIdFor,
  type ExtensionSession,
} from './helpers/extension';
import { artifactPath } from './helpers/artifacts';





let server: Server;
let baseUrl: string;
let session: ExtensionSession;

async function openPanel(fixtureTabId: number): Promise<Page> {
  const page = await session.context.newPage();


  await page.setViewportSize({ width: 420, height: 960 });
  await page.addInitScript((tabId: number) => {
    const apply = (api: typeof chrome): void => {
      const real = api.tabs.query.bind(api.tabs);


      api.tabs.query = ((info: chrome.tabs.QueryInfo) => {
        if (info?.active && info?.currentWindow) {
          return api.tabs.get(tabId).then((tab) => [tab]);
        }
        return real(info);
      }) as typeof api.tabs.query;
    };
    if (typeof chrome !== 'undefined' && chrome.tabs) apply(chrome);
  }, fixtureTabId);
  await page.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
  return page;
}


async function scan(panel: Page): Promise<void> {
  const button = panel.getByRole('button', { name: /Scan this page|Refresh$/ }).first();
  await button.click();
  await expect(panel.getByRole('heading', { name: 'Palette' })).toBeVisible({ timeout: 30_000 });
}

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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
  session = await launchWithExtension();


  await openControlPage(session);
});

test.afterAll(async () => {
  await session?.context.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

test.describe('side panel summary', () => {
  test('clusters the palette and filters it by role', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);

    const panel = await openPanel(tabId);
    await scan(panel);

    const chips = panel.getByRole('group', { name: 'Filter the palette by role' });
    await expect(chips).toBeVisible();
    await expect(chips.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chips.getByRole('button', { name: 'Text' })).toBeVisible();
    await expect(chips.getByRole('button', { name: 'Background' })).toBeVisible();


    const palette = panel.locator('section', { has: panel.getByRole('heading', { name: 'Palette' }) });
    await expect(palette.getByText(/swatch(es)? from \d+ measured value/)).toBeVisible();
    const allRows = await palette.getByRole('button', { expanded: false }).count();
    expect(allRows).toBeGreaterThan(0);

    await palette.scrollIntoViewIfNeeded();
    await palette.screenshot({ path: artifactPath('di-r2-palette.png') });

    await chips.getByRole('button', { name: 'Border' }).click();
    await expect(chips.getByRole('button', { name: 'Border' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await expect(palette.getByText('#3874cb', { exact: false }).first()).toBeVisible();
    const borderRows = await palette.getByRole('button', { expanded: false }).count();
    expect(borderRows).toBeLessThan(allRows);


    await expect(palette.getByText(/Show all \d+ occurrence/)).toBeVisible();

    await page.close();
    await panel.close();
  });

  test('reveals a row\'s example controls on hover or focus, never all at once', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);

    const panel = await openPanel(tabId);
    await scan(panel);

    const typography = panel.locator('section', {
      has: panel.getByRole('heading', { name: 'Typography combinations' }),
    });


    await typography.locator('summary').first().click();
    const show = typography.getByRole('button', { name: 'Show on page' }).first();
    const opacity = () =>
      show.evaluate((node) => getComputedStyle(node.parentElement as HTMLElement).opacity);

    expect(await opacity()).toBe('0');
    await show.focus();
    await expect.poll(opacity).toBe('1');

    await page.close();
    await panel.close();
  });
});

test.describe('side panel compare', () => {
  test('compares the same page saved at two viewport widths', async () => {
    const page = await session.context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);

    const panel = await openPanel(tabId);
    await scan(panel);
    await panel.getByRole('button', { name: 'Save summary' }).click();
    await expect(panel.getByText('Saved to your collection.')).toBeVisible();

    await page.setViewportSize({ width: 480, height: 900 });
    await scan(panel);
    await panel.getByRole('button', { name: 'Save summary' }).click();

    await panel.getByRole('tab', { name: 'Saved' }).click();
    await expect(panel.getByRole('button', { name: 'Select all' })).toBeVisible();
    await expect(panel.getByText(/0 of 2 selected/)).toBeVisible();
    await panel.screenshot({ path: artifactPath('di-r2-saved.png') });

    await panel.getByRole('button', { name: 'Select all' }).click();
    await panel.getByRole('button', { name: 'Compare' }).click();

    const compare = panel.locator('section', {
      has: panel.getByRole('heading', { name: 'Compare summaries' }),
    });
    await expect(compare).toBeVisible();
    await expect(compare.getByText('1280 x 900 CSS px')).toBeVisible();
    await expect(compare.getByText('480 x 900 CSS px')).toBeVisible();
    await expect(compare.getByRole('heading', { name: 'Type scale' })).toBeVisible();
    await expect(compare.getByRole('heading', { name: 'Palette' })).toBeVisible();

    await compare.screenshot({ path: artifactPath('di-r2-compare.png') });

    await page.close();
    await panel.close();
  });
});
