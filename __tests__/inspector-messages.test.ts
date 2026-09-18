import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INSPECTOR_KEY, bootInspector } from '../lib/inspector/boot';
import { resetOverlaySession } from '../lib/inspector/overlay';
import type { ContentResponse, PageTools } from '../lib/messages';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

interface Harness {
  listeners: Listener[];
  sent: unknown[];
}

function installChrome(): Harness {
  const listeners: Listener[] = [];
  const sent: unknown[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'design-inspector-test',
      onMessage: {
        addListener: (listener: Listener) => listeners.push(listener),
        removeListener: () => undefined,
      },
      sendMessage: (message: unknown) => {
        sent.push(message);
        return Promise.resolve({ ok: true });
      },
    },
  };
  return { listeners, sent };
}

/** Dispatches one message and waits for the async sendResponse. */
async function send(harness: Harness, message: unknown): Promise<{ kept: unknown; response: unknown }> {
  const listener = harness.listeners[0];
  if (!listener) throw new Error('no listener was installed');
  let response: unknown;
  const kept = listener(message, { tab: { id: 7 } }, (value) => {
    response = value;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { kept, response };
}

function reset(): void {
  const container = globalThis as unknown as Record<
    symbol,
    { api?: { setMode(mode: 'off'): void } } | undefined
  >;
  // Deleting the symbol forgets the inspector but not its document listeners.
  // A selection controller left in 'active' swallows clicks in the capture
  // phase, including clicks meant for the next test's badge, so the previous
  // boot is switched off before it is dropped.
  try {
    container[INSPECTOR_KEY]?.api?.setMode('off');
  } catch {
    // A half-booted instance is still worth dropping.
  }
  delete container[INSPECTOR_KEY];
  // Rulers, the layout overlay and the badge's collapse decision all live for
  // the page session, so each test starts from a fresh one.
  resetOverlaySession();
  document.body.innerHTML = '';
  document.querySelectorAll('design-inspector-host').forEach((node) => node.remove());
  document
    .querySelectorAll('style[data-design-inspector-outlines]')
    .forEach((node) => node.remove());
}

let harness: Harness;

beforeEach(() => {
  reset();
  harness = installChrome();
  document.body.innerHTML = '<section id="hero"><h1 id="hero-heading">Hi</h1></section>';
});

afterEach(() => {
  reset();
  vi.restoreAllMocks();
});

describe('bootInspector', () => {
  it('installs exactly one message listener and is idempotent', () => {
    const first = bootInspector();
    const second = bootInspector();
    expect(harness.listeners).toHaveLength(1);
    expect(second).toBe(first);
  });

  it('exposes the harness api on the well known symbol', () => {
    bootInspector();
    const container = globalThis as unknown as Record<symbol, { api: Record<string, unknown> }>;
    const api = container[INSPECTOR_KEY]?.api;
    expect(Object.keys(api ?? {}).sort()).toEqual([
      'detectStack',
      'getState',
      'listAssets',
      'overlayRoot',
      'scanSummary',
      'semanticParents',
      'setMode',
      'setOutlines',
    ]);
  });

  it('does not throw when chrome is unavailable', () => {
    reset();
    const saved = (globalThis as unknown as { chrome?: unknown }).chrome;
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    expect(() => bootInspector()).not.toThrow();
    expect(bootInspector().getState().mode).toBe('off');
    (globalThis as unknown as { chrome?: unknown }).chrome = saved;
  });
});

describe('content message handling', () => {
  beforeEach(() => {
    bootInspector();
  });

  it('ignores values that are not messages', async () => {
    expect((await send(harness, 'hello')).kept).toBeUndefined();
    expect((await send(harness, null)).kept).toBeUndefined();
    expect((await send(harness, { nope: true })).kept).toBeUndefined();
  });

  it('ignores messages that are not content requests', async () => {
    const result = await send(harness, { type: 'inspector.toggle', tabId: 7 });
    expect(result.kept).toBeUndefined();
    expect(result.response).toBeUndefined();
  });

  it('answers content.ping', async () => {
    const { kept, response } = await send(harness, { type: 'content.ping' });
    expect(kept).toBe(true);
    expect(response).toEqual({ ok: true });
  });

  it('answers content.getState with tabId -1', async () => {
    const { response } = await send(harness, { type: 'content.getState' });
    const typed = response as Extract<ContentResponse, { state: unknown }>;
    expect(typed.ok).toBe(true);
    expect(typed.state).toMatchObject({ tabId: -1, mode: 'off', pinned: null, pageStale: false });
  });

  it('turns the overlay on and off through content.setMode', async () => {
    const on = await send(harness, { type: 'content.setMode', mode: 'active' });
    expect((on.response as { ok: boolean }).ok).toBe(true);
    expect(document.querySelectorAll('design-inspector-host')).toHaveLength(1);

    const host = document.querySelector('design-inspector-host');
    expect(host?.shadowRoot).not.toBeNull();

    const off = await send(harness, { type: 'content.setMode', mode: 'off' });
    expect((off.response as { state: { mode: string } }).state.mode).toBe('off');
    expect(document.querySelectorAll('design-inspector-host')).toHaveLength(0);
  });

  it('broadcasts event.state on a mode change', async () => {
    harness.sent.length = 0;
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const events = harness.sent as { type: string }[];
    expect(events.some((event) => event.type === 'event.state')).toBe(true);
  });

  it('keeps the overlay in paused mode', async () => {
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const paused = await send(harness, { type: 'content.setMode', mode: 'paused' });
    expect((paused.response as { state: { mode: string } }).state.mode).toBe('paused');
    expect(document.querySelectorAll('design-inspector-host')).toHaveLength(1);
  });

  it('installs and removes layout outlines through content.setOutlines', async () => {
    const outlineSheets = () => document.querySelectorAll('style[data-design-inspector-outlines]');

    const on = await send(harness, { type: 'content.setOutlines', mode: 'tag' });
    expect((on.response as { state: { outlines: string } }).state.outlines).toBe('tag');
    expect(outlineSheets()).toHaveLength(1);

    const depth = await send(harness, { type: 'content.setOutlines', mode: 'depth' });
    expect((depth.response as { state: { outlines: string } }).state.outlines).toBe('depth');
    expect(outlineSheets()).toHaveLength(1);

    const off = await send(harness, { type: 'content.setOutlines', mode: 'off' });
    expect((off.response as { state: { outlines: string } }).state.outlines).toBe('off');
    expect(outlineSheets()).toHaveLength(0);
  });

  it('reports the outline mode in every state it emits', async () => {
    harness.sent.length = 0;
    await send(harness, { type: 'content.setOutlines', mode: 'tag' });
    const states = (harness.sent as { type: string; state?: { outlines?: string } }[]).filter(
      (event) => event.type === 'event.state',
    );
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((event) => event.state?.outlines === 'tag')).toBe(true);

    const fetched = await send(harness, { type: 'content.getState' });
    expect((fetched.response as { state: { outlines: string } }).state.outlines).toBe('tag');
  });

  it('keeps outlines on while paused and drops them when the inspector exits', async () => {
    const outlineSheets = () => document.querySelectorAll('style[data-design-inspector-outlines]');
    await send(harness, { type: 'content.setMode', mode: 'active' });
    await send(harness, { type: 'content.setOutlines', mode: 'tag' });

    const paused = await send(harness, { type: 'content.setMode', mode: 'paused' });
    expect((paused.response as { state: { outlines: string } }).state.outlines).toBe('tag');
    expect(outlineSheets()).toHaveLength(1);

    const off = await send(harness, { type: 'content.setMode', mode: 'off' });
    expect((off.response as { state: { outlines: string } }).state.outlines).toBe('off');
    expect(outlineSheets()).toHaveLength(0);
  });

  it('answers content.getPinnedRect with null when nothing is pinned', async () => {
    const { response } = await send(harness, { type: 'content.getPinnedRect' });
    expect(response).toMatchObject({ ok: true, rect: null });
    expect((response as { devicePixelRatio: number }).devicePixelRatio).toBeTypeOf('number');
  });

  it('answers content.setOverlayVisible', async () => {
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const hidden = await send(harness, { type: 'content.setOverlayVisible', visible: false });
    expect(hidden.response).toEqual({ ok: true });
    const host = document.querySelector('design-inspector-host') as HTMLElement;
    expect(host.style.display).toBe('none');
    await send(harness, { type: 'content.setOverlayVisible', visible: true });
    expect(host.style.display).toBe('');
  });

  it('answers content.highlight and content.clearHighlight', async () => {
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const highlighted = await send(harness, {
      type: 'content.highlight',
      locators: ['#hero-heading', 'not a selector['],
    });
    expect(highlighted.response).toEqual({ ok: true });
    const cleared = await send(harness, { type: 'content.clearHighlight' });
    expect(cleared.response).toEqual({ ok: true });
  });

  it('reports a missing element for content.select', async () => {
    const { response } = await send(harness, { type: 'content.select', locator: '#absent' });
    expect(response).toEqual({ ok: false, error: 'Element is no longer on the page' });
  });

  it('reports an invalid locator for content.select', async () => {
    const { response } = await send(harness, { type: 'content.select', locator: '#bad[' });
    expect((response as { ok: boolean }).ok).toBe(false);
  });

  it('refuses to scroll to an offscreen element unless asked', async () => {
    // jsdom reports every rect as zero sized, which counts as offscreen.
    const { response } = await send(harness, { type: 'content.select', locator: '#hero-heading' });
    expect(response).toEqual({ ok: false, error: 'Element is offscreen' });
  });

  it('scrolls an offscreen element into view and pins it when scroll is asked for', async () => {
    const heading = document.getElementById('hero-heading') as HTMLElement;
    const calls: unknown[] = [];
    heading.scrollIntoView = (options?: unknown) => {
      calls.push(options);
    };

    const { response } = await send(harness, {
      type: 'content.select',
      locator: '#hero-heading',
      scroll: true,
    });
    const typed = response as { ok: boolean; state?: { pinned: { element: { id: string } } | null } };
    expect(typed.ok).toBe(true);
    expect(calls).toEqual([{ block: 'center' }]);
    expect(typed.state?.pinned?.element.id).toBe('hero-heading');
  });

  it('still refuses a missing element even when scroll is asked for', async () => {
    const { response } = await send(harness, {
      type: 'content.select',
      locator: '#absent',
      scroll: true,
    });
    expect(response).toEqual({ ok: false, error: 'Element is no longer on the page' });
  });

  it('answers content.listAssets', async () => {
    document.body.innerHTML = '<img id="logo" src="https://example.com/a.png" alt="A" />';
    const { response } = await send(harness, { type: 'content.listAssets' });
    const typed = response as { ok: boolean; assets: { kind: string; url: string | null }[] };
    expect(typed.ok).toBe(true);
    expect(typed.assets.some((asset) => asset.kind === 'img')).toBe(true);
  });

  it('answers content.detectStack with a page scoped report', async () => {
    const { response } = await send(harness, { type: 'content.detectStack', globals: [] });
    const typed = response as { ok: boolean; stack: { scope: string } };
    expect(typed.ok).toBe(true);
    expect(typed.stack.scope).toBe('page');
  });

  it('marks the page stale on content.notifyNavigation and keeps the mode', async () => {
    const api = bootInspector();
    api.setMode('active');
    const { response } = await send(harness, {
      type: 'content.notifyNavigation',
      url: 'https://example.com/next',
    });
    const typed = response as ContentResponse & { state?: { pageStale: boolean; mode: string } };
    expect(typed.ok).toBe(true);
    expect(typed.state?.pageStale).toBe(true);
    expect(typed.state?.mode).toBe('active');
    expect(api.getState().pinned).toBeNull();
    // The side panel learns about it too.
    expect(
      harness.sent.some(
        (message) => (message as { type?: string }).type === 'event.pageChanged',
      ),
    ).toBe(true);
  });

  it('answers content.cancelScan and fails the pending scan with Scan cancelled', async () => {
    const api = bootInspector();
    api.setMode('active');
    const pending = send(harness, { type: 'content.scanSummary', cap: 5000 });
    const cancelled = await send(harness, { type: 'content.cancelScan' });
    expect(cancelled.response).toEqual({ ok: true });
    const { response } = await pending;
    expect(response).toEqual({ ok: false, error: 'Scan cancelled' });
  });

  it('rejects an unknown content request', async () => {
    const { response } = await send(harness, { type: 'content.somethingElse' });
    expect(response).toEqual({ ok: false, error: 'Unsupported request' });
  });
});

describe('page tools and the badge the side panel mirrors', () => {
  beforeEach(() => {
    bootInspector();
  });

  /** The tools on the state a request answered with. */
  function toolsOf(response: unknown): PageTools | undefined {
    return (response as { state?: { tools?: PageTools } }).state?.tools;
  }

  it('reports the tools and the badge in every state it emits', async () => {
    const fetched = await send(harness, { type: 'content.getState' });
    expect(toolsOf(fetched.response)).toEqual({
      rulers: false,
      semanticParents: true,
      layoutOverlay: true,
    });
    expect((fetched.response as { state: { badgeCollapsed: boolean } }).state.badgeCollapsed).toBe(
      false,
    );

    harness.sent.length = 0;
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const states = (harness.sent as { type: string; state?: { tools?: PageTools } }[]).filter(
      event => event.type === 'event.state',
    );
    expect(states.length).toBeGreaterThan(0);
    expect(states.every(event => event.state?.tools !== undefined)).toBe(true);
  });

  it('applies content.setTools as a partial update and broadcasts the result', async () => {
    await send(harness, { type: 'content.setMode', mode: 'active' });
    harness.sent.length = 0;

    const rulers = await send(harness, { type: 'content.setTools', tools: { rulers: true } });
    expect(toolsOf(rulers.response)).toEqual({
      rulers: true,
      semanticParents: true,
      layoutOverlay: true,
    });
    const root = (document.querySelector('design-inspector-host') as HTMLElement).shadowRoot;
    expect((root?.getElementById('ruler-layer') as HTMLElement).hidden).toBe(false);
    expect(
      harness.sent.some(message => (message as { type?: string }).type === 'event.state'),
    ).toBe(true);

    // The tools left out of the update are the ones left alone.
    const semantic = await send(harness, {
      type: 'content.setTools',
      tools: { semanticParents: false },
    });
    expect(toolsOf(semantic.response)).toEqual({
      rulers: true,
      semanticParents: false,
      layoutOverlay: true,
    });
    expect(bootInspector().semanticParents()).toBe(false);
    expect(root?.getElementById('badge-semantic')?.getAttribute('aria-pressed')).toBe('false');

    const layout = await send(harness, {
      type: 'content.setTools',
      tools: { layoutOverlay: false },
    });
    expect(toolsOf(layout.response)).toEqual({
      rulers: true,
      semanticParents: false,
      layoutOverlay: false,
    });
  });

  it('keeps a tool set with the inspector off and applies it on the next activation', async () => {
    await send(harness, { type: 'content.setTools', tools: { rulers: true } });
    expect(toolsOf((await send(harness, { type: 'content.getState' })).response)?.rulers).toBe(true);

    await send(harness, { type: 'content.setMode', mode: 'active' });
    const root = (document.querySelector('design-inspector-host') as HTMLElement).shadowRoot;
    expect((root?.getElementById('ruler-layer') as HTMLElement).hidden).toBe(false);
  });

  it('collapses the badge to its dot for the side panel, and says so on the dot', async () => {
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const root = (document.querySelector('design-inspector-host') as HTMLElement).shadowRoot;
    const badge = root?.getElementById('badge') as HTMLElement;
    const dot = root?.getElementById('badge-collapse') as HTMLButtonElement;
    expect(badge.dataset.collapsed).toBe('false');

    const collapsed = await send(harness, {
      type: 'content.setBadge',
      collapsed: true,
      reason: 'sidepanel',
    });
    expect((collapsed.response as { state: { badgeCollapsed: boolean } }).state.badgeCollapsed).toBe(
      true,
    );
    expect(badge.dataset.collapsed).toBe('true');
    expect(dot.getAttribute('title')).toBe('Controls are in the side panel. Click to expand.');

    // Closing the panel gives the badge back.
    await send(harness, { type: 'content.setBadge', collapsed: false, reason: 'sidepanel' });
    expect(badge.dataset.collapsed).toBe('false');
  });

  it('says only "Click to expand" when no side panel is involved', async () => {
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const root = (document.querySelector('design-inspector-host') as HTMLElement).shadowRoot;
    const dot = root?.getElementById('badge-collapse') as HTMLButtonElement;
    await send(harness, { type: 'content.setBadge', collapsed: true, reason: 'user' });
    expect(dot.getAttribute('title')).toBe('Click to expand');
  });

  it('lets a user expansion stand until the panel state changes again', async () => {
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const root = (document.querySelector('design-inspector-host') as HTMLElement).shadowRoot;
    const badge = root?.getElementById('badge') as HTMLElement;
    const dot = root?.getElementById('badge-collapse') as HTMLButtonElement;

    await send(harness, { type: 'content.setBadge', collapsed: true, reason: 'sidepanel' });
    dot.click();
    expect(badge.dataset.collapsed).toBe('false');

    // The panel is still open: nothing else is allowed to collapse it back.
    await send(harness, { type: 'content.setTools', tools: { rulers: true } });
    expect(badge.dataset.collapsed).toBe('false');

    // The panel closing is a presence change, which takes the decision back.
    await send(harness, { type: 'content.setBadge', collapsed: false, reason: 'sidepanel' });
    expect(badge.dataset.collapsed).toBe('false');
  });

  it('leaves a badge the user collapsed themselves collapsed when the panel closes', async () => {
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const root = (document.querySelector('design-inspector-host') as HTMLElement).shadowRoot;
    const badge = root?.getElementById('badge') as HTMLElement;
    const dot = root?.getElementById('badge-collapse') as HTMLButtonElement;

    await send(harness, { type: 'content.setBadge', collapsed: true, reason: 'sidepanel' });
    dot.click();
    dot.click();
    expect(badge.dataset.collapsed).toBe('true');

    await send(harness, { type: 'content.setBadge', collapsed: false, reason: 'sidepanel' });
    expect(badge.dataset.collapsed).toBe('true');
  });

  it('remembers a collapse asked for before the inspector was switched on', async () => {
    await send(harness, { type: 'content.setBadge', collapsed: true, reason: 'sidepanel' });
    await send(harness, { type: 'content.setMode', mode: 'active' });
    const root = (document.querySelector('design-inspector-host') as HTMLElement).shadowRoot;
    expect((root?.getElementById('badge') as HTMLElement).dataset.collapsed).toBe('true');
  });
});
