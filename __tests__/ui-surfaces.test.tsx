import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { StackReport } from '@/lib/contracts';
import { PopupApp, statusText } from '@/lib/ui/popup/PopupApp';
import { SidePanelApp } from '@/lib/ui/sidepanel/SidePanelApp';
import { actionLabel, noticeText } from '@/lib/ui/shared/components';
import { StackReportView } from '@/lib/ui/sidepanel/StackReportView';
import { classifyTabUpdate } from '@/lib/ui/shared/hooks';
import { applyTheme } from '@/lib/ui/shared/theme';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: (() => void)[] = [];

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  mounted.push(() => {
    void act(() => {
      root.unmount();
    });
    container.remove();
  });
  return container;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
  document.documentElement.removeAttribute('data-theme');
});

describe('status text', () => {
  it('names each inspector mode in one word', () => {
    expect(statusText('active', null)).toBe('Inspecting');
    expect(statusText('paused', null)).toBe('Paused');
    expect(statusText('off', null)).toBe('Off');
    expect(statusText(null, null)).toBe('Checking');
  });

  it('keeps the unsupported reason out of the status pill', () => {
    // The pill says what the inspector is doing. Why a page refuses it is a
    // different fact, and it belongs in the notice under the button.
    expect(statusText('off', 'Chrome does not allow extensions on browser pages.')).toBe('Off');
    expect(noticeText('chrome://extensions/', 'Chrome does not allow extensions.')).toMatch(
      /does not allow/,
    );
  });

  it('tells an empty tab what to do instead of quoting Chrome', () => {
    expect(noticeText('chrome://newtab/', 'Chrome does not allow extensions on browser pages.'))
      .toBe('Open a website to inspect it.');
    expect(noticeText('https://example.com/', null)).toBe(null);
  });

  it('names the primary action for each mode', () => {
    expect(actionLabel('off')).toBe('Inspect this page');
    expect(actionLabel('active')).toBe('Stop inspecting');
    expect(actionLabel('paused')).toBe('Resume inspecting');
  });
});

describe('classifyTabUpdate', () => {
  it('reads a bare url change as an application route change', () => {
    expect(classifyTabUpdate({ url: 'https://linear.app/pricing' }, { sawLoading: false })).toBe(
      'same-document',
    );
  });

  it('waits for a load to complete before deciding a document was replaced', () => {
    expect(classifyTabUpdate({ status: 'loading' }, { sawLoading: false })).toBe('ignore');
    expect(classifyTabUpdate({ status: 'complete' }, { sawLoading: true })).toBe('load-complete');
  });

  it('ignores a completion that no load preceded', () => {
    expect(classifyTabUpdate({ status: 'complete' }, { sawLoading: false })).toBe('ignore');
  });

  it('ignores an update that carries neither a status nor a url', () => {
    expect(classifyTabUpdate({}, { sawLoading: true })).toBe('ignore');
  });
});

describe('applyTheme', () => {
  it('pins an explicit theme and clears it again for system', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('StackReportView', () => {
  it('states that no evidence is not proof of absence', async () => {
    const report: StackReport = {
      detections: [],
      hints: [],
      scope: 'page',
      observedAt: '2026-09-18T10:00:00.000Z',
    };
    const container = await render(<StackReportView report={report} />);
    expect(container.textContent).toContain('No confident evidence found');
    expect(container.textContent).toContain('does not prove a technology is absent');
    // The readable local stamp; the ISO string belongs to the exports.
    expect(container.textContent).toMatch(/Observed at \d{1,2} \w{3} 2026, \d{2}:\d{2}/);
  });

  it('groups detections by category with a confidence label and collapsed evidence', async () => {
    const report: StackReport = {
      detections: [
        {
          id: 'next',
          name: 'Next.js',
          category: 'framework',
          confidence: 'high',
          evidence: [{ kind: 'dom-marker', detail: 'script#__NEXT_DATA__' }],
          version: null,
          observedAt: '2026-09-18T10:00:00.000Z',
        },
        {
          id: 'gsap',
          name: 'GSAP',
          category: 'motion-3d',
          confidence: 'likely',
          evidence: [{ kind: 'global', detail: 'gsap' }],
          version: null,
          observedAt: '2026-09-18T10:00:00.000Z',
        },
      ],
      hints: [{ name: 'Tailwind', evidence: [{ kind: 'dom-marker', detail: 'class="flex"' }] }],
      scope: 'page',
      observedAt: '2026-09-18T10:00:00.000Z',
    };
    const container = await render(<StackReportView report={report} />);
    expect(container.textContent).toContain('Frameworks');
    expect(container.textContent).toContain('Motion and 3D');
    expect(container.textContent).toContain('High');
    expect(container.textContent).toContain('Likely');
    expect(container.textContent).toContain('Weak hints (1)');
    const hintDetails = [...container.querySelectorAll('details')].find(details =>
      details.textContent?.includes('Weak hints'),
    );
    expect(hintDetails?.open).toBe(false);
  });

  it('offers an empty state when nothing has been gathered', async () => {
    const container = await render(<StackReportView report={null} />);
    expect(container.textContent).toContain('No stack report yet');
  });
});

describe('surfaces render without a chrome runtime', () => {
  it('renders the popup with its privacy promise', async () => {
    const container = await render(<PopupApp />);
    expect(container.textContent).toContain('Design Inspector');
    expect(container.textContent).toContain('stay on your device');
    expect(container.textContent).toContain('Set shortcut');
    const toggle = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Inspect this page',
    );
    expect(toggle).toBeDefined();
    expect(toggle?.disabled).toBe(true);
  });

  it('renders the side panel with every tab and the summary panel selected', async () => {
    const container = await render(<SidePanelApp />);
    const tabs = [...container.querySelectorAll('[role="tab"]')].map(tab => tab.textContent);
    expect(tabs).toEqual(['Summary', 'Assets', 'Stack', 'Tools', 'Saved']);
    const selected = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe('Summary');
    expect(container.textContent).toContain('No page summary yet');
  });

  it('moves between tabs with the arrow keys', async () => {
    const container = await render(<SidePanelApp />);
    const tablist = container.querySelector('[role="tablist"]');
    const stack = [...container.querySelectorAll('[role="tab"]')][2];
    expect(stack?.getAttribute('aria-selected')).toBe('false');
    for (let press = 0; press < 2; press += 1) {
      await act(async () => {
        tablist?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
      });
    }
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toBe('Stack');
  });

  // Chrome's side panel is dragged to whatever width the user wants, and 300px
  // is the narrow end of that. Anything that pins a width wider than the pane
  // takes the whole column with it and clips the left edge, so nothing in the
  // panel is allowed to declare one.
  it('pins no width wider than a narrow side panel', async () => {
    const container = await render(<SidePanelApp />);
    const offenders: string[] = [];
    for (const element of container.querySelectorAll<HTMLElement>('*')) {
      for (const value of [element.style.width, element.style.minWidth]) {
        const px = /^(\d+(?:\.\d+)?)px$/.exec(value ?? '');
        if (px && Number(px[1]) > 300) offenders.push(`${element.tagName} style ${value}`);
      }
      for (const match of (element.getAttribute('class') ?? '').matchAll(
        /(?:^|\s)(?:min-)?w-\[(\d+)px\]/g,
      )) {
        if (Number(match[1]) > 300) offenders.push(`${element.tagName} class ${match[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every icon-only control an accessible name', async () => {
    const container = await render(<SidePanelApp />);
    for (const button of container.querySelectorAll('button')) {
      const named =
        (button.textContent ?? '').trim().length > 0 || button.hasAttribute('aria-label');
      expect(named, button.outerHTML).toBe(true);
    }
  });
});

describe('side panel with a stubbed chrome runtime', () => {
  it('asks the background for a scan when the user requests one', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: 'Scan refused in this test' }));
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        id: 'test',
        sendMessage,
        onMessage: { addListener: () => undefined, removeListener: () => undefined },
        getManifest: () => ({ version: '0.1.0' }),
      },
      tabs: {
        query: async () => [{ id: 3, url: 'https://example.com/', title: 'Example' }],
        onActivated: { addListener: () => undefined, removeListener: () => undefined },
        onUpdated: { addListener: () => undefined, removeListener: () => undefined },
      },
      storage: {
        local: { get: async () => ({}), set: async () => undefined },
        onChanged: { addListener: () => undefined, removeListener: () => undefined },
      },
      commands: { getAll: async () => [] },
    };
    try {
      const container = await render(<SidePanelApp />);
      expect(container.textContent).toContain('Example');
      const scan = [...container.querySelectorAll('button')].find(
        button => button.textContent === 'Scan this page',
      );
      await act(async () => {
        scan?.click();
      });
      expect(sendMessage).toHaveBeenCalledWith({ type: 'summary.request', tabId: 3 });
      expect(container.textContent).toContain('Scan refused in this test');
    } finally {
      // Unmount while chrome still exists, the way a real panel closes.
      while (mounted.length) mounted.pop()?.();
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });
});

describe('layout outlines in the popup', () => {
  function stubChrome(sendMessage: ReturnType<typeof vi.fn>, coloring: 'tag' | 'depth') {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        id: 'test',
        sendMessage,
        onMessage: { addListener: () => undefined, removeListener: () => undefined },
        getManifest: () => ({ version: '0.1.0' }),
      },
      tabs: {
        query: async () => [{ id: 4, url: 'https://example.com/', title: 'Example' }],
        onActivated: { addListener: () => undefined, removeListener: () => undefined },
        onUpdated: { addListener: () => undefined, removeListener: () => undefined },
      },
      storage: {
        local: {
          get: async () => ({
            settings: { theme: 'system', hoverCard: true, summaryScanCap: 5000, outlineColoring: coloring },
          }),
          set: async () => undefined,
        },
        onChanged: { addListener: () => undefined, removeListener: () => undefined },
      },
      commands: { getAll: async () => [] },
    };
  }

  afterEach(() => {
    while (mounted.length) mounted.pop()?.();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('sends the configured coloring when switched on and off again', async () => {
    const state = {
      tabId: 4,
      mode: 'off' as const,
      pinned: null,
      pageStale: false,
      unsupportedReason: null,
      outlines: 'off' as const,
    };
    const sendMessage = vi.fn(async (request: { type: string; mode?: string }) => {
      if (request.type === 'outlines.set') {
        return { ok: true, state: { ...state, outlines: request.mode } };
      }
      return { ok: true, state };
    });
    stubChrome(sendMessage, 'depth');

    const container = await render(<PopupApp />);
    const outlines = container.querySelector('#layout-outlines') as HTMLInputElement;
    expect(outlines).not.toBeNull();
    expect(outlines.checked).toBe(false);

    await act(async () => {
      outlines.click();
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'outlines.set', tabId: 4, mode: 'depth' });
    expect((container.querySelector('#layout-outlines') as HTMLInputElement).checked).toBe(true);

    await act(async () => {
      (container.querySelector('#layout-outlines') as HTMLInputElement).click();
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'outlines.set', tabId: 4, mode: 'off' });
  });

  it('re-applies immediately when the coloring changes with outlines on', async () => {
    const sendMessage = vi.fn(async (request: { type: string; mode?: string }) => ({
      ok: true,
      state: {
        tabId: 4,
        mode: 'off',
        pinned: null,
        pageStale: false,
        unsupportedReason: null,
        outlines: request.type === 'outlines.set' ? request.mode : 'off',
      },
    }));
    stubChrome(sendMessage, 'tag');

    const container = await render(<PopupApp />);
    await act(async () => {
      (container.querySelector('#layout-outlines') as HTMLInputElement).click();
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'outlines.set', tabId: 4, mode: 'tag' });

    // The coloring segments only exist while the outlines are on, which the
    // click above just did.
    const byDepth = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Depth',
    );
    await act(async () => {
      byDepth?.click();
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'outlines.set', tabId: 4, mode: 'depth' });
  });
});

describe('side panel page tools row', () => {
  const baseState = {
    tabId: 3,
    mode: 'active' as const,
    pinned: null,
    pageStale: false,
    unsupportedReason: null,
    outlines: 'off' as const,
    tools: { rulers: false, semanticParents: true, layoutOverlay: true },
    badgeCollapsed: true,
  };

  function stubChrome(sendMessage: ReturnType<typeof vi.fn>, connect?: ReturnType<typeof vi.fn>) {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        id: 'test',
        sendMessage,
        connect: connect ?? (() => ({ disconnect: () => undefined })),
        onMessage: { addListener: () => undefined, removeListener: () => undefined },
        getManifest: () => ({ version: '0.1.0' }),
      },
      tabs: {
        query: async () => [{ id: 3, url: 'https://example.com/', title: 'Example' }],
        onActivated: { addListener: () => undefined, removeListener: () => undefined },
        onUpdated: { addListener: () => undefined, removeListener: () => undefined },
      },
      storage: {
        local: { get: async () => ({}), set: async () => undefined },
        onChanged: { addListener: () => undefined, removeListener: () => undefined },
      },
      commands: { getAll: async () => [] },
    };
  }

  function pill(container: HTMLElement, label: string): HTMLButtonElement | undefined {
    return [...container.querySelectorAll('button')].find(
      button => button.textContent === label,
    ) as HTMLButtonElement | undefined;
  }

  afterEach(() => {
    while (mounted.length) mounted.pop()?.();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('mirrors the badge tools and sends tools.set for the one that was pressed', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, state: baseState }));
    stubChrome(sendMessage);
    const container = await render(<SidePanelApp />);

    const row = container.querySelector('[role="group"][aria-label="Page tools"]');
    expect(row).not.toBeNull();
    expect(pill(container, 'Rulers')?.getAttribute('aria-pressed')).toBe('false');
    expect(pill(container, 'Semantic')?.getAttribute('aria-pressed')).toBe('true');
    expect(pill(container, 'Layout overlay')?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      pill(container, 'Rulers')?.click();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'tools.set',
      tabId: 3,
      tools: { rulers: true },
    });

    await act(async () => {
      pill(container, 'Semantic')?.click();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'tools.set',
      tabId: 3,
      tools: { semanticParents: false },
    });

    await act(async () => {
      pill(container, 'Layout overlay')?.click();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'tools.set',
      tabId: 3,
      tools: { layoutOverlay: false },
    });
  });

  it('hands the page back with Interact with page, and takes it again', async () => {
    const sendMessage = vi.fn(async (request: { type: string; mode?: string }) => ({
      ok: true,
      state:
        request.type === 'inspector.setMode'
          ? { ...baseState, mode: request.mode }
          : baseState,
    }));
    stubChrome(sendMessage);
    const container = await render(<SidePanelApp />);

    const interact = () => pill(container, 'Interact with page');
    expect(interact()?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      interact()?.click();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'inspector.setMode',
      tabId: 3,
      mode: 'paused',
    });
    expect(interact()?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      interact()?.click();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'inspector.setMode',
      tabId: 3,
      mode: 'active',
    });
  });

  it('says where Pick color is without spending a row on it', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, state: baseState }));
    stubChrome(sendMessage);
    const container = await render(<SidePanelApp />);

    expect(pill(container, 'Pick color')).toBeUndefined();
    const hint = container.querySelector('#panel-pick-hint');
    expect(hint?.textContent).toBe('Pick color is on the page badge');
    // Hidden until the info control is hovered or focused, and named for the
    // reader who never hovers anything.
    expect(hint?.className).toContain('opacity-0');
    const info = container.querySelector('[aria-label="Where Pick color is"]');
    expect(info?.getAttribute('aria-describedby')).toBe('panel-pick-hint');
  });

  it('leaves the tools row inert until the inspector is running', async () => {
    const sendMessage = vi.fn(async () => ({
      ok: true,
      state: { ...baseState, mode: 'off' as const },
    }));
    stubChrome(sendMessage);
    const container = await render(<SidePanelApp />);

    for (const label of ['Rulers', 'Semantic', 'Layout overlay', 'Interact with page']) {
      expect(pill(container, label)?.disabled, label).toBe(true);
    }
  });

  it('reports its presence for the active tab and withdraws it on unmount', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, state: baseState }));
    const disconnect = vi.fn();
    const connect = vi.fn(() => ({ disconnect }));
    stubChrome(sendMessage, connect);

    await render(<SidePanelApp />);
    expect(connect).toHaveBeenCalledWith({ name: 'sidepanel' });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'sidepanel.presence',
      tabId: 3,
      open: true,
    });

    while (mounted.length) mounted.pop()?.();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'sidepanel.presence',
      tabId: 3,
      open: false,
    });
    expect(disconnect).toHaveBeenCalled();
  });
});
