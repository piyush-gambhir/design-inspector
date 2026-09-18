// Store screenshots: five 1280x800 PNGs from the real extension, driven the way
// a person drives it (PRD 20.3, store/LISTING.md).
//
// Nothing is overlaid, annotated, framed or composited. If a shot needs a
// caption to make sense, the fix is the UI, not the caption.
//
// Usage:
//   pnpm screenshots            fixtures only
//   pnpm screenshots --live     also try one shot on a real site
//
// It builds the e2e bundle itself (that build keeps host_permissions so a tab
// can be injected without a toolbar click) and serves the fixtures over plain
// http, because extensions cannot inject into file:// without an extra grant.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile as read } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '../..');
const fixtures = path.join(root, 'e2e', 'fixtures');
const extensionDir = path.join(root, '.output-e2e', 'chrome-mv3');
const outDir = path.join(root, 'store', 'screenshots');

const WIDTH = 1280;
const HEIGHT = 800;
/** Where the design-pass review shots go. They are not store assets. */
const REVIEW_DIR = '/private/tmp/claude-502';
/** The width Chrome gives a comfortable side panel, and the narrow end of one. */
const PANEL_WIDTH = 400;
const PANEL_NARROW = 320;
/** One real site, used only with --live, and only for a screenshot. */
const LIVE_URL = 'https://developer.mozilla.org/en-US/';

const argv = process.argv.slice(2);
const live = argv.includes('--live');

const say = message => console.log(`\x1b[2m${message}\x1b[0m`);
const die = message => {
  console.error(`\x1b[31m${message}\x1b[0m`);
  process.exit(1);
};

// --- Build the bundle the screenshots are taken from ------------------------
say('$ DI_E2E=1 wxt build');
execFileSync('pnpm', ['exec', 'wxt', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DI_E2E: '1' },
});

mkdirSync(outDir, { recursive: true });

// --- Serve the fixtures -----------------------------------------------------
const server = createServer(async (request, response) => {
  const name = path.basename(new URL(request.url ?? '/', 'http://x').pathname);
  try {
    const body = await read(path.join(fixtures, name));
    response.setHeader('content-type', name.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

// --- Launch Chromium with the extension loaded ------------------------------
const profile = mkdtempSync(path.join(process.env.CLAUDE_SCRATCH ?? tmpdir(), 'di-shots-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: WIDTH, height: HEIGHT },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;

/** An extension page to send background messages from; a worker cannot message itself. */
const control = await context.newPage();
await control.goto(`chrome-extension://${extensionId}/popup.html`);

const send = request => control.evaluate(message => chrome.runtime.sendMessage(message), request);

const tabIdFor = async page => {
  const url = page.url();
  const id = await worker.evaluate(async target => {
    const tabs = await chrome.tabs.query({});
    return tabs.find(tab => tab.url === target)?.id ?? -1;
  }, url);
  if (id < 0) throw new Error(`No tab found for ${url}`);
  return id;
};

const shot = async (page, name) => {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file });
  say(`  wrote store/screenshots/${name}`);
};

/** A review shot of a surface, at the size that surface really has. */
const review = async (page, name, options = {}) => {
  const file = path.join(REVIEW_DIR, name);
  await page.screenshot({ path: file, ...options });
  say(`  wrote ${file}`);
};

/**
 * The toolbar popup as a page.
 *
 * `tabUrl` replaces the URL the popup reads for the active tab and `state`
 * replaces the answer to inspector.getState. Both exist for one shot: the
 * empty-tab case. A driven browser cannot grant activeTab, and without it
 * Chrome reports no URL at all for a new tab, so the background has nothing to
 * refuse and the real refusal never arrives. The substituted state is the exact
 * one unsupportedSchemeReason produces for chrome://newtab/, so the component,
 * the copy and the layout in the shot are the real ones.
 */
const openPopup = async ({ tabId = null, tabUrl = null, state = null, scheme = 'light' } = {}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: PANEL_NARROW, height: 640 });
  await page.emulateMedia({ colorScheme: scheme });
  if (tabId !== null || tabUrl !== null) {
    await page.addInitScript(
      ({ id, url }) => {
        if (typeof chrome === 'undefined' || !chrome.tabs) return;
        const real = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = info => {
          if (info?.active && info?.currentWindow) {
            const source = id === null ? real(info).then(tabs => tabs[0]) : chrome.tabs.get(id);
            return source.then(tab => [url === null ? tab : { ...tab, url }]);
          }
          return real(info);
        };
      },
      { id: tabId, url: tabUrl },
    );
  }
  if (state) {
    await page.addInitScript(patch => {
      if (typeof chrome === 'undefined' || !chrome.runtime) return;
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message, ...rest) => {
        if (message?.type === 'inspector.getState') {
          return Promise.resolve({
            ok: true,
            state: {
              tabId: message.tabId,
              mode: 'off',
              pinned: null,
              pageStale: false,
              outlines: 'off',
              ...patch,
            },
          });
        }
        return real(message, ...rest);
      };
    }, state);
  }
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForTimeout(400);
  return page;
};

const openPanel = async (tabId, { width = WIDTH, scheme = 'light' } = {}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: HEIGHT });
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript(id => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    const real = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = info => {
      if (info?.active && info?.currentWindow) return chrome.tabs.get(id).then(tab => [tab]);
      return real(info);
    };
  }, tabId);
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
};

try {
  // 1. Pinned typography on the basic fixture.
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(page);
    await send({ type: 'inspector.toggle', tabId });
    await page.locator('#hero-heading').hover();
    await page.locator('#hero-heading').click();
    await page.waitForTimeout(400);
    await shot(page, '01-typography.png');

    // 2. Layout outlines over the same page, still pinned.
    await send({ type: 'outlines.set', tabId, mode: 'tag' });
    await page.waitForTimeout(300);
    await shot(page, '02-layout-outlines.png');
    await send({ type: 'outlines.set', tabId, mode: 'off' });

    // 5. Measurement: pinned heading, Alt held over a second element.
    await page.keyboard.down('Alt');
    await page.locator('#translucent-card').hover();
    await page.waitForTimeout(400);
    await shot(page, '05-measure.png');
    await page.keyboard.up('Alt');

    await send({ type: 'inspector.toggle', tabId });
    await page.close();
  }

  // 3. The side panel's page summary, with the palette clustered.
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(page);
    const panel = await openPanel(tabId);
    await panel.getByRole('button', { name: /Scan this page/ }).first().click();
    await panel.getByRole('heading', { name: 'Palette' }).waitFor({ timeout: 30_000 });
    await panel.getByRole('heading', { name: 'Palette' }).scrollIntoViewIfNeeded();
    await panel.waitForTimeout(400);
    await shot(panel, '03-summary-palette.png');

    // 4. The Assets tab on the same page. The dedicated assets fixture is not
    // used here: half of it is deliberately broken references, which is the
    // right fixture for a failure test and the wrong one for a store shot.
    const assetsPanel = await openPanel(tabId);
    await assetsPanel.getByRole('tab', { name: 'Assets' }).click();
    await assetsPanel.getByRole('button', { name: 'List assets' }).click();
    await assetsPanel.getByText(/assets discovered/).waitFor({ timeout: 30_000 });
    await assetsPanel.waitForTimeout(400);
    await shot(assetsPanel, '04-assets.png');
    await assetsPanel.close();
    await panel.close();
    await page.close();
  }

  // --- Design-pass review shots --------------------------------------------
  // Not store assets: these are the surfaces at their real sizes, in both
  // schemes and in every state the design pass had to answer for.
  mkdirSync(REVIEW_DIR, { recursive: true });
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(page);

    for (const scheme of ['light', 'dark']) {
      const popup = await openPopup({ tabId, scheme });
      await review(popup, `di-d-popup-${scheme}.png`, { fullPage: true });
      await popup.close();
    }

    // The empty-tab state: nothing to inspect, and the one thing to do about it.
    const blank = await openPopup({
      tabId,
      tabUrl: 'chrome://newtab/',
      state: {
        unsupportedReason:
          'Chrome does not allow extensions on browser pages. Open a normal web page.',
      },
    });
    await review(blank, 'di-d-popup-off.png', { fullPage: true });
    await blank.close();

    // The running state, with the inspector actually on this tab.
    await send({ type: 'inspector.toggle', tabId });
    const active = await openPopup({ tabId });
    await review(active, 'di-d-popup-active.png', { fullPage: true });
    await active.close();
    await send({ type: 'inspector.toggle', tabId });

    for (const scheme of ['light', 'dark']) {
      const panel = await openPanel(tabId, { width: PANEL_WIDTH, scheme });
      await panel.getByRole('button', { name: /Scan this page/ }).first().click();
      await panel.getByRole('heading', { name: 'Palette' }).waitFor({ timeout: 30_000 });
      await panel.waitForTimeout(300);
      await review(panel, `di-d-sidepanel-summary-${scheme}.png`);
      if (scheme === 'light') {
        // Saved, with something in it: one saved summary per capture.
        await panel.getByRole('button', { name: 'Save summary' }).click();
        await panel.getByText('Saved to your collection.').waitFor({ timeout: 10_000 });
        await panel.getByRole('tab', { name: 'Saved' }).click();
        await panel.waitForTimeout(300);
        await review(panel, 'di-d-sidepanel-saved.png');
      }
      await panel.close();
    }

    // The narrow end of the pane. Nothing may hang off the right of it.
    const narrow = await openPanel(tabId, { width: PANEL_NARROW });
    await narrow.getByRole('button', { name: /Scan this page/ }).first().click();
    await narrow.getByRole('heading', { name: 'Palette' }).waitFor({ timeout: 30_000 });
    await narrow.waitForTimeout(300);
    const overflow = await narrow.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    if (overflow.scrollWidth > overflow.clientWidth) {
      throw new Error(
        `The side panel overflows at ${PANEL_NARROW}px: ${overflow.scrollWidth} > ${overflow.clientWidth}`,
      );
    }
    await review(narrow, 'di-d-sidepanel-320.png');
    await narrow.close();
    await page.close();
  }

  // 6. Optional: the same first shot on a real site, if the network allows.
  if (live) {
    const page = await context.newPage();
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    try {
      await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      const tabId = await tabIdFor(page);
      await send({ type: 'inspector.toggle', tabId });
      const heading = page.locator('h1').first();
      await heading.hover();
      await heading.click();
      await page.waitForTimeout(600);
      await shot(page, '06-live-site.png');
      await send({ type: 'inspector.toggle', tabId });
    } catch (error) {
      say(`  skipped the live shot: ${error instanceof Error ? error.message : String(error)}`);
    }
    await page.close();
  } else {
    say('  skipped the live shot (pass --live to attempt it)');
  }
} catch (error) {
  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
  die(`Screenshots failed: ${error instanceof Error ? error.stack : String(error)}`);
}

await context.close();
server.close();
rmSync(profile, { recursive: true, force: true });
console.log(`\x1b[32mDone.\x1b[0m Screenshots are in store/screenshots/ at ${WIDTH}x${HEIGHT}.`);
