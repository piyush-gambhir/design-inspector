import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

// One in-memory store keyed by origin, standing in for idb.
const fakeIdb = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  return {
    records,
    db: {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => ({ createIndex: () => undefined }),
      get: async (_name: string, key: string) => records.get(key),
      getAll: async () => [...records.values()],
      put: async (_name: string, value: unknown) => {
        records.set((value as { origin: string }).origin, value);
      },
      delete: async (_name: string, key: string) => {
        records.delete(key);
      },
      clear: async () => records.clear(),
    },
  };
});

vi.mock('idb', () => ({ openDB: async () => fakeIdb.db }));

const { ToolsTab, fileRejection, nudgeAmount } = await import('@/lib/ui/sidepanel/ToolsTab');
const { DEFAULT_MOCKUP_STATE, MAX_MOCKUP_BYTES, getMockup, resetMockupDatabaseForTests } =
  await import('@/lib/storage/mockups');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGIN = 'https://example.com';
const PAGE_URL = `${ORIGIN}/pricing`;

let sent: { type: string; mockup: unknown }[] = [];
const mounted: (() => void)[] = [];

function installChrome(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'design-inspector-test',
      sendMessage: (message: { type: string; mockup: unknown }) => {
        sent.push(message);
        return Promise.resolve({ ok: true });
      },
      onMessage: { addListener: () => undefined, removeListener: () => undefined },
    },
  };
}

interface Mounted {
  container: HTMLDivElement;
  rerender: (next: ReactNode) => Promise<void>;
}

/**
 * The tab's work is asynchronous twice over: a FileReader read and an
 * IndexedDB write. A macrotask turn per settle lets both land before the
 * assertions run.
 */
async function settle(times = 3): Promise<void> {
  for (let turn = 0; turn < times; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(node: ReactNode): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  await settle();
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    container,
    rerender: async (next) => {
      await act(async () => {
        root.render(next);
      });
      await settle();
    },
  };
}

/** Push a file through the file input, which jsdom will not do on its own. */
async function chooseFile(container: HTMLElement, file: File): Promise<void> {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

function pngFile(name = 'comp.png', bytes = 32): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

beforeEach(() => {
  sent = [];
  fakeIdb.records.clear();
  resetMockupDatabaseForTests();
  installChrome();
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
  document.body.innerHTML = '';
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('nudgeAmount', () => {
  it('nudges by 1px, and by 10px with Shift', () => {
    expect(nudgeAmount('ArrowRight', false)).toBe(1);
    expect(nudgeAmount('ArrowLeft', false)).toBe(-1);
    expect(nudgeAmount('ArrowUp', true)).toBe(10);
    expect(nudgeAmount('ArrowDown', true)).toBe(-10);
  });

  it('ignores every other key', () => {
    expect(nudgeAmount('Enter', false)).toBe(0);
    expect(nudgeAmount('a', true)).toBe(0);
  });
});

describe('fileRejection', () => {
  it('accepts the four offered image types', () => {
    ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].forEach((type) => {
      expect(fileRejection(new File([''], 'x', { type }))).toBeNull();
    });
  });

  it('names the type it was given when it refuses one', () => {
    const message = fileRejection(new File([''], 'notes.pdf', { type: 'application/pdf' }));
    expect(message).toContain('notes.pdf');
    expect(message).toContain('PNG, JPG, WebP and SVG');
  });

  it('refuses anything over the cap', () => {
    const big = new File([''], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: MAX_MOCKUP_BYTES + 1 });
    expect(fileRejection(big)).toContain('capped at 20 MB');
  });
});

describe('ToolsTab', () => {
  it('explains itself when the page has no origin to key on', async () => {
    const { container } = await render(<ToolsTab tabId={1} tabUrl="" pageMockup={null} />);
    expect(container.textContent).toContain('No site to overlay');
  });

  it('offers the drop zone and the file input before a mockup exists', async () => {
    const { container } = await render(<ToolsTab tabId={1} tabUrl={PAGE_URL} pageMockup={null} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('image/png,image/jpeg,image/webp,image/svg+xml');
    expect(container.textContent).toContain('Drop a PNG, JPG, WebP or SVG here');
    // No controls until there is something to control.
    expect(container.querySelector('#mockup-opacity')).toBeNull();
  });

  it('stores a chosen file for the origin and sends it to the tab', async () => {
    const { container } = await render(<ToolsTab tabId={7} tabUrl={PAGE_URL} pageMockup={null} />);
    await chooseFile(container, pngFile());

    const stored = await getMockup(ORIGIN);
    expect(stored?.origin).toBe(ORIGIN);
    expect(stored?.state).toEqual(DEFAULT_MOCKUP_STATE);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'mockup.set', tabId: 7 });
    const mockup = sent[0]?.mockup as { dataUrl: string; opacity: number };
    expect(mockup.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(mockup.opacity).toBe(DEFAULT_MOCKUP_STATE.opacity);
    expect(container.textContent).toContain('comp.png');
  });

  it('refuses an oversized image without storing or sending anything', async () => {
    const { container } = await render(<ToolsTab tabId={7} tabUrl={PAGE_URL} pageMockup={null} />);
    const big = pngFile('huge.png');
    Object.defineProperty(big, 'size', { value: MAX_MOCKUP_BYTES + 1 });
    await chooseFile(container, big);

    expect(container.textContent).toContain('capped at 20 MB');
    expect(await getMockup(ORIGIN)).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('shows every control once a mockup exists', async () => {
    const { container } = await render(<ToolsTab tabId={7} tabUrl={PAGE_URL} pageMockup={null} />);
    await chooseFile(container, pngFile());

    expect(container.querySelector('#mockup-opacity')).not.toBeNull();
    expect(container.querySelector('#mockup-x')).not.toBeNull();
    expect(container.querySelector('#mockup-y')).not.toBeNull();
    expect(container.querySelector('#mockup-scale')).not.toBeNull();
    expect(container.querySelector('#mockup-visible')).not.toBeNull();
    expect(container.querySelector('#mockup-locked')).not.toBeNull();
    const blends = [...container.querySelectorAll('[aria-label="Blend mode"] button')].map(
      (node) => node.textContent,
    );
    expect(blends).toEqual(['Normal', 'Difference']);
    expect(container.textContent).toContain('Remove');
  });

  it('nudges the offset with the arrow keys and persists the new value', async () => {
    const { container } = await render(<ToolsTab tabId={7} tabUrl={PAGE_URL} pageMockup={null} />);
    await chooseFile(container, pngFile());
    sent = [];

    const x = container.querySelector('#mockup-x') as HTMLInputElement;
    await act(async () => {
      x.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect((container.querySelector('#mockup-x') as HTMLInputElement).value).toBe('1');

    await act(async () => {
      x.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      );
    });
    expect((container.querySelector('#mockup-x') as HTMLInputElement).value).toBe('11');

    await settle();
    expect((await getMockup(ORIGIN))?.state.x).toBe(11);
    expect((sent.at(-1)?.mockup as { x: number }).x).toBe(11);
  });

  it('switches the blend mode and re-sends the image with it', async () => {
    const { container } = await render(<ToolsTab tabId={7} tabUrl={PAGE_URL} pageMockup={null} />);
    await chooseFile(container, pngFile());
    sent = [];

    const difference = [...container.querySelectorAll('[aria-label="Blend mode"] button')].find(
      (node) => node.textContent === 'Difference',
    ) as HTMLButtonElement;
    await act(async () => {
      difference.click();
    });
    await settle();

    expect((sent.at(-1)?.mockup as { blend: string }).blend).toBe('difference');
    expect((await getMockup(ORIGIN))?.state.blend).toBe('difference');
  });

  it('removes the mockup and tells the tab to clear it', async () => {
    const { container } = await render(<ToolsTab tabId={7} tabUrl={PAGE_URL} pageMockup={null} />);
    await chooseFile(container, pngFile());
    sent = [];

    const remove = [...container.querySelectorAll('button')].find(
      (node) => node.textContent?.includes('Remove'),
    ) as HTMLButtonElement;
    await act(async () => {
      remove.click();
    });
    await settle();

    expect(await getMockup(ORIGIN)).toBeNull();
    expect(sent.at(-1)).toMatchObject({ type: 'mockup.set', mockup: null });
    expect(container.querySelector('#mockup-opacity')).toBeNull();
  });

  it('loads the stored mockup for the origin and re-sends it on activation', async () => {
    fakeIdb.records.set(ORIGIN, {
      origin: ORIGIN,
      blob: new Blob([new Uint8Array(8)], { type: 'image/png' }),
      state: { ...DEFAULT_MOCKUP_STATE, opacity: 0.2, x: 15 },
      updatedAt: new Date().toISOString(),
    });

    const { container } = await render(<ToolsTab tabId={7} tabUrl={PAGE_URL} pageMockup={null} />);

    expect((container.querySelector('#mockup-x') as HTMLInputElement).value).toBe('15');
    expect(sent.at(-1)).toMatchObject({ type: 'mockup.set' });
    expect((sent.at(-1)?.mockup as { opacity: number }).opacity).toBe(0.2);
  });

  it('writes an offset the page reports back, without touching the stored image', async () => {
    const { container, rerender } = await render(
      <ToolsTab tabId={7} tabUrl={PAGE_URL} pageMockup={null} />,
    );
    await chooseFile(container, pngFile());
    const blobBefore = (await getMockup(ORIGIN))?.blob;
    sent = [];

    // What a drag on the page looks like from here: a new state, same image.
    await rerender(
      <ToolsTab
        tabId={7}
        tabUrl={PAGE_URL}
        pageMockup={{ ...DEFAULT_MOCKUP_STATE, x: 88, y: -24 }}
      />,
    );

    const stored = await getMockup(ORIGIN);
    expect(stored?.state).toMatchObject({ x: 88, y: -24 });
    expect(stored?.blob).toBe(blobBefore);
    expect((container.querySelector('#mockup-x') as HTMLInputElement).value).toBe('88');
  });
});

describe('ToolsTab and a mockup it did not set (F8)', () => {
  const foreign = {
    opacity: 0.4,
    x: 12,
    y: 34,
    scale: 1.5,
    visible: true,
    blend: 'difference' as const,
    locked: true,
  };

  it('reports the page state, says it is not saved, and offers Remove', async () => {
    const { container } = await render(
      <ToolsTab tabId={3} tabUrl={PAGE_URL} pageMockup={foreign} />,
    );
    const block = container.querySelector('[data-role="foreign-mockup"]') as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.textContent).toContain('Set from outside this panel; not saved.');
    expect(block.textContent).toContain('0.40');
    expect(block.textContent).toContain('12, 34');
    expect(block.textContent).toContain('1.5');
    expect(block.textContent).toContain('difference');
    // Nothing to edit: there is no stored image behind these numbers.
    expect(container.querySelector('#mockup-opacity')).toBeNull();

    const remove = [...block.querySelectorAll('button')].find(
      node => node.textContent?.includes('Remove'),
    ) as HTMLButtonElement;
    await act(async () => {
      remove.click();
    });
    await settle();
    expect(sent).toContainEqual({ type: 'mockup.set', tabId: 3, mockup: null });
    expect(container.textContent).toContain('Mockup removed from the page.');
  });

  it('says nothing about a foreign mockup once the tab owns one', async () => {
    const { container, rerender } = await render(
      <ToolsTab tabId={3} tabUrl={PAGE_URL} pageMockup={null} />,
    );
    await chooseFile(container, pngFile());
    await rerender(<ToolsTab tabId={3} tabUrl={PAGE_URL} pageMockup={foreign} />);
    expect(container.querySelector('[data-role="foreign-mockup"]')).toBeNull();
    expect(container.querySelector('#mockup-opacity')).not.toBeNull();
  });

  it('shows nothing extra when the page has no mockup either', async () => {
    const { container } = await render(<ToolsTab tabId={3} tabUrl={PAGE_URL} pageMockup={null} />);
    expect(container.querySelector('[data-role="foreign-mockup"]')).toBeNull();
  });
});

describe('a fresh mockup starts locked (F4)', () => {
  it('defaults to a locked comp, and says how to unlock it', async () => {
    expect(DEFAULT_MOCKUP_STATE.locked).toBe(true);
    const { container } = await render(<ToolsTab tabId={1} tabUrl={PAGE_URL} pageMockup={null} />);
    await chooseFile(container, pngFile());
    const toggle = container.querySelector('#mockup-locked') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(container.textContent).toContain('Unlock to drag the comp on the page');
  });
});
