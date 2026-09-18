// Real font identity, end to end (workstream FONT, PRD TYP-01 to TYP-03).
//
// The complaint this suite exists for: a pinned heading read its CSS alias
// ("Nb international pro webfont"), "matched", and seven lines of hashed CDN
// URL. What it should read is the typeface's own name, its designer, and one
// quiet line for the source.
//
// The fixture server serves a real WOFF2 (e2e/fixtures/fonts, original work,
// OFL, built by the script beside it), so the whole path is exercised: Chrome
// loads the face, the canvas check measures it, the worker fetches the file and
// brotli-decodes it, and the panel repaints with the name table's answer.
import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FIXTURES_DIR,
  launchWithExtension,
  openControlPage,
  sendBackground,
  tabIdFor,
  toggleInspector,
  type ExtensionSession,
} from './helpers/extension';
import { artifactPath } from './helpers/artifacts';
import { waitForOverlayIdle } from './helpers/timing';

const HOST = 'design-inspector-host';

let server: Server;
let baseUrl: string;
let session: ExtensionSession;
let control: Page;

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.woff2': 'font/woff2',
};

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const requested = new URL(req.url ?? '/', 'http://x').pathname;
    const name = path.basename(requested);
    // Fonts live in their own directory, exactly as a site would serve them.
    const file = requested.includes('/fonts/')
      ? path.join(FIXTURES_DIR, 'fonts', name)
      : path.join(FIXTURES_DIR, name);
    try {
      const body = await readFile(file);
      res.setHeader('content-type', TYPES[path.extname(name)] ?? 'application/octet-stream');
      res.setHeader('access-control-allow-origin', '*');
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
  control = await openControlPage(session);
});

test.afterAll(async () => {
  await session?.context.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/** The whole pinned panel as one line of text. */
async function panelText(page: Page): Promise<string> {
  return page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    const panel = root?.getElementById('panel');
    return (panel?.textContent ?? '').replace(/\s+/g, ' ');
  }, HOST);
}

/** Press a panel button by its exact label. Returns false when it is not there. */
async function pressPanelButton(page: Page, label: string): Promise<boolean> {
  return page.evaluate(
    ({ host, label: wanted }) => {
      const root = document.querySelector(host)?.shadowRoot;
      if (!root) return false;
      const node = Array.from(root.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === wanted,
      );
      if (!node) return false;
      (node as HTMLButtonElement).click();
      return true;
    },
    { host: HOST, label },
  );
}

async function confidenceBadge(page: Page): Promise<{ text: string; title: string } | null> {
  return page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    const panel = root?.getElementById('panel');
    if (!panel) return null;
    const chip = Array.from(panel.querySelectorAll('.chip')).find((node) =>
      ['declared', 'matched', 'verified'].includes((node.textContent ?? '').trim()),
    ) as HTMLElement | undefined;
    return chip ? { text: (chip.textContent ?? '').trim(), title: chip.title } : null;
  }, HOST);
}

/**
 * The side panel as Chrome shows it: its own page, at roughly the width the
 * real panel gets, with the active-tab lookup pointed at the fixture tab.
 */
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

/**
 * Pin an element and wait until the panel has repainted for it. The panel names
 * the element it is reading, so its id appearing there is the signal that the
 * deep reading arrived; a fixed sleep here was only ever a guess at how long
 * that takes on the machine running the test.
 */
async function pin(page: Page, selector: string): Promise<void> {
  const id = selector.replace(/^#/, '');
  await page.locator(selector).hover();
  await waitForOverlayIdle(page);
  await page.locator(selector).click();
  await expect.poll(() => panelText(page)).toContain(id);
}

test.describe('font identity on a page that aliases its own font', () => {
  test('identifies the served woff2 and reaches the verified badge', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-font.html`);
    // font-display: block, so wait for the face before measuring anything.
    await page.evaluate(() => document.fonts.ready);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await expect(page.locator(HOST)).toHaveCount(1);

    await pin(page, '#hero-heading');

    // Before the press: the alias, and the rendering check has already earned
    // `verified` because the face is loaded and measurably not the fallback.
    let text = await panelText(page);
    expect(text).toContain('Its webfont alias');
    expect(text).not.toContain('Inspector Test Sans');
    const badge = await confidenceBadge(page);
    expect(badge?.text).toBe('verified');
    expect(badge?.title).toContain('Measured');

    // The source is one line and the hashed URL is not printed.
    expect(text).toContain('Self-hosted on 127.0.0.1');
    expect(text).toContain('woff2');
    expect(text).not.toContain('/fonts/inspector-test-sans.woff2');

    expect(await pressPanelButton(page, 'Identify font file')).toBe(true);
    await expect
      .poll(async () => await panelText(page), { timeout: 10_000 })
      .toContain('Inspector Test Sans');

    text = await panelText(page);
    // The typeface's own name, its style, and its designer, from the file.
    expect(text).toContain('Inspector Test Sans');
    expect(text).toContain('Regular');
    expect(text).toContain('by Design Inspector Fixtures');
    expect(text).toContain('Version 1.000');
    expect(text).toContain('openfontlicense.org');
    // The alias is kept, labelled as what it is.
    expect(text).toContain('Declared as');
    expect(text).toContain('Its webfont alias');
    // The file size now appears on the source line.
    expect(text).toMatch(/\d+ KB/);
    // The offer is gone once it has been taken.
    expect(await pressPanelButton(page, 'Identify font file')).toBe(false);
    // Still verified: identifying a file never downgrades the evidence.
    expect((await confidenceBadge(page))?.text).toBe('verified');

    await page.screenshot({ path: artifactPath('di-font-fixture.png') });
    await page.close();
  });

  test('a system family reads verified and a missing family never does', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-font.html`);
    await page.evaluate(() => document.fonts.ready);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    await pin(page, '#system-heading');
    expect((await confidenceBadge(page))?.text).toBe('verified');
    expect(await panelText(page)).toContain('System font, nothing was downloaded');
    // Nothing to identify: there is no file (PRD TYP-03).
    expect(await pressPanelButton(page, 'Identify font file')).toBe(false);

    await pin(page, '#missing-heading');
    // A family nothing serves is `declared`, whatever it measures. TYP-02.
    expect((await confidenceBadge(page))?.text).toBe('declared');
    expect(await pressPanelButton(page, 'Identify font file')).toBe(false);

    await page.close();
  });

  test('the worker refuses an address it will not fetch, and caches what it read', async () => {
    const fontUrl = `${baseUrl}/fonts/inspector-test-sans.woff2`;

    const first = await sendBackground<{ ok: boolean; identity?: { family: string } }>(control, {
      type: 'font.identify',
      url: fontUrl,
    });
    expect(first.ok).toBe(true);
    expect(first.identity?.family).toBe('Inspector Test Sans');

    // Same URL again: answered from the worker's cache, same result.
    const second = await sendBackground<{ ok: boolean; identity?: { family: string } }>(control, {
      type: 'font.identify',
      url: fontUrl,
    });
    expect(second.identity?.family).toBe('Inspector Test Sans');

    const notAFont = await sendBackground<{ ok: boolean; error?: string }>(control, {
      type: 'font.identify',
      url: `${baseUrl}/inspector-font.html`,
    });
    expect(notAFont).toMatchObject({ ok: false });
    expect(notAFont.error).toContain('Not a font file');

    const missing = await sendBackground<{ ok: boolean; error?: string }>(control, {
      type: 'font.identify',
      url: `${baseUrl}/fonts/nothing-here.woff2`,
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('404');

    const refused = await sendBackground<{ ok: boolean; error?: string }>(control, {
      type: 'font.identify',
      url: 'file:///Users/someone/Library/Fonts/Thing.otf',
    });
    expect(refused.ok).toBe(false);
  });

  test('the side panel identifies a family and renders a specimen in its real face', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-font.html`);
    await page.evaluate(() => document.fonts.ready);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    const panel = await openPanel(tabId);
    await panel.getByRole('button', { name: /Scan this page|Refresh$/ }).first().click();
    await expect(panel.getByRole('heading', { name: 'Fonts' })).toBeVisible({ timeout: 30_000 });

    const identify = panel.getByRole('button', { name: 'Identify', exact: true }).first();
    await expect(identify).toBeVisible({ timeout: 10_000 });
    await identify.click();

    await expect(panel.getByText('Inspector Test Sans').first()).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText(/Design Inspector Fixtures/).first()).toBeVisible();
    // One specimen row per loaded weight, set in the face the panel loaded.
    await expect(panel.getByText(/^Specimen /).first()).toBeVisible({ timeout: 10_000 });
    await expect(
      panel.getByText('The quick brown fox jumps over the lazy dog').first(),
    ).toBeVisible();

    await panel.screenshot({ path: artifactPath('di-font-specimen.png'), fullPage: false });
    await panel.close();
    await page.close();
  });
});
