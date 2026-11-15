




import type {
  ContentResponse,
  InspectorMode,
  InspectorState,
  MockupState,
  OutlineMode,
} from '@/lib/messages';
import { sendToTab } from '@/lib/messages';
import { hasSidePanel } from './sidepanel-presence';

export const CONTENT_SCRIPT_PATH = '/content-scripts/inspector.js';

export function offState(tabId: number, unsupportedReason: string | null = null): InspectorState {
  return { tabId, mode: 'off', pinned: null, pageStale: false, unsupportedReason };
}





export function unsupportedSchemeReason(url: string | undefined): string | null {
  const target = url ?? '';
  if (!target) return null;
  if (/^(chrome|chrome-untrusted):\/\//i.test(target)) {
    return 'Chrome does not allow extensions on browser pages. Open a normal web page.';
  }
  if (/^(chrome-extension|moz-extension|edge):\/\//i.test(target)) {
    return 'Extension pages cannot be inspected. Open a normal web page.';
  }
  if (/^devtools:\/\//i.test(target)) {
    return 'DevTools windows cannot be inspected.';
  }
  if (/^about:/i.test(target)) {
    return 'This tab has no inspectable page yet. Load a site and try again.';
  }
  if (/^view-source:/i.test(target)) {
    return 'View-source pages cannot be inspected.';
  }
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(target)) {
    return 'Chrome blocks extensions on the Web Store. Open a normal web page.';
  }
  return null;
}





export function unsupportedReasonFor(url: string | undefined, error: unknown): string {
  const byScheme = unsupportedSchemeReason(url);
  if (byScheme) return byScheme;
  const target = url ?? '';
  if (/^file:\/\//i.test(target)) {
    return 'Allow this extension to access file URLs in chrome://extensions, then try again.';
  }
  if (/\.pdf($|[?#])/i.test(target)) {
    return "Chrome's PDF viewer cannot be inspected.";
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/cannot be scripted/i.test(message)) {
    return 'Chrome does not allow extensions on this page.';
  }
  if (/cannot access|Extension manifest|Missing host permission/i.test(message)) {


    return 'Chrome has not granted access to this tab yet. Click the Design Inspector toolbar icon or press the shortcut on this tab, then try again.';
  }
  return message
    ? `The inspector could not start on this page: ${message}`
    : 'The inspector could not start on this page.';
}

async function tabUrl(tabId: number): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ?? tab.pendingUrl ?? undefined;
  } catch {
    return undefined;
  }
}





export async function ensureContentScript(
  tabId: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ping = await sendToTab(tabId, { type: 'content.ping' });
  if (ping.ok) return { ok: true };
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_PATH],
    });
  } catch (error) {
    return { ok: false, reason: unsupportedReasonFor(await tabUrl(tabId), error) };
  }
  const second = await sendToTab(tabId, { type: 'content.ping' });
  if (second.ok) return { ok: true };
  return { ok: false, reason: unsupportedReasonFor(await tabUrl(tabId), second.error) };
}

function readState(response: ContentResponse, tabId: number): InspectorState | null {
  if (!response.ok) return null;
  if (!('state' in response) || !response.state) return null;
  return { ...response.state, tabId };
}






export async function getInspectorState(tabId: number): Promise<InspectorState> {
  const ping = await sendToTab(tabId, { type: 'content.ping' });
  if (!ping.ok) return offState(tabId, unsupportedSchemeReason(await tabUrl(tabId)));
  const response = await sendToTab(tabId, { type: 'content.getState' });
  return readState(response, tabId) ?? offState(tabId);
}

export async function setInspectorMode(
  tabId: number,
  mode: InspectorMode,
): Promise<InspectorState> {
  const ready = await ensureContentScript(tabId);
  if (!ready.ok) return offState(tabId, ready.reason);
  const applied = await sendToTab(tabId, { type: 'content.setMode', mode });
  if (!applied.ok) return offState(tabId, applied.error);



  if (mode !== 'off' && hasSidePanel(tabId)) {
    await sendToTab(tabId, { type: 'content.setBadge', collapsed: true, reason: 'sidepanel' });
    const mirrored = readState(await sendToTab(tabId, { type: 'content.getState' }), tabId);
    if (mirrored) return mirrored;
  }
  const confirmed = readState(applied, tabId);
  if (confirmed) return confirmed;
  const fetched = await sendToTab(tabId, { type: 'content.getState' });
  return readState(fetched, tabId) ?? { ...offState(tabId), mode };
}







export async function setOutlineMode(
  tabId: number,
  mode: OutlineMode,
): Promise<InspectorState> {
  const ready = await ensureContentScript(tabId);
  if (!ready.ok) return offState(tabId, ready.reason);
  const applied = await sendToTab(tabId, { type: 'content.setOutlines', mode });
  if (!applied.ok) return offState(tabId, applied.error);
  const confirmed = readState(applied, tabId);
  if (confirmed) return confirmed;
  const fetched = await sendToTab(tabId, { type: 'content.getState' });
  return readState(fetched, tabId) ?? { ...offState(tabId), outlines: mode };
}







export async function setTabMockup(
  tabId: number,
  mockup: MockupState | null,
): Promise<InspectorState> {
  const ready = await ensureContentScript(tabId);
  if (!ready.ok) return offState(tabId, ready.reason);
  const applied = await sendToTab(tabId, { type: 'content.setMockup', mockup });
  if (!applied.ok) return offState(tabId, applied.error);
  const confirmed = readState(applied, tabId);
  if (confirmed) return confirmed;
  const fetched = await sendToTab(tabId, { type: 'content.getState' });
  return readState(fetched, tabId) ?? offState(tabId);
}


export function nextToggleMode(current: InspectorMode): InspectorMode {
  return current === 'off' ? 'active' : 'off';
}

export async function toggleInspector(tabId: number): Promise<InspectorState> {
  const ready = await ensureContentScript(tabId);
  if (!ready.ok) return offState(tabId, ready.reason);
  const current = await sendToTab(tabId, { type: 'content.getState' });
  const state = readState(current, tabId);
  return setInspectorMode(tabId, nextToggleMode(state?.mode ?? 'off'));
}

export async function activeTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}
