



import type { ContentEvent, InspectorState } from '@/lib/messages';
import { isMessage, sendToTab } from '@/lib/messages';
import { loadFontIdentities } from './font-identity';
import { activeTabId, toggleInspector } from './inspector-control';
import { handleBackgroundRequest, isBackgroundRequest, isContentEventType } from './router';
import { SIDEPANEL_PORT } from '@/lib/ports';
import { clearSidePanelPresence, loadPresence } from './sidepanel-presence';

export const TOGGLE_COMMAND = 'toggle-inspector';






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







export async function notifyTabNavigation(tabId: number, url: string): Promise<boolean> {
  const alive = await sendToTab(tabId, { type: 'content.ping' });
  if (!alive.ok) return false;
  await sendToTab(tabId, { type: 'content.notifyNavigation', url });
  return true;
}

export function registerBackground(): void {
  chrome.runtime.onInstalled.addListener(() => {

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



  void loadPresence();




  void loadFontIdentities();



  chrome.runtime.onConnect?.addListener?.(port => {
    if (port.name !== SIDEPANEL_PORT) return;
    port.onDisconnect.addListener(() => {
      void clearSidePanelPresence();
    });
  });


  chrome.tabs?.onUpdated?.addListener?.((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    void notifyTabNavigation(tabId, changeInfo.url);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isMessage(message)) return undefined;
    const senderTabId = sender.tab?.id ?? null;

    if (isContentEventType(message.type)) {


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
