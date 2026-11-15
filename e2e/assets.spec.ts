import { test, expect, type Page, type Worker } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FIXTURES_DIR,
  launchWithExtension,
  openControlPage,
  tabIdFor,
  toggleInspector,
  type ExtensionSession,
} from './helpers/extension';
import { artifactPath } from './helpers/artifacts';
import { waitForOverlayIdle } from './helpers/timing';


const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let server: Server;
let baseUrl: string;
let session: ExtensionSession;
let control: Page;

test.beforeAll(async () => {


  server = createServer(async (request, response) => {
    const name = path.basename(new URL(request.url ?? '/', 'http://x').pathname);
    if (name === 'swatch.png' || name === 'tile.png') {
      response.setHeader('content-type', 'image/png');
      response.end(PNG);
      return;
    }
    if (name.endsWith('.html')) {
      try {
        const body = await readFile(path.join(FIXTURES_DIR, name));
        response.setHeader('content-type', 'text/html');
        response.end(body);
        return;
      } catch {

      }
    }
    response.statusCode = 404;
    response.end();
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


function readZip(bytes: Buffer): Map<string, Buffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('No end of central directory record');

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const start =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    files.set(name, bytes.subarray(start, start + size));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}






async function lastDownloadPath(worker: Worker): Promise<string> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const item = await worker.evaluate(async () => {
      const [found] = await chrome.downloads.search({ limit: 1, orderBy: ['-startTime'] });
      return found ? { filename: found.filename, state: found.state } : null;
    });
    if (item && item.state === 'complete' && item.filename) return item.filename;
    if (Date.now() > deadline) {
      throw new Error(`No completed download: ${JSON.stringify(item)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

test.describe('assets tab', () => {
  test('lists every asset kind, filters, and exports the selection as a ZIP with a manifest', async () => {
    const page = await session.context.newPage();
    await page.goto(`${baseUrl}/assets.html`);
    const tabId = await tabIdFor(session.worker, page);
    await toggleInspector(control, tabId);

    const panel = await session.context.newPage();
    await panel.goto(`chrome-extension://${session.extensionId}/sidepanel.html`);
    await panel.setViewportSize({ width: 420, height: 900 });


    await session.worker.evaluate(async (id) => {
      await chrome.tabs.update(id, { active: true });
    }, tabId);


    await expect(panel.getByRole('tab', { name: /assets/i })).toBeEnabled();

    await panel.getByRole('tab', { name: /assets/i }).click();
    await panel.getByRole('button', { name: /list assets/i }).click();





    const chips = panel.getByRole('group', { name: 'Filter assets by type' });
    await expect(chips.getByRole('button', { name: /^Images/ })).toHaveText(/^Images\s*3$/);
    await expect(chips.getByRole('button', { name: /^SVG/ })).toHaveText(/^SVG\s*1$/);
    await expect(chips.getByRole('button', { name: /^Backgrounds/ })).toHaveText(/^Backgrounds\s*1$/);
    await expect(chips.getByRole('button', { name: /^Video/ })).toHaveText(/^Video\s*1$/);
    await expect(panel.getByText('Used 3 times')).toBeVisible();


    await chips.getByRole('button', { name: /^Images/ }).click();
    await expect(chips.getByRole('button', { name: /^Images/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chips.getByRole('button', { name: /^All/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(panel.locator('input[type="checkbox"][aria-label^="Select asset"]')).toHaveCount(3);

    await panel.getByLabel(/select all shown/i).check();
    await expect(panel.getByText('3 selected')).toBeVisible();
    await expect(panel.getByText("Downloading contacts each asset's host.")).toBeVisible();
    await waitForOverlayIdle(panel);
    await panel.screenshot({ path: artifactPath('di-p-assets.png') });



    const downloadEvent = panel
      .waitForEvent('download', { timeout: 15_000 })
      .catch(() => null);
    await panel.getByRole('button', { name: /download selected as zip/i }).click();

    const download = await downloadEvent;
    const file = download ? await download.path() : await lastDownloadPath(session.worker);
    expect(file).toBeTruthy();
    const bytes = await readFile(file as string);


    expect([...bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);



    const today = new Date().toISOString().slice(0, 10);
    await expect(panel.getByText(`design-inspector-assets-${today}.zip`)).toBeVisible();

    const files = readZip(bytes);
    expect(files.has('manifest.json')).toBe(true);
    const manifest = JSON.parse((files.get('manifest.json') as Buffer).toString('utf8'));
    expect(manifest.written).toHaveLength(2);
    expect(manifest.skipped).toHaveLength(1);
    expect(manifest.skipped[0].source).toContain('missing.png');
    expect(manifest.skipped[0].reason).toContain('404');

    expect([...files.keys()]).toContain('1-swatch.png');
    expect(files.size).toBe(3);

    await expect(panel.getByText(/2 of 3 assets written/)).toBeVisible();
    await expect(panel.getByText(/1 skipped/)).toBeVisible();

    await panel.close();
    await page.close();
  });
});
