










import type {
  AssetReading,
  FontIdentity,
  ElementSnapshot,
  PageSummary,
  Rect,
  SavedReference,
  StackReport,
} from './contracts';

export type InspectorMode = 'off' | 'active' | 'paused';







export type OutlineMode = 'off' | 'tag' | 'depth';






export interface MockupState {

  dataUrl: string;

  opacity: number;

  x: number;
  y: number;

  scale: number;
  visible: boolean;

  blend: 'normal' | 'difference';

  locked: boolean;
}

export interface InspectorState {
  tabId: number;
  mode: InspectorMode;

  pinned: ElementSnapshot | null;

  pageStale: boolean;

  unsupportedReason: string | null;

  outlines?: OutlineMode;

  mockup?: Omit<MockupState, 'dataUrl'> | null;

  tools?: PageTools;

  badgeCollapsed?: boolean;
}


export interface PageTools {
  rulers: boolean;
  semanticParents: boolean;
  layoutOverlay: boolean;
}




export type BackgroundRequest =
  | { type: 'inspector.toggle'; tabId: number }
  | { type: 'inspector.setMode'; tabId: number; mode: InspectorMode }
  | { type: 'inspector.getState'; tabId: number }
  | { type: 'outlines.set'; tabId: number; mode: OutlineMode }

  | { type: 'tools.set'; tabId: number; tools: Partial<PageTools> }





  | { type: 'sidepanel.presence'; tabId: number; open: boolean }
  | { type: 'inspector.openSidePanel'; tabId: number }
  | { type: 'download.url'; url: string; filename: string }
  | { type: 'download.data'; dataUrl: string; filename: string }
  | { type: 'screenshot.capture'; tabId: number; rect: Rect; devicePixelRatio: number }
  | { type: 'summary.request'; tabId: number }

  | { type: 'summary.cancel'; tabId: number }




  | { type: 'font.identify'; url: string }

  | { type: 'assets.request'; tabId: number; enrich?: boolean }
  | { type: 'stack.request'; tabId: number }
  | { type: 'element.highlight'; tabId: number; locators: string[] }

  | { type: 'element.select'; tabId: number; locator: string; scroll?: boolean }

  | { type: 'mockup.set'; tabId: number; mockup: MockupState | null }
  | { type: 'element.clearHighlight'; tabId: number }




  | {
      type: 'reference.save';
      tabId?: number;
      snapshot: ElementSnapshot | PageSummary;
      title: string;
      note: string;
      captureScreenshot: boolean;
    };

export type BackgroundResponse =
  | { ok: true; state: InspectorState }
  | { ok: true; summary: PageSummary }
  | { ok: true; assets: AssetReading[] }
  | { ok: true; stack: StackReport }
  | { ok: true; screenshotDataUrl: string; isCrop: boolean }

  | { ok: true; reference: SavedReference; warning?: string }
  | { ok: true; identity: FontIdentity }
  | { ok: true; downloadId: number }
  | { ok: true }
  | { ok: false; error: string };




export type ContentRequest =
  | { type: 'content.ping' }
  | { type: 'content.setMode'; mode: InspectorMode }
  | { type: 'content.setOutlines'; mode: OutlineMode }
  | { type: 'content.setTools'; tools: Partial<PageTools> }

  | { type: 'content.setBadge'; collapsed: boolean; reason: 'sidepanel' | 'user' }





  | { type: 'content.notifyNavigation'; url: string }
  | { type: 'content.getState' }

  | { type: 'content.scanSummary'; cap: number; globals?: string[] }
  | { type: 'content.cancelScan' }
  | { type: 'content.listAssets' }
  | { type: 'content.detectStack'; globals?: string[] }
  | { type: 'content.highlight'; locators: string[] }
  | { type: 'content.select'; locator: string; scroll?: boolean }
  | { type: 'content.setMockup'; mockup: MockupState | null }
  | { type: 'content.clearHighlight' }
  | { type: 'content.getPinnedRect' }

  | { type: 'content.setOverlayVisible'; visible: boolean };

export type ContentResponse =
  | { ok: true; state: InspectorState }
  | { ok: true; summary: PageSummary }
  | { ok: true; assets: AssetReading[] }
  | { ok: true; stack: StackReport }
  | { ok: true; rect: Rect | null; devicePixelRatio: number }
  | { ok: true }
  | { ok: false; error: string };










export type ContentEvent =
  | { type: 'event.state'; state: InspectorState }
  | { type: 'event.pinned'; tabId?: number; snapshot: ElementSnapshot | null }
  | { type: 'event.pageChanged'; tabId?: number; url: string }
  | { type: 'event.scanProgress'; tabId?: number; scanned: number; total: number };


export type StorageEvent = { type: 'event.savedChanged'; references: SavedReference[] };

export type AnyMessage =
  | BackgroundRequest
  | ContentRequest
  | ContentEvent
  | StorageEvent;




export function isMessage(value: unknown): value is AnyMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

export async function sendToBackground<R extends BackgroundResponse = BackgroundResponse>(
  request: BackgroundRequest,
): Promise<R> {
  const response = (await chrome.runtime.sendMessage(request)) as R | undefined;
  if (!response) return { ok: false, error: 'No response from background' } as R;
  return response;
}

export async function sendToTab<R extends ContentResponse = ContentResponse>(
  tabId: number,
  request: ContentRequest,
): Promise<R> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, request)) as R | undefined;
    if (!response) return { ok: false, error: 'No response from content script' } as R;
    return response;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) } as R;
  }
}

export function broadcast(event: ContentEvent | StorageEvent): void {

  void chrome.runtime.sendMessage(event).catch(() => undefined);
}
