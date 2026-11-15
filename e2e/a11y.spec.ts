
















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
import { waitForOverlayIdle } from './helpers/timing';

let server: Server;
let baseUrl: string;
let session: ExtensionSession;


const MIN_INDICATOR_CONTRAST = 3;

const MIN_FONT_PX = 12;

interface AuditFinding {
  kind: string;
  detail: string;
}

interface FocusStop {
  name: string;
  tag: string;
  outlineColor: string;
  outlineWidth: string;
  outlineStyle: string;
  background: string;
  contrast: number;
}





async function installAudit(page: Page, minFontPx: number): Promise<void> {
  await page.evaluate((floor: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    type Rgba = [number, number, number, number];


    const toRgba = (value: string): Rgba | null => {
      if (!value) return null;
      ctx.fillStyle = '#000000';
      ctx.fillStyle = value;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return [data[0]!, data[1]!, data[2]!, data[3]! / 255];
    };

    const over = (fg: Rgba, bg: Rgba): Rgba => {
      const alpha = fg[3];
      if (alpha >= 1) return [fg[0], fg[1], fg[2], 1];
      return [
        fg[0] * alpha + bg[0] * (1 - alpha),
        fg[1] * alpha + bg[1] * (1 - alpha),
        fg[2] * alpha + bg[2] * (1 - alpha),
        1,
      ];
    };

    const luminance = (rgb: Rgba): number => {
      const channel = (raw: number): number => {
        const s = raw / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    };

    const contrast = (a: Rgba, b: Rgba): number => {
      const x = luminance(a) + 0.05;
      const y = luminance(b) + 0.05;
      return x > y ? x / y : y / x;
    };





    const backgroundBehind = (element: Element): Rgba => {
      const stack: Rgba[] = [];
      let node: Element | null = element.parentElement;
      while (node) {
        const colour = toRgba(getComputedStyle(node).backgroundColor);
        if (colour && colour[3] > 0) {
          stack.push(colour);
          if (colour[3] >= 1) break;
        }
        node = node.parentElement;
      }
      const root = toRgba(getComputedStyle(document.documentElement).backgroundColor);
      let base: Rgba = root && root[3] >= 1 ? root : [255, 255, 255, 1];
      for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i]!, base);
      return base;
    };

    const accessibleName = (element: Element): string => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map(id => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (text) return text;
      }
      const label = (element.getAttribute('aria-label') ?? '').trim();
      if (label) return label;
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) return text;
      const title = (element.getAttribute('title') ?? '').trim();
      if (title) return title;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) {
        const id = element.getAttribute('id');
        if (id) {
          const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          const explicitText = explicit?.textContent?.replace(/\s+/g, ' ').trim();
          if (explicitText) return explicitText;
        }
        const wrapping = element.closest('label')?.textContent?.replace(/\s+/g, ' ').trim();
        if (wrapping) return wrapping;
        const placeholder = (element.getAttribute('placeholder') ?? '').trim();
        if (placeholder) return placeholder;
      }
      return '';
    };

    const visible = (element: Element): boolean => {
      if (element.closest('[hidden]')) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    };

    const describe = (element: Element): string => {
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const classes = (element.getAttribute('class') ?? '').slice(0, 50);
      return `${element.tagName.toLowerCase()}${text ? ` "${text}"` : ''}${classes ? ` .${classes}` : ''}`;
    };

    const findings = (): AuditFinding[] => {
      const out: AuditFinding[] = [];
      const add = (kind: string, element: Element): void => {
        out.push({ kind, detail: describe(element) });
      };

      for (const element of document.querySelectorAll(
        'button, [role="button"], [role="tab"], a[href]',
      )) {
        if (visible(element) && !accessibleName(element)) add('control-without-name', element);
      }
      for (const element of document.querySelectorAll('img')) {
        if (element.getAttribute('alt') === null) add('img-without-alt', element);
      }
      for (const element of document.querySelectorAll<HTMLInputElement>(
        'input, select, textarea',
      )) {
        if (!visible(element) || element.type === 'hidden') continue;
        if (!accessibleName(element)) add('field-without-label', element);
      }
      for (const element of document.querySelectorAll('[role="tab"]')) {
        if (!element.hasAttribute('aria-selected')) add('tab-without-selected', element);
        if (!element.hasAttribute('aria-controls')) add('tab-without-controls', element);
      }
      for (const element of document.querySelectorAll('body *')) {
        if (!visible(element)) continue;
        const ownsText = [...element.childNodes].some(
          node => node.nodeType === 3 && (node.textContent ?? '').trim() !== '',
        );
        if (!ownsText) continue;
        const style = getComputedStyle(element);
        const size = Number.parseFloat(style.fontSize);
        if (Number.isFinite(size) && size < floor) {
          out.push({ kind: 'text-too-small', detail: `${size}px ${describe(element)}` });
        }





        if (Number.parseFloat(style.opacity) === 0) continue;



        const disabled =
          (element as HTMLButtonElement).disabled === true ||
          element.getAttribute('aria-disabled') === 'true' ||
          !!element.closest('[disabled], [aria-disabled="true"]');
        if (disabled) continue;
        const foreground = toRgba(style.color);
        if (!foreground) continue;



        const under = backgroundBehind(element);
        const own = toRgba(style.backgroundColor);
        const behind = own && own[3] > 0 ? over(own, under) : under;
        const painted = over(foreground, behind);
        const ratio = contrast(painted, behind);
        const weight = Number.parseFloat(style.fontWeight) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const minimum = large ? 3 : 4.5;
        if (ratio + 0.005 < minimum) {
          out.push({
            kind: 'text-contrast',
            detail: `${ratio.toFixed(2)}:1 (needs ${minimum}) ${style.color} on ${
              `rgb(${behind.slice(0, 3).map(Math.round).join(', ')})`
            } ${describe(element)}`,
          });
        }
      }
      return out;
    };

    const measure = (element: Element): FocusStop => {
      const style = getComputedStyle(element);
      const outline = toRgba(style.outlineColor) ?? ([0, 0, 0, 0] as Rgba);
      const background = backgroundBehind(element);
      return {
        name: accessibleName(element) || describe(element),
        tag: element.tagName.toLowerCase(),
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        background: `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`,
        contrast: contrast(over(outline, background), background),
      };
    };

    (
      window as unknown as {
        __audit: { findings: () => AuditFinding[]; measure: (element: Element) => FocusStop };
      }
    ).__audit = { findings, measure };
  }, minFontPx);
}

async function runFindings(page: Page): Promise<AuditFinding[]> {
  await installAudit(page, MIN_FONT_PX);
  return page.evaluate(
    () => (window as unknown as { __audit: { findings: () => AuditFinding[] } }).__audit.findings(),
  );
}






async function walkTabOrder(page: Page, anchor: string, steps: number): Promise<FocusStop[]> {
  await installAudit(page, MIN_FONT_PX);
  await page.locator(anchor).first().click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const stops: FocusStop[] = [];
  for (let step = 0; step < steps; step += 1) {
    await page.keyboard.press('Tab');





    await page.waitForTimeout(220);
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      return (
        window as unknown as { __audit: { measure: (node: Element) => FocusStop } }
      ).__audit.measure(element);
    });
    if (stop) stops.push(stop);
  }
  return stops;
}



async function openPanel(fixtureTabId: number): Promise<Page> {
  const page = await session.context.newPage();
  await page.setViewportSize({ width: 420, height: 960 });
  await page.addInitScript((tabId: number) => {
    const apply = (api: typeof chrome): void => {
      const real = api.tabs.query.bind(api.tabs);
      api.tabs.query = ((info: chrome.tabs.QueryInfo) => {
        if (info?.active && info?.currentWindow) {
          return api.tabs.get(tabId).then(tab => [tab]);
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
  await panel.getByRole('button', { name: /Scan this page|Refresh$/ }).first().click();
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
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
});






test.beforeEach(async () => {
  session = await launchWithExtension();
  await openControlPage(session);
});

test.afterEach(async () => {
  await session?.context.close();
});

test.describe('side panel accessibility', () => {
  test('a scanned panel passes the name, alt, label, and type-size audit', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);

    const panel = await openPanel(tabId);
    await scan(panel);
    expect(await runFindings(panel), 'Summary tab').toEqual([]);



    await panel.getByRole('tab', { name: 'Assets' }).click();
    await panel.getByRole('button', { name: 'List assets' }).click();
    await expect(panel.getByText(/assets discovered/)).toBeVisible({ timeout: 30_000 });
    expect(await runFindings(panel), 'Assets tab').toEqual([]);

    await panel.getByRole('tab', { name: 'Saved' }).click();
    await expect(panel.getByRole('button', { name: 'Select all' })).toBeVisible();
    expect(await runFindings(panel), 'Saved tab').toEqual([]);

    await panel.getByRole('tab', { name: 'Tools' }).click();
    await expect(panel.getByRole('heading', { name: 'Mockup overlay' })).toBeVisible();
    expect(await runFindings(panel), 'Tools tab').toEqual([]);

    await page.close();
    await panel.close();
  });

  test('the tab list is a single tab stop that answers the arrow keys', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    const panel = await openPanel(tabId);

    const tabs = panel.getByRole('tab');
    await expect(tabs).toHaveCount(5);

    const tabIndexes = await tabs.evaluateAll(nodes =>
      nodes.map(node => (node as HTMLElement).tabIndex),
    );
    expect(tabIndexes.filter(value => value === 0)).toHaveLength(1);

    await panel.getByRole('tab', { name: 'Summary' }).focus();
    await panel.keyboard.press('ArrowRight');
    await expect(panel.getByRole('tab', { name: 'Assets' })).toHaveAttribute('aria-selected', 'true');
    await panel.keyboard.press('End');
    await expect(panel.getByRole('tab', { name: 'Saved' })).toHaveAttribute('aria-selected', 'true');
    await panel.keyboard.press('Home');
    await expect(panel.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');

    await page.close();
    await panel.close();
  });

  test('the tab order reaches the primary actions in a sensible order', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    const panel = await openPanel(tabId);
    await scan(panel);

    const names = (await walkTabOrder(panel, 'header p', 14)).map(stop => stop.name);

    expect(
      names.some(name => /^(Inspect this page|Stop inspecting|Resume inspecting)$/.test(name)),
      names.join(' | '),
    ).toBe(true);
    expect(names).toContain('Summary');
    expect(names).toContain('Refresh');
    expect(names).toContain('Save summary');
    expect(names).toContain('Copy Markdown');
    expect(names).toContain('Download JSON');

    expect(names.indexOf('Summary')).toBeLessThan(names.indexOf('Refresh'));

    await page.close();
    await panel.close();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the focus indicator clears 3:1 against its background in ${scheme} mode`, async () => {
      const page = await session.context.newPage();
      await page.goto(`${baseUrl}/inspector-basic.html`);
      const tabId = await tabIdFor(session.worker, page);
      const panel = await openPanel(tabId);
      await panel.emulateMedia({ colorScheme: scheme });
      await scan(panel);

      await panel.evaluate(async () => {
        await Promise.all(document.getAnimations().map((animation) => animation.finished));
      });



      expect(await runFindings(panel), `${scheme} audit`).toEqual([]);

      const stops = await walkTabOrder(panel, 'header p', 16);
      expect(stops.length, 'focus stops walked').toBeGreaterThan(6);


      const worst = stops.reduce((low, stop) => (stop.contrast < low.contrast ? stop : low));
      // eslint-disable-next-line no-console
      console.log(
        `[a11y] ${scheme}: ${stops.length} focus stops, worst ${worst.contrast.toFixed(2)}:1 on "${worst.name}"`,
      );

      for (const stop of stops) {
        expect(stop.outlineStyle, `${stop.name}: outline style`).toBe('solid');
        expect(Number.parseFloat(stop.outlineWidth), `${stop.name}: outline width`).toBeGreaterThanOrEqual(2);
        expect(
          stop.contrast,
          `${scheme}: "${stop.name}" ring ${stop.outlineColor} on ${stop.background}`,
        ).toBeGreaterThanOrEqual(MIN_INDICATOR_CONTRAST);
      }

      await page.close();
      await panel.close();
    });
  }






  test('the panel fits every pane width without clipping', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    const panel = await openPanel(tabId);
    await scan(panel);


    const measure = async (width: number) => {
      await panel.setViewportSize({ width, height: 960 });


      await waitForOverlayIdle(panel);
      return panel.evaluate(() => {
        const root = document.documentElement;
        const tabs = document.querySelector('[role="tablist"]');
        const strip = document.querySelector('header');
        return {
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          tabsLeft: tabs ? tabs.getBoundingClientRect().left : -1,
          stripLeft: strip ? strip.getBoundingClientRect().left : -1,
        };
      });
    };

    for (const width of [300, 340, 380, 420]) {
      const metrics = await measure(width);
      expect(metrics.scrollWidth, `${width}px: horizontal overflow`).toBe(metrics.clientWidth);
      expect(metrics.tabsLeft, `${width}px: tab strip left edge`).toBeGreaterThanOrEqual(0);
      expect(metrics.stripLeft, `${width}px: status strip left edge`).toBeGreaterThanOrEqual(0);
      if (width === 340) await panel.screenshot({ path: artifactPath('di-d-sidepanel-340.png') });
    }









    await panel.addStyleTag({
      content: `* { font-family: 'DejaVu Sans', Verdana, sans-serif !important; }`,
    });





    expect(
      await panel.evaluate(() => {
        const tab = document.querySelector('[role="tab"]');
        return tab ? getComputedStyle(tab).fontFamily : '';
      }),
      'the wide font override did not take effect',
    ).toContain('DejaVu Sans');

    for (const width of [300, 340, 380, 420]) {
      const metrics = await measure(width);
      expect(metrics.scrollWidth, `${width}px wide font: horizontal overflow`).toBe(
        metrics.clientWidth,
      );
      expect(
        metrics.tabsLeft,
        `${width}px wide font: tab strip left edge`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        metrics.stripLeft,
        `${width}px wide font: status strip left edge`,
      ).toBeGreaterThanOrEqual(0);
      if (width === 300) {
        await panel.screenshot({ path: artifactPath('di-d-sidepanel-300-wide-font.png') });
      }
    }

    await page.close();
    await panel.close();
  });

  test('reduced motion removes transitions rather than shortening them', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/inspector-basic.html`);
    const tabId = await tabIdFor(session.worker, page);
    const panel = await openPanel(tabId);
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await scan(panel);

    const moving = await panel.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .map(node => getComputedStyle(node))
        .flatMap(style => [style.transitionDuration, style.animationDuration])
        .filter(value => value !== '' && value !== '0s'),
    );
    expect(moving, 'durations still running under prefers-reduced-motion').toEqual([]);

    await page.close();
    await panel.close();
  });
});

test.describe('popup accessibility', () => {
  test('every control is named and the settings switches are labelled', async () => {




    const fixture = await session.context.newPage();
    await fixture.goto(`${baseUrl}/inspector-basic.html`);
    const popup = await session.context.newPage();
    await popup.setViewportSize({ width: 420, height: 760 });
    await popup.goto(`chrome-extension://${session.extensionId}/popup.html`);
    await fixture.bringToFront();
    await popup.reload();
    await expect(popup.getByRole('heading', { name: 'Design Inspector' })).toBeVisible();
    await expect(popup.getByRole('button', { name: /^Inspect/ })).toBeEnabled();

    expect(await runFindings(popup), 'popup audit').toEqual([]);



    await expect(popup.getByLabel(/Prefer semantic parents/)).toBeVisible();
    await expect(popup.getByLabel(/Hover card/)).toBeVisible();
    await expect(popup.getByLabel('Scan cap')).toBeVisible();

    const stops = await walkTabOrder(popup, 'h1', 10);
    const names = stops.map(stop => stop.name);
    expect(names.some(name => /Inspect|Stop inspecting/.test(name)), names.join(' | ')).toBe(true);
    expect(names).toContain('Side panel');
    for (const stop of stops) {
      expect(stop.contrast, `popup: "${stop.name}" ring on ${stop.background}`).toBeGreaterThanOrEqual(
        MIN_INDICATOR_CONTRAST,
      );
    }

    await popup.close();
  });
});
