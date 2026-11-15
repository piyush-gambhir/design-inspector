





import type { BackgroundRequest, BackgroundResponse } from '@/lib/messages';
import { sendToTab } from '@/lib/messages';
import { requestAssets } from './assets';
import { startDownload } from './downloads';
import { identifyFont } from './font-identity';
import {
  activeTabId,
  getInspectorState,
  setInspectorMode,
  setOutlineMode,
  setTabMockup,
  toggleInspector,
} from './inspector-control';
import { requestStack, requestSummary } from './research';
import { setSidePanelPresence } from './sidepanel-presence';
import { saveReference } from './save-reference';
import { captureElementScreenshot } from './screenshot';

export const BACKGROUND_REQUEST_TYPES: readonly BackgroundRequest['type'][] = [
  'inspector.toggle',
  'inspector.setMode',
  'inspector.getState',
  'inspector.openSidePanel',
  'outlines.set',
  'tools.set',
  'sidepanel.presence',
  'download.url',
  'download.data',
  'screenshot.capture',
  'summary.request',
  'summary.cancel',
  'font.identify',
  'assets.request',
  'stack.request',
  'element.highlight',
  'element.select',
  'mockup.set',
  'element.clearHighlight',
  'reference.save',
];

export const MAX_SIMULTANEOUS_HIGHLIGHTS = 20;

export function isBackgroundRequest(value: { type: string }): value is BackgroundRequest {
  return (BACKGROUND_REQUEST_TYPES as readonly string[]).includes(value.type);
}


export function isContentEventType(type: string): boolean {
  return type.startsWith('event.');
}

function passthrough(response: { ok: boolean; error?: string }): BackgroundResponse {
  return response.ok ? { ok: true } : { ok: false, error: response.error ?? 'The tab did not respond.' };
}

export async function handleBackgroundRequest(
  request: BackgroundRequest,
  senderTabId: number | null,
): Promise<BackgroundResponse> {
  switch (request.type) {
    case 'inspector.toggle':
      return { ok: true, state: await toggleInspector(request.tabId) };

    case 'inspector.setMode':
      return { ok: true, state: await setInspectorMode(request.tabId, request.mode) };

    case 'inspector.getState':
      return { ok: true, state: await getInspectorState(request.tabId) };

    case 'outlines.set':
      return { ok: true, state: await setOutlineMode(request.tabId, request.mode) };

    case 'tools.set':
      return passthrough(
        await sendToTab(request.tabId, { type: 'content.setTools', tools: request.tools }),
      );

    case 'sidepanel.presence':



      await setSidePanelPresence(request.tabId, request.open);
      return { ok: true };

    case 'inspector.openSidePanel':
      await chrome.sidePanel.open({ tabId: request.tabId });
      return { ok: true };

    case 'download.url':
      return startDownload(request.url, request.filename);

    case 'download.data':
      return startDownload(request.dataUrl, request.filename);

    case 'screenshot.capture': {
      const result = await captureElementScreenshot(
        request.tabId,
        request.rect,
        request.devicePixelRatio,
      );
      return result.ok
        ? { ok: true, screenshotDataUrl: result.screenshotDataUrl, isCrop: result.isCrop }
        : { ok: false, error: result.error };
    }

    case 'summary.request':
      return requestSummary(request.tabId);

    case 'font.identify':


      return identifyFont(request.url);

    case 'summary.cancel':
      return passthrough(await sendToTab(request.tabId, { type: 'content.cancelScan' }));

    case 'assets.request': {


      const tabId = request.tabId >= 0 ? request.tabId : senderTabId;
      if (tabId === null) return { ok: false, error: 'No tab to list assets for.' };
      return requestAssets(tabId, request.enrich === true);
    }

    case 'stack.request':
      return requestStack(request.tabId);

    case 'element.highlight':
      return passthrough(
        await sendToTab(request.tabId, {
          type: 'content.highlight',
          locators: request.locators.slice(0, MAX_SIMULTANEOUS_HIGHLIGHTS),
        }),
      );

    case 'element.select':
      return passthrough(
        await sendToTab(request.tabId, {
          type: 'content.select',
          locator: request.locator,
          scroll: request.scroll,
        }),
      );

    case 'mockup.set':


      return { ok: true, state: await setTabMockup(request.tabId, request.mockup) };

    case 'element.clearHighlight':
      return passthrough(await sendToTab(request.tabId, { type: 'content.clearHighlight' }));

    case 'reference.save':
      return saveReference({
        snapshot: request.snapshot,
        title: request.title,
        note: request.note,
        captureScreenshot: request.captureScreenshot,



        tabId:
          request.tabId ?? senderTabId ?? (request.captureScreenshot ? await activeTabId() : null),
      });
  }
}
