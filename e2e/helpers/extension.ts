import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
/** The e2e build keeps host_permissions so injection works without a toolbar click. */
export const EXTENSION_DIR = path.join(ROOT, '.output-e2e', 'chrome-mv3');
export const FIXTURES_DIR = path.join(ROOT, 'e2e', 'fixtures');

export interface ExtensionSession {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
}

/** Launch Chromium with the built extension loaded in a throwaway profile. */
export async function launchWithExtension(): Promise<ExtensionSession> {
  const scratch = process.env.CLAUDE_SCRATCH ?? tmpdir();
  const userDataDir = mkdtempSync(path.join(scratch, 'di-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  return { context, extensionId, worker };
}

export function fixtureUrl(name: string): string {
  return `file://${path.join(FIXTURES_DIR, name)}`;
}

/**
 * Open an extension page to act as a message sender. A service worker cannot
 * deliver chrome.runtime.sendMessage to itself, so requests that the popup or
 * side panel would send must come from an extension page.
 */
export async function openControlPage(session: ExtensionSession): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(`chrome-extension://${session.extensionId}/popup.html`);
  return page;
}

/** Ask the background worker to toggle the inspector on a tab, as the toolbar would. */
export async function toggleInspector(control: Page, tabId: number) {
  return control.evaluate(async (id) => {
    return chrome.runtime.sendMessage({ type: 'inspector.toggle', tabId: id });
  }, tabId);
}

/** Send any background request from the control page. */
export async function sendBackground<T = unknown>(control: Page, request: object): Promise<T> {
  return control.evaluate(async (req) => chrome.runtime.sendMessage(req), request) as Promise<T>;
}

/** Resolve the chrome tab id for a Playwright page by matching its URL. */
export async function tabIdFor(worker: Worker, page: Page): Promise<number> {
  const url = page.url();
  const id = await worker.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === target);
    return tab?.id ?? -1;
  }, url);
  if (id < 0) throw new Error(`No tab found for ${url}`);
  return id;
}
