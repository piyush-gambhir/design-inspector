// Background worker wiring. Importing this module registers nothing: only
// registerBackground() attaches listeners, and it must be called synchronously
// at worker startup so events queued while the worker was asleep still arrive
// (PRD 18.2).
import type { ContentEvent, InspectorState } from '@/lib/messages';
import { isMessage, sendToTab } from '@/lib/messages';
import { loadFontIdentities } from './font-identity';
import { activeTabId, toggleInspector } from './inspector-control';
import { handleBackgroundRequest, isBackgroundRequest, isContentEventType } from './router';
import { SIDEPANEL_PORT } from '@/lib/ports';
import { clearSidePanelPresence, loadPresence } from './sidepanel-presence';

export const TOGGLE_COMMAND = 'toggle-inspector';

/**
 * Re-broadcast a content event so the popup and side panel learn which tab it
 * came from. A content script cannot know its own tab id, so the worker fills
 * `state.tabId` before forwarding.
 */
export function withTabId(event: ContentEvent, tabId: number): ContentEvent {
  if (event.type === 'event.state') {
    const state: InspectorState = { ...event.state, tabId };
    return { type: 'event.state', state };
  }
  return { ...event, tabId };
}

function forwardContentEvent(event: ContentEvent, tabId: number): void {
  void chrome.runtime.sendMessage(withTabId(event, tabId)).catch(() => undefined);
}

/**
 * A tab's URL changed. A content script that still answers a ping survived the
 * change, which means the application routed inside the same document: it is
 * told so it can mark its readings stale (PRD INS-01). A script that does not
 * answer is already gone with its document, and there is nothing to notify.
 */
export async function notifyTabNavigation(tabId: number, url: string): Promise<boolean> {
  const alive = await sendToTab(tabId, { type: 'content.ping' });
  if (!alive.ok) return false;
  await sendToTab(tabId, { type: 'content.notifyNavigation', url });
  return true;
}

export function registerBackground(): void {
  chrome.runtime.onInstalled.addListener(() => {
    // The toolbar action opens the popup; the side panel is opened deliberately.
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(() => undefined);
  });

  chrome.commands.onCommand.addListener(command => {
    if (command !== TOGGLE_COMMAND) return;
    void (async () => {
      const tabId = await activeTabId();
      if (tabId === null) return;
      const state = await toggleInspector(tabId);
      void chrome.runtime.sendMessage({ type: 'event.state', state }).catch(() => undefined);
    })();
  });

  // A restarted worker has forgotten which tabs had a panel open, so the set is
  // read back from session storage before the first presence message (W1).
  void loadPresence();

  // Identified fonts survive a worker restart the same way, so pressing
  // "Identify font file" again on a page the user already asked about does not
  // contact the font's host a second time (PRD 17.1).
  void loadFontIdentities();

  // The side panel holds a port open for as long as it is on screen. Its
  // disconnect is the close: the unmount message races the page going away.
  chrome.runtime.onConnect?.addListener?.(port => {
    if (port.name !== SIDEPANEL_PORT) return;
    port.onDisconnect.addListener(() => {
      void clearSidePanelPresence();
    });
  });

  // Same-document route changes arrive here as a url change with no reload.
  chrome.tabs?.onUpdated?.addListener?.((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    void notifyTabNavigation(tabId, changeInfo.url);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isMessage(message)) return undefined;
    const senderTabId = sender.tab?.id ?? null;

    if (isContentEventType(message.type)) {
      // Events without a sender tab are the worker's own re-broadcasts, or a
      // panel-to-panel message. Never forward those: it would loop.
      if (senderTabId !== null) forwardContentEvent(message as ContentEvent, senderTabId);
      return undefined;
    }

    if (!isBackgroundRequest(message)) return undefined;

    void (async () => {
      try {
        sendResponse(await handleBackgroundRequest(message, senderTabId));
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'The background worker failed.',
        });
      }
    })();
    return true;
  });
}
