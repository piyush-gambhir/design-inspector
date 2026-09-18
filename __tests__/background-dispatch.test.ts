import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetReading, ElementSnapshot, PageSummary, StackReport } from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';
import type { ContentRequest } from '@/lib/messages';

// In-memory idb so reference.save can persist without a real IndexedDB.
const fakeIdb = vi.hoisted(() => {
  const stores = new Map<string, Map<string, unknown>>();
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      stores.set(name, new Map());
      return { createIndex: () => undefined };
    },
    get: async (name: string, key: string) => stores.get(name)?.get(key),
    getAll: async (name: string) => [...(stores.get(name)?.values() ?? [])],
    put: async (name: string, value: unknown, key?: string) => {
      const resolved = key ?? (value as { id?: string }).id;
      stores.get(name)?.set(String(resolved), value);
    },
    delete: async (name: string, key: string) => {
      stores.get(name)?.delete(key);
    },
    clear: async (name: string) => stores.get(name)?.clear(),
  };
  return { stores, db };
});

vi.mock('idb', () => ({
  openDB: async (_name: string, _version: number, options?: { upgrade?: (db: unknown) => void }) => {
    options?.upgrade?.(fakeIdb.db);
    return fakeIdb.db;
  },
}));

const { registerBackground, notifyTabNavigation } = await import('@/lib/background/register');
const { resetDatabaseForTests, listReferences } = await import('@/lib/storage/references');
const { presenceTabs, resetPresenceForTests } = await import(
  '@/lib/background/sidepanel-presence'
);

// ---------------------------------------------------------------------------
// Fixtures

const source = {
  url: 'https://example.com/pricing',
  title: 'Pricing',
  capturedAt: '2026-09-18T10:00:00.000Z',
  viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
  rootFontSize: 16,
  scrollX: 0,
  scrollY: 0,
};

const stackFixture: StackReport = {
  detections: [],
  hints: [],
  scope: 'page',
  observedAt: '2026-09-18T10:00:00.000Z',
};

const summaryFixture = {
  id: 'summary-1',
  schemaVersion: SCHEMA_VERSION,
  source,
  scope: {
    eligibleElements: 10,
    scannedElements: 10,
    capped: false,
    cap: 1234,
    durationMs: 12,
    skipped: [],
    inaccessibleFrames: 0,
    openShadowRoots: 0,
    notes: [],
  },
  typography: [],
  sizeScale: [],
  colors: [],
  spacing: { padding: [], margin: [], gap: [] },
  fonts: [],
  radii: [],
  shadows: [],
  stack: stackFixture,
  limitations: [],
} as unknown as PageSummary;

const snapshotFixture = {
  id: 'snap-1',
  schemaVersion: SCHEMA_VERSION,
  source,
  element: {
    tag: 'h1',
    id: null,
    classes: [],
    role: null,
    label: 'h1',
    textSample: 'Pricing',
    locator: 'h1',
  },
  ancestors: [],
  assets: [],
  limitations: [],
} as unknown as ElementSnapshot;

const assetsFixture: AssetReading[] = [
  {
    kind: 'img',
    url: 'https://cdn.example.com/hero.png',
    candidates: [],
    renderedWidth: 400,
    renderedHeight: 300,
    intrinsicWidth: 800,
    intrinsicHeight: 600,
    fileSize: null,
    mimeType: null,
    svgMarkup: null,
    alt: 'Hero',
    limitations: [],
  },
  {
    kind: 'svg-inline',
    url: null,
    candidates: [],
    renderedWidth: 24,
    renderedHeight: 24,
    intrinsicWidth: null,
    intrinsicHeight: null,
    fileSize: null,
    mimeType: null,
    svgMarkup: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    alt: null,
    limitations: ['Used 4 times'],
  },
];

// ---------------------------------------------------------------------------
// Fake chrome

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

interface Harness {
  listener: Listener;
  contentRequests: { tabId: number; request: ContentRequest }[];
  broadcasts: unknown[];
  downloads: chrome.downloads.DownloadOptions[];
  executed: unknown[];
  sidePanelOpen: ReturnType<typeof vi.fn>;
  commandListeners: ((command: string) => void)[];
  /** Ports opened with chrome.runtime.connect, so a close can be simulated. */
  connect: (name: string) => { disconnect: () => void };
  session: Map<string, unknown>;
}

let harness: Harness;

function contentReply(
  request: ContentRequest,
  mode: { current: string },
  outlines: { current: string },
): unknown {
  switch (request.type) {
    case 'content.ping':
      return { ok: true };
    case 'content.getState':
      return {
        ok: true,
        state: {
          tabId: -1,
          mode: mode.current,
          pinned: null,
          pageStale: false,
          unsupportedReason: null,
          outlines: outlines.current,
        },
      };
    case 'content.setMode':
      mode.current = request.mode;
      if (request.mode === 'off') outlines.current = 'off';
      return {
        ok: true,
        state: {
          tabId: -1,
          mode: request.mode,
          pinned: null,
          pageStale: false,
          unsupportedReason: null,
          outlines: outlines.current,
        },
      };
    case 'content.setOutlines':
      outlines.current = request.mode;
      return {
        ok: true,
        state: {
          tabId: -1,
          mode: mode.current,
          pinned: null,
          pageStale: false,
          unsupportedReason: null,
          outlines: request.mode,
        },
      };
    case 'content.scanSummary':
      return { ok: true, summary: summaryFixture };
    case 'content.listAssets':
      return { ok: true, assets: assetsFixture };
    case 'content.detectStack':
      return { ok: true, stack: stackFixture };
    case 'content.getPinnedRect':
      return { ok: true, rect: { x: 0, y: 0, width: 10, height: 10 }, devicePixelRatio: 2 };
    default:
      return { ok: true };
  }
}

function install(): Harness {
  const mode = { current: 'off' };
  const outlines = { current: 'off' };
  const contentRequests: { tabId: number; request: ContentRequest }[] = [];
  const broadcasts: unknown[] = [];
  const downloads: chrome.downloads.DownloadOptions[] = [];
  const executed: unknown[] = [];
  const commandListeners: ((command: string) => void)[] = [];
  let captured: Listener | null = null;
  const sidePanelOpen = vi.fn(async () => undefined);
  // One connect listener, and a session store the presence set can survive in.
  const connectListeners: ((port: chrome.runtime.Port) => void)[] = [];
  const session = new Map<string, unknown>();
  const connect = (name: string) => {
    const disconnectListeners: (() => void)[] = [];
    const port = {
      name,
      onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
    } as unknown as chrome.runtime.Port;
    for (const listener of connectListeners) listener(port);
    return {
      disconnect: () => {
        for (const listener of disconnectListeners) listener();
      },
    };
  };

  const fake = {
    runtime: {
      id: 'test-extension',
      getManifest: () => ({ version: '0.1.0' }),
      onInstalled: { addListener: () => undefined },
      onConnect: {
        addListener: (listener: (port: chrome.runtime.Port) => void) =>
          connectListeners.push(listener),
      },
      onMessage: {
        addListener: (listener: Listener) => {
          captured = listener;
        },
      },
      sendMessage: vi.fn(async (message: unknown) => {
        broadcasts.push(message);
        return undefined;
      }),
    },
    commands: {
      onCommand: {
        addListener: (listener: (command: string) => void) => commandListeners.push(listener),
      },
    },
    sidePanel: {
      setPanelBehavior: async () => undefined,
      open: sidePanelOpen,
    },
    tabs: {
      get: async (tabId: number) => ({ id: tabId, windowId: 7, url: 'https://example.com/pricing' }),
      query: async () => [{ id: 1, url: 'https://example.com/pricing', title: 'Pricing' }],
      sendMessage: vi.fn(async (tabId: number, request: ContentRequest) => {
        contentRequests.push({ tabId, request });
        return contentReply(request, mode, outlines);
      }),
      captureVisibleTab: async () => 'data:image/png;base64,AAAA',
    },
    scripting: {
      executeScript: vi.fn(async (details: { world?: string; func?: unknown }) => {
        executed.push(details);
        if (details.world === 'MAIN') return [{ result: ['gsap', 'React'] }];
        return [{ result: undefined }];
      }),
    },
    downloads: {
      download: vi.fn(async (options: chrome.downloads.DownloadOptions) => {
        downloads.push(options);
        return 42;
      }),
    },
    storage: {
      local: {
        get: async (key: string) => ({
          [key]: { theme: 'system', hoverCard: true, summaryScanCap: 1234 },
        }),
        set: async () => undefined,
      },
      session: {
        get: async (key: string) => ({ [key]: session.get(key) }),
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) session.set(key, value);
        },
      },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = fake;
  registerBackground();
  if (!captured) throw new Error('registerBackground did not attach a message listener');
  return {
    listener: captured,
    contentRequests,
    broadcasts,
    downloads,
    executed,
    sidePanelOpen,
    commandListeners,
    connect,
    session,
  };
}

function send(message: unknown, sender: chrome.runtime.MessageSender = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const took = harness.listener(message, sender, resolve);
    if (took !== true) reject(new Error(`listener ignored ${JSON.stringify(message)}`));
  });
}

beforeEach(() => {
  resetDatabaseForTests();
  resetPresenceForTests();
  fakeIdb.stores.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: { method?: string }) => {
      if (String(input).startsWith('data:')) throw new Error('data URLs are not fetched here');
      if (init?.method !== 'HEAD') throw new Error('unexpected method');
      return {
        ok: true,
        headers: new Headers({ 'content-length': '20480', 'content-type': 'image/png; q=1' }),
      };
    }),
  );
  harness = install();
});

// ---------------------------------------------------------------------------

describe('message handler dispatch', () => {
  it('ignores messages that are not extension messages', () => {
    const sendResponse = vi.fn();
    expect(harness.listener('hello', {}, sendResponse)).toBeUndefined();
    expect(harness.listener({ nope: true }, {}, sendResponse)).toBeUndefined();
    expect(harness.listener({ type: 'not.a.request' }, {}, sendResponse)).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('answers inspector.getState without injecting the content script', async () => {
    const response = await send({ type: 'inspector.getState', tabId: 1 });
    expect(response).toEqual({
      ok: true,
      state: {
        tabId: 1,
        mode: 'off',
        pinned: null,
        pageStale: false,
        unsupportedReason: null,
        outlines: 'off',
      },
    });
    expect(harness.executed).toHaveLength(0);
  });

  it('sets layout outlines on a tab, injecting the content script first', async () => {
    const response = await send({ type: 'outlines.set', tabId: 1, mode: 'depth' });
    expect(response).toMatchObject({ ok: true, state: { tabId: 1, outlines: 'depth' } });
    const applied = harness.contentRequests.find(
      entry => entry.request.type === 'content.setOutlines',
    );
    expect(applied?.request).toEqual({ type: 'content.setOutlines', mode: 'depth' });
    // The mode is untouched: outlines do not turn the inspector on.
    expect(response).toMatchObject({ state: { mode: 'off' } });
  });

  it('turns layout outlines off again and leaves the inspector alone', async () => {
    await send({ type: 'outlines.set', tabId: 1, mode: 'tag' });
    const response = await send({ type: 'outlines.set', tabId: 1, mode: 'off' });
    expect(response).toMatchObject({ ok: true, state: { outlines: 'off' } });
    const state = await send({ type: 'inspector.getState', tabId: 1 });
    expect(state).toMatchObject({ ok: true, state: { outlines: 'off', mode: 'off' } });
  });

  it('toggles off to active and back', async () => {
    const first = await send({ type: 'inspector.toggle', tabId: 1 });
    expect(first).toMatchObject({ ok: true, state: { mode: 'active', tabId: 1 } });
    const second = await send({ type: 'inspector.toggle', tabId: 1 });
    expect(second).toMatchObject({ ok: true, state: { mode: 'off' } });
  });

  it('applies an explicit mode', async () => {
    const response = await send({ type: 'inspector.setMode', tabId: 1, mode: 'paused' });
    expect(response).toMatchObject({ ok: true, state: { mode: 'paused', tabId: 1 } });
  });

  it('opens the side panel', async () => {
    await expect(send({ type: 'inspector.openSidePanel', tabId: 1 })).resolves.toEqual({
      ok: true,
    });
    expect(harness.sidePanelOpen).toHaveBeenCalledWith({ tabId: 1 });
  });

  it('starts a URL download with a sanitized filename', async () => {
    const response = await send({
      type: 'download.url',
      url: 'https://cdn.example.com/hero.png',
      filename: '../../hero:1.png',
    });
    expect(response).toEqual({ ok: true, downloadId: 42 });
    expect(harness.downloads[0]).toEqual({
      url: 'https://cdn.example.com/hero.png',
      filename: 'hero-1.png',
      saveAs: false,
      conflictAction: 'uniquify',
    });
  });

  it('starts a data download', async () => {
    await send({
      type: 'download.data',
      dataUrl: 'data:application/json,%7B%7D',
      filename: 'export.json',
    });
    expect(harness.downloads[0]?.url).toBe('data:application/json,%7B%7D');
  });

  it('probes main-world globals and passes the scan cap from settings', async () => {
    const response = await send({ type: 'summary.request', tabId: 1 });
    expect(response).toEqual({ ok: true, summary: summaryFixture });
    const scan = harness.contentRequests.find(entry => entry.request.type === 'content.scanSummary');
    expect(scan?.request).toEqual({
      type: 'content.scanSummary',
      cap: 1234,
      globals: ['gsap', 'React'],
    });
    expect(harness.executed.some(details => (details as { world?: string }).world === 'MAIN')).toBe(
      true,
    );
  });

  it('passes globals to stack detection', async () => {
    await expect(send({ type: 'stack.request', tabId: 1 })).resolves.toEqual({
      ok: true,
      stack: stackFixture,
    });
    const detect = harness.contentRequests.find(
      entry => entry.request.type === 'content.detectStack',
    );
    expect(detect?.request).toEqual({ type: 'content.detectStack', globals: ['gsap', 'React'] });
  });

  it('fills asset size and MIME from a HEAD request and leaves inline assets alone', async () => {
    const response = (await send({ type: 'assets.request', tabId: 1, enrich: true })) as {
      ok: true;
      assets: AssetReading[];
    };
    expect(response.ok).toBe(true);
    expect(response.assets[0]).toMatchObject({ fileSize: 20480, mimeType: 'image/png' });
    expect(response.assets[1]).toMatchObject({ fileSize: null, mimeType: null });
  });

  it('lists assets without touching the network unless enrichment was asked for', async () => {
    const fetched = globalThis.fetch as unknown as { mock?: { calls: unknown[] } };
    const before = fetched.mock?.calls.length ?? 0;
    const response = (await send({ type: 'assets.request', tabId: 1 })) as {
      ok: true;
      assets: AssetReading[];
    };
    expect(response.ok).toBe(true);
    expect(response.assets[0]).toMatchObject({ fileSize: null, mimeType: null });
    expect(fetched.mock?.calls.length ?? 0).toBe(before);
  });

  it('answers an asset request from a content script using the sender tab', async () => {
    const response = (await send(
      { type: 'assets.request', tabId: -1 },
      { tab: { id: 1 } } as chrome.runtime.MessageSender,
    )) as { ok: true; assets: AssetReading[] };
    expect(response.ok).toBe(true);
    expect(response.assets).toHaveLength(2);
  });

  it('tells a surviving content script that the tab navigated in place', async () => {
    await expect(notifyTabNavigation(1, 'https://example.com/plans')).resolves.toBe(true);
    const last = harness.contentRequests.at(-1);
    expect(last).toEqual({
      tabId: 1,
      request: { type: 'content.notifyNavigation', url: 'https://example.com/plans' },
    });
  });

  it('does nothing when the document was replaced and the script is gone', async () => {
    const api = (globalThis as unknown as { chrome: { tabs: { sendMessage: unknown } } }).chrome;
    const gone = vi.fn(async () => {
      throw new Error('Could not establish connection');
    });
    api.tabs.sendMessage = gone;
    await expect(notifyTabNavigation(1, 'https://example.com/other')).resolves.toBe(false);
    // Only the ping was sent: there is nothing left to notify.
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('caps simultaneous highlights at 20 locators', async () => {
    const locators = Array.from({ length: 50 }, (_, index) => `#el-${index}`);
    await expect(send({ type: 'element.highlight', tabId: 1, locators })).resolves.toEqual({
      ok: true,
    });
    const highlight = harness.contentRequests.find(
      entry => entry.request.type === 'content.highlight',
    );
    expect(
      highlight?.request.type === 'content.highlight' ? highlight.request.locators : [],
    ).toHaveLength(20);
  });

  it('passes element select and clear through to the tab', async () => {
    await expect(send({ type: 'element.select', tabId: 1, locator: 'h1' })).resolves.toEqual({
      ok: true,
    });
    await expect(send({ type: 'element.clearHighlight', tabId: 1 })).resolves.toEqual({ ok: true });
    expect(harness.contentRequests.map(entry => entry.request.type)).toContain('content.select');
    expect(harness.contentRequests.map(entry => entry.request.type)).toContain(
      'content.clearHighlight',
    );
  });

  it('reports a failed screenshot without throwing', async () => {
    const response = (await send({
      type: 'screenshot.capture',
      tabId: 1,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      devicePixelRatio: 2,
    })) as { ok: boolean; error?: string };
    expect(response.ok).toBe(false);
    expect(typeof response.error).toBe('string');
    // The overlay is restored even when the capture fails.
    const restored = harness.contentRequests.filter(
      entry =>
        entry.request.type === 'content.setOverlayVisible' && entry.request.visible === true,
    );
    expect(restored).toHaveLength(1);
  });

  it('saves a reference, persists it, and broadcasts the new collection', async () => {
    const response = (await send(
      {
        type: 'reference.save',
        snapshot: snapshotFixture,
        title: '  Hero heading  ',
        note: 'Tight tracking at a large size.',
        captureScreenshot: true,
      },
      { tab: { id: 1 } as chrome.tabs.Tab },
    )) as { ok: boolean; reference?: { kind: string; title: string; screenshotId: string | null } };

    expect(response.ok).toBe(true);
    expect(response.reference).toMatchObject({
      kind: 'element',
      title: 'Hero heading',
      // The screenshot fails in this environment; the save still succeeds.
      screenshotId: null,
    });
    expect(await listReferences()).toHaveLength(1);
    expect(harness.broadcasts).toEqual([
      expect.objectContaining({ type: 'event.savedChanged' }),
    ]);
  });

  it('infers a summary reference from a page summary snapshot', async () => {
    const response = (await send({
      type: 'reference.save',
      snapshot: summaryFixture,
      title: 'Pricing summary',
      note: '',
      captureScreenshot: false,
    })) as { ok: boolean; reference?: { kind: string } };
    expect(response.reference?.kind).toBe('summary');
  });

  it('turns an exception into ok: false', async () => {
    harness.sidePanelOpen.mockRejectedValueOnce(new Error('no user gesture'));
    await expect(send({ type: 'inspector.openSidePanel', tabId: 1 })).resolves.toEqual({
      ok: false,
      error: 'no user gesture',
    });
  });
});

describe('content event forwarding', () => {
  const state = {
    tabId: -1,
    mode: 'active' as const,
    pinned: null,
    pageStale: false,
    unsupportedReason: null,
  };

  it('stamps the sender tab id onto a state event', () => {
    harness.listener({ type: 'event.state', state }, { tab: { id: 9 } as chrome.tabs.Tab }, () => undefined);
    expect(harness.broadcasts).toEqual([
      { type: 'event.state', state: { ...state, tabId: 9 } },
    ]);
  });

  it('stamps the sender tab id onto other content events', () => {
    const event = { type: 'event.pageChanged', url: 'https://example.com/next' };
    harness.listener(event, { tab: { id: 9 } as chrome.tabs.Tab }, () => undefined);
    expect(harness.broadcasts).toEqual([{ ...event, tabId: 9 }]);
  });

  it('never forwards an event without a sender tab', () => {
    harness.listener({ type: 'event.state', state }, {}, () => undefined);
    expect(harness.broadcasts).toEqual([]);
  });
});

describe('keyboard command', () => {
  it('toggles the active tab and announces the new state', async () => {
    expect(harness.commandListeners).toHaveLength(1);
    harness.commandListeners[0]?.('toggle-inspector');
    await vi.waitFor(() => {
      expect(harness.broadcasts).toEqual([
        expect.objectContaining({ type: 'event.state' }),
      ]);
    });
  });

  it('ignores commands it does not own', async () => {
    harness.commandListeners[0]?.('some-other-command');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(harness.broadcasts).toEqual([]);
  });
});

describe('side panel presence', () => {
  /** Every content.setBadge the worker pushed, in order. */
  function badgePushes(): { tabId: number; collapsed: boolean; reason: string }[] {
    return harness.contentRequests
      .filter(entry => entry.request.type === 'content.setBadge')
      .map(entry => ({
        tabId: entry.tabId,
        collapsed: (entry.request as { collapsed: boolean }).collapsed,
        reason: (entry.request as { reason: string }).reason,
      }));
  }

  it('records an open panel and tells that tab to collapse its badge', async () => {
    await expect(send({ type: 'sidepanel.presence', tabId: 1, open: true })).resolves.toEqual({
      ok: true,
    });
    expect(presenceTabs()).toEqual([1]);
    expect(badgePushes()).toEqual([{ tabId: 1, collapsed: true, reason: 'sidepanel' }]);
  });

  it('answers ok for a tab with no content script, and still records it', async () => {
    harness.contentRequests.length = 0;
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Receiving end does not exist'),
    );
    await expect(send({ type: 'sidepanel.presence', tabId: 4, open: true })).resolves.toEqual({
      ok: true,
    });
    expect(presenceTabs()).toEqual([4]);
  });

  it('forgets a tab whose panel closed and lets its badge come back', async () => {
    await send({ type: 'sidepanel.presence', tabId: 1, open: true });
    await send({ type: 'sidepanel.presence', tabId: 2, open: true });
    await send({ type: 'sidepanel.presence', tabId: 1, open: false });
    expect(presenceTabs()).toEqual([2]);
    expect(badgePushes().at(-1)).toEqual({ tabId: 1, collapsed: false, reason: 'sidepanel' });
  });

  it('mirrors the set into session storage so a restarted worker knows it', async () => {
    await send({ type: 'sidepanel.presence', tabId: 3, open: true });
    expect(harness.session.get('sidepanel.presence')).toEqual([3]);
  });

  it('collapses the badge again when the inspector is activated on that tab', async () => {
    await send({ type: 'sidepanel.presence', tabId: 1, open: true });
    harness.contentRequests.length = 0;

    await send({ type: 'inspector.setMode', tabId: 1, mode: 'active' });

    const types = harness.contentRequests.map(entry => entry.request.type);
    expect(types).toContain('content.setBadge');
    // The badge is only asked to step aside once the mode is applied: before
    // that there is no badge on the page to collapse.
    expect(types.indexOf('content.setBadge')).toBeGreaterThan(types.indexOf('content.setMode'));
    expect(badgePushes()).toEqual([{ tabId: 1, collapsed: true, reason: 'sidepanel' }]);
  });

  it('leaves the badge alone on a tab with no panel open', async () => {
    await send({ type: 'inspector.setMode', tabId: 1, mode: 'active' });
    expect(badgePushes()).toEqual([]);
  });

  it('clears every tab and restores every badge when the panel port disconnects', async () => {
    await send({ type: 'sidepanel.presence', tabId: 1, open: true });
    await send({ type: 'sidepanel.presence', tabId: 2, open: true });
    harness.contentRequests.length = 0;

    const port = harness.connect('sidepanel');
    port.disconnect();

    await vi.waitFor(() => {
      expect(presenceTabs()).toEqual([]);
    });
    await vi.waitFor(() => {
      expect(badgePushes()).toEqual([
        { tabId: 1, collapsed: false, reason: 'sidepanel' },
        { tabId: 2, collapsed: false, reason: 'sidepanel' },
      ]);
    });
  });

  it('ignores a port opened under any other name', async () => {
    await send({ type: 'sidepanel.presence', tabId: 1, open: true });
    harness.connect('something-else').disconnect();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(presenceTabs()).toEqual([1]);
  });
});
