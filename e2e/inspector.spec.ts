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

// Extensions cannot inject into file:// pages without an extra grant, so the
// fixtures are served over plain http from a throwaway local server.
let server: Server;
let baseUrl: string;
let session: ExtensionSession;
let control: Page;

const HOST = 'design-inspector-host';

/** Text of every overlay node matching `selector` inside the shadow root. */
async function shadowTexts(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(
    ({ host, selector: sel }) => {
      const root = document.querySelector(host)?.shadowRoot;
      if (!root) return [];
      return Array.from(root.querySelectorAll(sel)).map((node) =>
        (node.textContent ?? '').trim(),
      );
    },
    { host: HOST, selector },
  );
}

/**
 * The element the overlay currently has pinned, as the background reports it.
 * A click travels page -> content script -> worker, so the answer arrives a
 * moment after the click: every caller polls this rather than timing it.
 */
async function pinnedElement(
  tabId: number,
): Promise<{ tag?: string; id?: string | null } | null> {
  const reading = await sendBackground<{
    state?: { pinned: { element: { tag: string; id: string | null } } | null };
  }>(control, { type: 'inspector.getState', tabId });
  return reading.state?.pinned?.element ?? null;
}

async function shadowText(page: Page): Promise<string> {
  return page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    if (!root) return '';
    // Skip the <style> so assertions run against visible copy only.
    return Array.from(root.children)
      .filter((n) => n.tagName !== 'STYLE')
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ');
  }, HOST);
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
  control = await openControlPage(session);
});

test.afterAll(async () => {
  await session?.context.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

test.describe('inspector on the basic fixture', () => {
  test('activates, pins a heading without following its link, and exits on Escape', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);

    const toggled = await toggleInspector(control, tabId);
    expect(toggled).toMatchObject({ ok: true, state: { mode: 'active', unsupportedReason: null } });
    await expect(page.locator(HOST)).toHaveCount(1);

    const heading = page.locator('#hero-heading');
    await heading.hover();
    await expect.poll(() => shadowText(page)).toContain('Inspecting');

    const urlBefore = page.url();
    await heading.click();
    await waitForOverlayIdle(page);
    expect(page.url()).toBe(urlBefore);

    await expect.poll(() => shadowText(page)).toContain('hero-heading');
    const text = await shadowText(page);
    expect(text).toMatch(/\d+px/);
    expect(text).toMatch(/\d+(\.\d+)?rem/);
    // The fixture's first-choice family does not exist; it must never read as verified.
    expect(text).not.toMatch(/verified/i);

    // Escape once clears the pin, twice exits.
    await page.keyboard.press('Escape');
    await waitForOverlayIdle(page);
    await page.keyboard.press('Escape');
    // Exiting takes the host element with it, so its disappearance is the
    // signal that the round trip has landed. Waiting for that beats guessing.
    await expect(page.locator(HOST)).toHaveCount(0);
    const state = await sendBackground<{ ok: boolean; state?: { mode: string } }>(control, {
      type: 'inspector.getState',
      tabId,
    });
    expect(state).toMatchObject({ ok: true, state: { mode: 'off' } });

    // With the inspector off, the link works again.
    await heading.click();
    await expect.poll(() => page.url()).not.toBe(urlBefore);
    await page.close();
  });

  test('scans a page summary with scope and groups, lists assets, and detects nothing false', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    const summary = await sendBackground<{
      ok: boolean;
      summary?: {
        scope: { eligibleElements: number; scannedElements: number; capped: boolean };
        typography: unknown[];
        colors: unknown[];
        spacing: { padding: unknown[] };
        stack: { detections: { name: string }[]; hints: { name: string }[] };
      };
    }>(control, { type: 'summary.request', tabId });
    expect(summary.ok).toBe(true);
    const s = summary.summary!;
    expect(s.scope.scannedElements).toBeGreaterThan(5);
    expect(s.scope.capped).toBe(false);
    expect(s.typography.length).toBeGreaterThan(1);
    expect(s.colors.length).toBeGreaterThan(1);
    expect(s.spacing.padding.length).toBeGreaterThan(0);
    // A plain static fixture must not light up any framework, and must not even
    // leave a hint behind: every marker probe is a miss on this page.
    expect(s.stack.detections.map((d) => d.name)).toEqual([]);
    expect(s.stack.hints.map((h) => h.name)).toEqual([]);

    const assets = await sendBackground<{ ok: boolean; assets?: { kind: string; url: string | null }[] }>(
      control,
      { type: 'assets.request', tabId },
    );
    expect(assets.ok).toBe(true);
    const kinds = new Set(assets.assets!.map((a) => a.kind));
    expect(kinds.has('svg-inline')).toBe(true);
    expect(kinds.has('img') || kinds.has('picture')).toBe(true);
    await page.close();
  });

  test('detects the markers the stack fixture carries, at honest confidences', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/stack-markers.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    const report = await sendBackground<{
      ok: boolean;
      stack?: {
        detections: {
          id: string;
          name: string;
          confidence: string;
          version: string | null;
          evidence: { kind: string; detail: string }[];
        }[];
        hints: { name: string }[];
      };
    }>(control, { type: 'stack.request', tabId });
    expect(report.ok).toBe(true);
    const found = new Map(
      (report.stack?.detections ?? []).map((detection) => [detection.id, detection]),
    );

    // Strong markers, each from one attribute or element on the page.
    for (const id of [
      'gatsby',
      'qwik',
      'hugo',
      'alpine',
      'htmx',
      'swiper',
      'splide',
      'barba',
      'youtube-embed',
      'vimeo-embed',
    ]) {
      expect({ id, confidence: found.get(id)?.confidence }).toEqual({ id, confidence: 'high' });
    }
    // Two weak attributes, so Stimulus is likely rather than certain.
    expect(found.get('stimulus')?.confidence).toBe('likely');
    // The generator meta carries a version, and only that one does.
    expect(found.get('hugo')?.version).toBe('0.128.0');
    expect(found.get('alpine')?.version).toBeNull();
    // Every detection names the evidence it came from (PRD STK acceptance).
    for (const detection of report.stack?.detections ?? []) {
      expect({ id: detection.id, evidence: detection.evidence.length > 0 }).toEqual({
        id: detection.id,
        evidence: true,
      });
    }
    await page.close();
  });

  test('saves a pinned reference and the collection reports it', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await page.locator('#hero-heading').hover();
    await page.locator('#hero-heading').click();
    await waitForOverlayIdle(page);

    await expect
      .poll(async () => {
        const reading = await sendBackground<{ state?: { pinned: unknown } }>(control, {
          type: 'inspector.getState',
          tabId,
        });
        return !!reading.state?.pinned;
      })
      .toBe(true);
    const state = await sendBackground<{ ok: boolean; state?: { pinned: unknown } }>(control, {
      type: 'inspector.getState',
      tabId,
    });
    expect(state.state?.pinned).toBeTruthy();

    const saved = await sendBackground<{ ok: boolean; reference?: { id: string; kind: string }; warning?: string }>(
      control,
      {
        type: 'reference.save',
        tabId,
        snapshot: state.state!.pinned,
        title: 'Hero heading',
        note: 'Fixture note',
        captureScreenshot: true,
      },
    );
    expect(saved.ok).toBe(true);
    expect(saved.reference?.kind).toBe('element');

    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await panel.getByRole('tab', { name: /saved/i }).click();
    await expect(panel.getByRole('textbox', { name: 'Reference title' })).toHaveValue('Hero heading');
    await expect(panel.getByRole('textbox', { name: 'Why I saved this' })).toHaveValue('Fixture note');
    await expect(panel.getByRole('img', { name: /saved screenshot/i })).toBeVisible();
    await panel.close();
    await page.close();
  });

  test('outlines every element while outlines are on and cleans up after itself', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);

    const sheetCount = () =>
      page.locator('style[data-design-inspector-outlines]').count();
    const outlineStyle = (selector: string) =>
      page.evaluate((target) => {
        const element = document.querySelector(target);
        return element ? getComputedStyle(element).outlineStyle : null;
      }, selector);

    expect(await sheetCount()).toBe(0);

    const on = await sendBackground<{ ok: boolean; state?: { outlines: string; mode: string } }>(
      control,
      { type: 'outlines.set', tabId, mode: 'tag' },
    );
    expect(on).toMatchObject({ ok: true, state: { outlines: 'tag' } });
    expect(await sheetCount()).toBe(1);
    expect(await outlineStyle('#flex-row')).toBe('solid');
    // Outlines are their own control: the inspector itself is still off.
    expect(on.state?.mode).toBe('off');

    const depth = await sendBackground<{ ok: boolean; state?: { outlines: string } }>(control, {
      type: 'outlines.set',
      tabId,
      mode: 'depth',
    });
    expect(depth).toMatchObject({ ok: true, state: { outlines: 'depth' } });
    expect(await sheetCount()).toBe(1);
    expect(await outlineStyle('#flex-row')).toBe('solid');

    const off = await sendBackground<{ ok: boolean; state?: { outlines: string } }>(control, {
      type: 'outlines.set',
      tabId,
      mode: 'off',
    });
    expect(off).toMatchObject({ ok: true, state: { outlines: 'off' } });
    expect(await sheetCount()).toBe(0);
    expect(await outlineStyle('#flex-row')).toBe('none');

    // Exiting the inspector removes the sheet too, wherever it came from.
    await sendBackground(control, { type: 'outlines.set', tabId, mode: 'tag' });
    await sendBackground(control, { type: 'inspector.setMode', tabId, mode: 'active' });
    expect(await sheetCount()).toBe(1);
    await sendBackground(control, { type: 'inspector.setMode', tabId, mode: 'off' });
    expect(await sheetCount()).toBe(0);
    await page.close();
  });

  test('draws the grid overlay with track labels on a pinned grid container', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await page.locator('#grid').scrollIntoViewIfNeeded();

    const selected = await sendBackground<{ ok: boolean; error?: string }>(control, {
      type: 'element.select',
      tabId,
      locator: '#grid',
    });
    expect(selected.ok).toBe(true);
    await waitForOverlayIdle(page);
    // The layer is drawn from a rAF callback after the selection message, so
    // the labels are waited for rather than read once and hoped for.
    await expect
      .poll(async () => (await shadowTexts(page, '#layout-layer .track-label')).length)
      .toBeGreaterThanOrEqual(5);

    const labels = await shadowTexts(page, '#layout-layer .track-label');
    // The fixture's three columns resolve to equal px tracks, plus two rows.
    expect(labels.length).toBeGreaterThanOrEqual(5);
    expect(labels.every((label) => /^\d+(\.\d+)?px$/.test(label))).toBe(true);
    const lines = await shadowTexts(page, '#layout-layer .grid-line');
    expect(lines.length).toBeGreaterThan(0);
    const bands = await shadowTexts(page, '#layout-layer .tint-band');
    // Two column gaps and one row gap.
    expect(bands).toHaveLength(3);

    await page.screenshot({ path: artifactPath('di-f-grid.png') });

    // Unpinning clears the layer.
    await page.keyboard.press('Escape');
    await expect.poll(() => shadowTexts(page, '#layout-layer .track-label')).toEqual([]);
    await page.close();
  });

  test('draws the flex overlay with a gap band for the fixture gap', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await page.locator('#flex-row').scrollIntoViewIfNeeded();

    const selected = await sendBackground<{ ok: boolean }>(control, {
      type: 'element.select',
      tabId,
      locator: '#flex-row',
    });
    expect(selected.ok).toBe(true);
    await waitForOverlayIdle(page);
    await expect
      .poll(async () => (await shadowTexts(page, '#layout-layer .track-label')).length)
      .toBeGreaterThan(0);

    // #flex-row sets `gap: 12px 20px` and `justify-content: space-between`, so
    // each band reports the distance it actually paints plus that 20px gap.
    const labels = await shadowTexts(page, '#layout-layer .track-label');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => /^\d+(\.\d+)?px( \(gap 20px\))?$/.test(label))).toBe(true);
    expect(labels.some((label) => label.includes('20px'))).toBe(true);
    expect(await shadowTexts(page, '#layout-layer .axis-line')).toHaveLength(1);

    await page.screenshot({ path: artifactPath('di-f-flex.png') });
    await page.close();
  });

  test('measures from the pinned heading to another element while Alt is held', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    await page.locator('#hero-heading').hover();
    await page.locator('#hero-heading').click();
    await expect.poll(() => shadowText(page)).toContain('hero-heading');

    await page.keyboard.down('Alt');
    await page.locator('#translucent-card').hover();
    // Alt plus a hover starts the measurement on the next frame, and the panel
    // repaints with it. Both are waited for, not timed.
    await expect
      .poll(async () => (await shadowTexts(page, '#measure-layer .measure-label')).length)
      .toBeGreaterThan(0);
    await expect.poll(() => shadowText(page)).toMatch(/Gap [xy]/);

    const labels = await shadowTexts(page, '#measure-layer .measure-label');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((label) => /\d+(\.\d+)?px/.test(label))).toBe(true);
    expect(await shadowTexts(page, '#measure-layer .measure-outline')).toHaveLength(1);

    const panel = await shadowText(page);
    expect(panel).toContain('Measure');
    expect(panel).toMatch(/Gap [xy]/);

    await page.screenshot({ path: artifactPath('di-f-measure.png') });

    await page.keyboard.up('Alt');
    await page.locator('#hero-sub').hover();
    await expect.poll(() => shadowTexts(page, '#measure-layer .measure-label')).toEqual([]);
    await page.close();
  });

  test('offers the eyedropper button when the browser has the native picker', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await expect(page.locator(HOST)).toHaveCount(1);
    await waitForOverlayIdle(page);

    // EyeDropper cannot be driven headlessly, so this only checks that the
    // control follows the browser's own feature detection.
    const supported = await page.evaluate(() => 'EyeDropper' in window);
    const buttons = await shadowTexts(page, '#badge-pick');
    expect(buttons).toEqual(supported ? ['Pick color'] : []);
    await page.close();
  });

  test('filters the side panel summary and counts what is shown', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    // The panel reads the active tab, so the fixture has to be the active one.
    await session.worker.evaluate(async (id) => {
      await chrome.tabs.update(id, { active: true });
    }, tabId);
    // The panel offers its scan button once it has resolved that tab, so the
    // button being there is the condition, not a guess at how long it takes.
    const scanButton = panel.getByRole('button', { name: /scan this page/i });
    await expect(scanButton).toBeEnabled();

    await scanButton.click();
    await expect(panel.getByRole('heading', { name: 'Palette' })).toBeVisible();

    const filter = panel.getByRole('searchbox', { name: 'Filter the summary' });
    await filter.fill('px');
    await expect(panel.getByText(/\d+ of \d+ shown/)).toBeVisible();
    await panel.screenshot({ path: artifactPath('di-f-filter.png') });

    // Nothing matches this, so every filtered section says so.
    await filter.fill('zzzz');
    await expect(panel.getByText('No matches in Palette')).toBeVisible();
    await expect(panel.getByText('No matches in Spacing')).toBeVisible();

    await filter.press('Escape');
    await expect(panel.getByRole('heading', { name: 'Palette' })).toBeVisible();
    await expect(panel.getByText(/\d+ of \d+ shown/)).toHaveCount(0);

    await panel.close();
    await page.close();
  });

  test('reads typography for a heading whose text sits in a child', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    const selected = await sendBackground<{ ok: boolean; error?: string }>(control, {
      type: 'element.select',
      tabId,
      locator: '#wrapped-heading',
    });
    expect(selected.ok).toBe(true);
    await expect.poll(() => pinnedElement(tabId)).toMatchObject({ tag: 'h2' });

    const state = await sendBackground<{
      ok: boolean;
      state?: {
        pinned: {
          element: { tag: string };
          typography: { sizePx: number; weight: number } | null;
        };
      };
    }>(control, { type: 'inspector.getState', tabId });
    const pinned = state.state!.pinned;
    expect(pinned.element.tag).toBe('h2');
    expect(pinned.typography).not.toBeNull();
    expect(pinned.typography!.sizePx).toBe(24);
    expect(pinned.typography!.weight).toBe(600);

    const text = await shadowText(page);
    expect(text).toContain('24px');
    await page.close();
  });

  test('pins the whole svg when the click lands on one of its paths', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await page.locator('#logo-svg').scrollIntoViewIfNeeded();

    // The fixture's svg paints through <use>, so the click lands inside it.
    await page.locator('#logo-svg').click({ position: { x: 24, y: 36 } });

    await expect.poll(() => pinnedElement(tabId)).toMatchObject({ tag: 'svg', id: 'logo-svg' });
    await page.close();
  });

  test('overlays a mockup through the injection path with the inspector off', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);

    // A 1x1 PNG is enough: this asserts the layer and its settings, not decode.
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const set = await sendBackground<{ ok: boolean; state?: { mode: string; mockup: unknown } }>(
      control,
      {
        type: 'mockup.set',
        tabId,
        mockup: {
          dataUrl,
          opacity: 0.42,
          x: 40,
          y: 60,
          scale: 2,
          visible: true,
          blend: 'difference',
          locked: false,
        },
      },
    );
    expect(set.ok).toBe(true);
    // The mockup needs no inspector: it went through the injection path.
    expect(set.state?.mode).toBe('off');
    expect(set.state?.mockup).toMatchObject({ opacity: 0.42, x: 40, y: 60, blend: 'difference' });

    const layer = await page.evaluate(() => {
      const image = document
        .querySelector('design-inspector-mockup')
        ?.shadowRoot?.getElementById('mockup') as HTMLImageElement | null;
      if (!image) return null;
      const style = getComputedStyle(image);
      return {
        hidden: image.hidden,
        hasSrc: image.src.startsWith('data:image/png'),
        opacity: style.opacity,
        blend: style.mixBlendMode,
        left: image.style.left,
        top: image.style.top,
        transform: image.style.transform,
        tabindex: image.getAttribute('tabindex'),
      };
    });
    expect(layer).toMatchObject({
      hidden: false,
      hasSrc: true,
      opacity: '0.42',
      blend: 'difference',
      left: '40px',
      top: '60px',
      transform: 'scale(2)',
      tabindex: '0',
    });

    // A 1x1 pixel proves the wiring but shows nothing, so the screenshot is
    // taken over a comp with real dimensions.
    const comp =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320">' +
          '<rect width="560" height="320" fill="#7c3aed"/>' +
          '<rect x="32" y="32" width="300" height="56" fill="#ffffff"/>' +
          '<rect x="32" y="120" width="460" height="16" fill="#ffffff" opacity="0.7"/>' +
          '<rect x="32" y="156" width="400" height="16" fill="#ffffff" opacity="0.7"/>' +
          '</svg>',
      );
    await sendBackground(control, {
      type: 'mockup.set',
      tabId,
      mockup: {
        dataUrl: comp,
        opacity: 0.55,
        x: 200,
        y: 120,
        scale: 1,
        visible: true,
        blend: 'normal',
        locked: false,
      },
    });
    // The comp is an SVG data URL, so the layer paints once the image decodes.
    await page
      .locator('design-inspector-mockup')
      .evaluate(async (host) => {
        const image = (host as HTMLElement).shadowRoot?.getElementById(
          'mockup',
        ) as HTMLImageElement | null;
        if (image && !image.complete) await image.decode().catch(() => undefined);
      });
    await waitForOverlayIdle(page);
    await page.screenshot({ path: artifactPath('di-q-mockup.png') });

    // Clearing it takes the layer with it.
    const cleared = await sendBackground<{ ok: boolean; state?: { mockup: unknown } }>(control, {
      type: 'mockup.set',
      tabId,
      mockup: null,
    });
    expect(cleared.state?.mockup).toBeNull();
    await expect(page.locator('design-inspector-mockup')).toHaveCount(0);
    await page.close();
  });

  test('draws four point-to-edge guides while Shift is held', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    await page.locator('#padded-card').scrollIntoViewIfNeeded();
    await page.keyboard.down('Shift');
    // Inside the padded card, off its inner box, so all four edges are real.
    await page.locator('#padded-card').hover({ position: { x: 20, y: 20 } });
    await expect
      .poll(async () => (await shadowTexts(page, '#edge-layer .edge-guide-label')).length)
      .toBe(4);

    const labels = await shadowTexts(page, '#edge-layer .edge-guide-label');
    expect(labels).toHaveLength(4);
    expect(labels.every((label) => /^>?\d+(\.\d+)?px$/.test(label))).toBe(true);
    expect(await shadowTexts(page, '#edge-layer .edge-guide')).toHaveLength(4);
    expect(await shadowTexts(page, '#edge-layer .edge-dot')).toHaveLength(1);

    // The method is stated wherever the numbers are.
    const text = await shadowText(page);
    expect(text).toContain('Nearest element edges, geometric');

    await page.screenshot({ path: artifactPath('di-q-edges.png') });

    await page.keyboard.up('Shift');
    await page.mouse.move(10, 10);
    await expect.poll(() => shadowTexts(page, '#edge-layer .edge-guide-label')).toEqual([]);
    await page.close();
  });

  test('shows rulers with ticks and drops a guide where the ruler is clicked', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await expect(page.locator(HOST)).toHaveCount(1);
    await waitForOverlayIdle(page);

    // The badge's Rulers toggle is the entry point.
    await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      (root?.getElementById('badge-rulers') as HTMLButtonElement | null)?.click();
    }, HOST);
    await expect
      .poll(async () => (await shadowTexts(page, '#ruler-top .tick')).length)
      .toBeGreaterThan(5);

    const ticks = await shadowTexts(page, '#ruler-top .tick');
    expect(ticks.length).toBeGreaterThan(5);
    const labels = await shadowTexts(page, '#ruler-top .tick-label');
    expect(labels).toContain('0');
    expect(labels.every((label) => Number(label) % 100 === 0)).toBe(true);
    expect((await shadowTexts(page, '#ruler-left .tick')).length).toBeGreaterThan(5);

    // A click on the top ruler drops a vertical guide at that position.
    await page.mouse.click(300, 9);
    await expect
      .poll(() =>
        page.evaluate(
          (host) => document.querySelector(host)?.shadowRoot?.querySelectorAll('.page-guide').length ?? 0,
          HOST,
        ),
      )
      .toBe(1);
    const guides = await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      return Array.from(root?.querySelectorAll('.page-guide') ?? []).map((node) => ({
        axis: (node as HTMLElement).dataset.axis,
        left: (node as HTMLElement).style.left,
      }));
    }, HOST);
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ axis: 'x', left: '300px' });

    await page.screenshot({ path: artifactPath('di-q-rulers.png') });
    await page.close();
  });

  test('removes a guide by a double press and by the Delete key (F2)', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await expect(page.locator(HOST)).toHaveCount(1);
    await waitForOverlayIdle(page);

    await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      (root?.getElementById('badge-rulers') as HTMLButtonElement | null)?.click();
    }, HOST);
    await expect
      .poll(async () => (await shadowTexts(page, '#ruler-top .tick')).length)
      .toBeGreaterThan(5);

    const guideCount = async (): Promise<number> =>
      page.evaluate((host) => {
        const root = document.querySelector(host)?.shadowRoot;
        return root?.querySelectorAll('.page-guide').length ?? 0;
      }, HOST);

    // A real double click on the guide: the layer captures the pointer, so the
    // browser never delivers a dblclick and the two presses have to carry it.
    await page.mouse.click(300, 9);
    await expect.poll(guideCount).toBe(1);

    const label = await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      const guide = root?.querySelector('.page-guide');
      return guide?.getAttribute('aria-label') ?? '';
    }, HOST);
    expect(label).toContain('double-click or press Delete to remove');

    await page.mouse.dblclick(300, 400);
    await expect.poll(guideCount).toBe(0);

    // A second guide, removed from the keyboard.
    await page.mouse.click(420, 9);
    await expect.poll(guideCount).toBe(1);
    await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      (root?.querySelector('.page-guide') as HTMLElement | null)?.focus();
    }, HOST);
    await page.keyboard.press('Delete');
    await expect.poll(guideCount).toBe(0);

    // And a third, removed from its own control.
    await page.mouse.click(520, 9);
    await expect.poll(guideCount).toBe(1);
    const control_ = await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      const node = root?.querySelector('[data-role="guide-remove"]') as HTMLElement | null;
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, HOST);
    expect(control_).not.toBeNull();
    await page.mouse.click(control_?.x ?? 0, control_?.y ?? 0);
    await expect.poll(guideCount).toBe(0);

    await page.screenshot({ path: artifactPath('di-y-guides.png') });
    await page.close();
  });

  test('keeps the badge inside a 390px viewport (F6)', async () => {
    const page = await session.context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await expect(page.locator(HOST)).toHaveCount(1);

    const read = async () =>
      page.evaluate((host) => {
        const root = document.querySelector(host)?.shadowRoot;
        const badge = root?.getElementById('badge') as HTMLElement | null;
        if (!badge) return null;
        const rect = badge.getBoundingClientRect();
        return { left: rect.left, right: rect.right, collapsed: badge.dataset.collapsed };
      }, HOST);

    await expect.poll(async () => (await read())?.collapsed).toBe('true');
    const collapsed = await read();
    // A phone width viewport opens collapsed, and inside the viewport.
    expect(collapsed?.collapsed).toBe('true');
    expect(collapsed?.left ?? -1).toBeGreaterThanOrEqual(0);

    await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      (root?.getElementById('badge-collapse') as HTMLButtonElement | null)?.click();
    }, HOST);
    await expect.poll(async () => (await read())?.collapsed).toBe('false');

    const expanded = await read();
    expect(expanded?.collapsed).toBe('false');
    // Expanded it wraps rather than running off the left edge of the screen.
    expect(expanded?.left ?? -1).toBeGreaterThanOrEqual(0);
    expect(expanded?.right ?? 0).toBeLessThanOrEqual(390);

    await page.screenshot({ path: artifactPath('di-y-badge-390.png') });
    await page.close();
  });

  test('an unlocked mockup no longer eats the inspection click (F4)', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    // A comp large enough to cover the hero, unlocked, the shape that used to
    // swallow every click underneath it.
    const comp =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">' +
          '<rect width="1200" height="800" fill="#7c3aed"/></svg>',
      );
    await sendBackground(control, {
      type: 'mockup.set',
      tabId,
      mockup: {
        dataUrl: comp,
        opacity: 0.4,
        x: 0,
        y: 0,
        scale: 1,
        visible: true,
        blend: 'normal',
        locked: false,
      },
    });
    await expect(page.locator('design-inspector-mockup')).toHaveCount(1);
    await waitForOverlayIdle(page);

    // The image is never a pointer target, whatever its lock state is.
    const pointerEvents = await page.evaluate(() => {
      const image = document
        .querySelector('design-inspector-mockup')
        ?.shadowRoot?.getElementById('mockup') as HTMLImageElement | null;
      return image ? getComputedStyle(image).pointerEvents : null;
    });
    expect(pointerEvents).toBe('none');

    await page.locator('#hero-heading').click();
    await expect.poll(() => pinnedElement(tabId)).toMatchObject({ id: 'hero-heading' });

    await page.screenshot({ path: artifactPath('di-y-mockup-click.png') });
    await sendBackground(control, { type: 'mockup.set', tabId, mockup: null });
    await page.close();
  });

  test('pins the h2 when the click lands on its inline text wrapper', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    await page.locator('#wrapped-heading span').click();
    await expect
      .poll(() => pinnedElement(tabId))
      .toMatchObject({ tag: 'h2', id: 'wrapped-heading' });

    // The wrapper is still one click away, as the trailing breadcrumb chip.
    const crumbs = await shadowTexts(page, '[data-role="child-crumb"]');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]).toContain('span');

    // Turning the preference off on the badge selects exactly what is clicked.
    await page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      (root?.getElementById('badge-semantic') as HTMLButtonElement | null)?.click();
    }, HOST);
    await page.keyboard.press('Escape');
    await expect.poll(() => pinnedElement(tabId)).toBeNull();
    await page.locator('#wrapped-heading span').click();
    await expect
      .poll(() => pinnedElement(tabId))
      .toMatchObject({ tag: 'span', id: 'wrapped-heading-text' });
    await page.close();
  });

  test('scrolls an offscreen element into view for element.select when asked', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Without the flag the offscreen element is refused, not scrolled to.
    const refused = await sendBackground<{ ok: boolean; error?: string }>(control, {
      type: 'element.select',
      tabId,
      locator: '#far-below',
    });
    expect(refused).toMatchObject({ ok: false, error: 'Element is offscreen' });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    const selected = await sendBackground<{ ok: boolean }>(control, {
      type: 'element.select',
      tabId,
      locator: '#far-below',
      scroll: true,
    });
    expect(selected.ok).toBe(true);
    // The scroll is smooth, so the page keeps moving after the reply lands.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect.poll(() => pinnedElement(tabId)).toMatchObject({ id: 'far-below' });
    await page.close();
  });

  test('offers the Tools tab with the mockup controls in the side panel', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);

    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await session.worker.evaluate(async (id) => {
      await chrome.tabs.update(id, { active: true });
    }, tabId);
    await expect(panel.getByRole('tab', { name: 'Tools' })).toBeEnabled();

    await panel.getByRole('tab', { name: 'Tools' }).click();
    await expect(panel.getByRole('tab', { name: 'Tools' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(panel.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await expect(panel.getByRole('heading', { name: 'Mockup overlay' })).toBeVisible();
    await expect(panel.getByLabel('Mockup image')).toBeVisible();
    await expect(panel.getByText('Drop a PNG, JPG, WebP or SVG here')).toBeVisible();

    // The colour transition would otherwise be caught mid-flight by the shot.
    // 150ms is the transition-colors duration the shared components use.
    await panel.waitForTimeout(300);
    await panel.screenshot({ path: artifactPath('di-q-tools.png') });
    await panel.close();
    await page.close();
  });

  test('uses the document root font size for rem', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-root20.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await page.locator('#hero-heading').hover();
    await page.locator('#hero-heading').click();
    await expect.poll(() => pinnedElement(tabId)).toMatchObject({ id: 'hero-heading' });
    const state = await sendBackground<{
      ok: boolean;
      state?: { pinned: { source: { rootFontSize: number }; typography: { sizePx: number; sizeRem: number } } };
    }>(control, { type: 'inspector.getState', tabId });
    const pinned = state.state!.pinned;
    expect(pinned.source.rootFontSize).toBe(20);
    expect(pinned.typography.sizeRem).toBeCloseTo(pinned.typography.sizePx / 20, 3);
    await page.close();
  });

  test('reads rem first and says why when the root font size is fluid (V1)', async () => {
    const page = await session.context.newPage();
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(`${baseUrl}/inspector-fluid.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await page.locator('#hero-heading').hover();
    await page.locator('#hero-heading').click();
    await expect.poll(() => pinnedElement(tabId)).toMatchObject({ id: 'hero-heading' });

    const state = await sendBackground<{
      ok: boolean;
      state?: {
        pinned: {
          source: { rootFontSize: number; rootFontSizeAuthored: string; rootFontSizeFluid: boolean };
        };
      };
    }>(control, { type: 'inspector.getState', tabId });
    const source = state.state!.pinned.source;
    expect(source.rootFontSizeFluid).toBe(true);
    expect(source.rootFontSizeAuthored).toContain('clamp(');
    // 1vw of a 1200px viewport is 12px, which the clamp lifts to its 14px
    // floor. The computed root is a whole number here and the reading is still
    // fluid, because the authored value says so.
    expect(source.rootFontSize).toBeCloseTo(14, 1);

    const text = await shadowText(page);
    expect(text).toContain('scales with the viewport');
    expect(text).toContain('rem is the stable reading');
    // rem first, px after it, said to be a reading at this width.
    expect(text).toMatch(/Size\s*3\.75rem · [\d.]+px at this width/);
    await page.screenshot({ path: artifactPath('di-v-fluid-typography.png') });
    await page.close();
  });
});

test.describe('side panel presence and the page badge (W)', () => {
  /**
   * The panel page with its active-tab lookup answered by the fixture's tab.
   * A Playwright-driven extension page cannot be the window's active tab, and
   * everything downstream of that answer is the real thing.
   */
  async function openPanel(fixtureTabId: number): Promise<Page> {
    const panel = await session.context.newPage();
    await panel.setViewportSize({ width: 420, height: 960 });
    await panel.addInitScript((tabId: number) => {
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
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    return panel;
  }

  /** How the badge on the page is showing itself right now. */
  async function badgeState(page: Page): Promise<{ collapsed: string; title: string } | null> {
    return page.evaluate((host) => {
      const root = document.querySelector(host)?.shadowRoot;
      const badge = root?.getElementById('badge') as HTMLElement | null;
      const dot = root?.getElementById('badge-collapse') as HTMLElement | null;
      if (!badge || !dot) return null;
      return {
        collapsed: badge.dataset.collapsed ?? '',
        title: dot.getAttribute('title') ?? '',
      };
    }, HOST);
  }

  test('steps the badge aside while the panel is open, and drives the tools from it', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);
    await expect.poll(async () => (await badgeState(page))?.collapsed).toBe('false');

    const panel = await openPanel(tabId);
    await expect(panel.getByRole('group', { name: 'Page tools' })).toBeVisible();

    await sendBackground(control, { type: 'sidepanel.presence', tabId, open: true });
    await expect.poll(async () => (await badgeState(page))?.collapsed).toBe('true');
    // The dot says where the controls went rather than only how to undo this.
    expect((await badgeState(page))?.title).toBe(
      'Controls are in the side panel. Click to expand.',
    );
    await page.screenshot({ path: artifactPath('di-w-badge-collapsed.png') });

    // A tool pressed in the panel acts on the page, exactly as the badge did.
    const rulers = panel.getByRole('button', { name: 'Rulers' });
    await expect(rulers).toHaveAttribute('aria-pressed', 'false');
    await rulers.click();
    await expect.poll(() =>
      page.evaluate((host) => {
        const root = document.querySelector(host)?.shadowRoot;
        const layer = root?.getElementById('ruler-layer') as HTMLElement | null;
        if (!layer) return false;
        return !layer.hidden && layer.getClientRects().length > 0;
      }, HOST),
    ).toBe(true);
    await expect(rulers).toHaveAttribute('aria-pressed', 'true');

    // The row mirrors the page: the badge's own Rulers button agrees with it.
    expect(
      await page.evaluate((host) => {
        const root = document.querySelector(host)?.shadowRoot;
        return root?.getElementById('badge-rulers')?.getAttribute('aria-pressed');
      }, HOST),
    ).toBe('true');

    // 150ms of transition-colors on the tool row, doubled so the shot is taken
    // after it has settled rather than during it.
    await panel.waitForTimeout(300);
    await panel.screenshot({ path: artifactPath('di-w-panel-tools.png') });

    // The panel closing gives the badge back.
    await sendBackground(control, { type: 'sidepanel.presence', tabId, open: false });
    await expect.poll(async () => (await badgeState(page))?.collapsed).toBe('false');

    await panel.close();
    await page.close();
  });
});
