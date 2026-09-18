import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ColorGroup } from '@/lib/contracts';
import { parseColor } from '@/lib/readings/color';
import { clusterPalette } from '@/lib/readings/summary-aggregate';
import { PaletteView } from '@/lib/ui/sidepanel/PaletteView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: (() => void)[] = [];
let sent: unknown[] = [];

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

function group(
  raw: string,
  role: ColorGroup['role'],
  count: number,
  overrides: Partial<ColorGroup> = {},
): ColorGroup {
  const color = parseColor(raw);
  return {
    role,
    color,
    key: (color.hex ?? color.raw).toLowerCase(),
    count,
    inferredRole: null,
    examples: [{ locator: `#${role}`, label: role }],
    ...overrides,
  };
}

const colors: ColorGroup[] = [
  group('#0a0a0a', 'text', 42, { inferredRole: 'neutral' }),
  group('#0b0b0c', 'border', 6),
  group('#4f46e5', 'text', 3, { inferredRole: 'accent' }),
  group('#e11d48', 'background', 9),
];

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')];
}

function chip(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return buttons(container).find(button => button.textContent === label);
}

beforeEach(() => {
  sent = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test',
      sendMessage: vi.fn(async (message: unknown) => {
        sent.push(message);
        return { ok: true };
      }),
      onMessage: { addListener: () => undefined, removeListener: () => undefined },
    },
  };
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('PaletteView', () => {
  it('shows one row per cluster with its hex, count and roles as text', async () => {
    const container = await render(<PaletteView colors={colors} tabId={1} />);

    // The two near-black values read as one swatch carrying both roles.
    expect(container.textContent).toContain('3 swatches from 4 measured values');
    expect(container.textContent).toContain('#0a0a0a');
    expect(container.textContent).toContain('x48');
    expect(container.textContent).toContain('Text, Border');
    expect(container.textContent).toContain('accent (inferred)');
  });

  it('offers a role chip per role the scan actually recorded', async () => {
    const container = await render(<PaletteView colors={colors} tabId={1} />);
    const group = container.querySelector('[aria-label="Filter the palette by role"]');
    const labels = [...(group?.querySelectorAll('button') ?? [])].map(node => node.textContent);

    expect(labels).toEqual(['All', 'Text', 'Background', 'Border']);
    expect(chip(container, 'All')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toContain('Gradient');
  });

  it('filters the view when a role chip is pressed', async () => {
    const container = await render(<PaletteView colors={colors} tabId={1} />);

    await act(async () => {
      chip(container, 'Background')?.click();
    });

    expect(chip(container, 'Background')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('1 swatch from 1 measured value');
    expect(container.textContent).toContain('#e11d48');
    expect(container.textContent).not.toContain('#0a0a0a');
    expect(container.textContent).toContain('Show all 1 occurrence');
  });

  it('expands a cluster into its members with per-role counts', async () => {
    const container = await render(<PaletteView colors={colors} tabId={1} />);
    const row = buttons(container).find(button => button.textContent?.includes('#0a0a0a'));
    expect(row?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      row?.click();
    });

    expect(container.textContent).toContain('2 measured values read as this swatch');
    expect(container.textContent).toContain('Text x42, Border x6');
    expect(container.textContent).toContain('#0b0b0c');
  });

  it('highlights a member on the page from inside an expanded cluster', async () => {
    const container = await render(<PaletteView colors={colors} tabId={1} />);
    await act(async () => {
      buttons(container).find(button => button.textContent?.includes('#0a0a0a'))?.click();
    });
    await act(async () => {
      buttons(container).find(button => button.textContent === 'Show on page')?.click();
    });

    expect(sent[0]).toEqual({ type: 'element.highlight', tabId: 1, locators: ['#text'] });
  });

  it('keeps every measured occurrence behind a disclosure that is closed by default', async () => {
    const container = await render(<PaletteView colors={colors} tabId={1} />);
    const disclosure = [...container.querySelectorAll('details')].find(details =>
      details.textContent?.includes('Show all 4 occurrences'),
    );

    expect(disclosure).toBeDefined();
    expect(disclosure?.open).toBe(false);
    // Closed, but still rendered: the exact values are never thrown away.
    expect(disclosure?.textContent).toContain('#0b0b0c');
  });

  it('says so plainly when a scan recorded no colors', async () => {
    const container = await render(<PaletteView colors={[]} tabId={1} />);
    expect(container.textContent).toContain('No colors in this role.');
    expect(container.textContent).not.toContain('Show all');
  });
});

describe('PaletteView with stored clusters (F11)', () => {
  it('uses the summary clusters as they are when no role is filtered', async () => {
    // A stored answer that could not have been computed from `colors`, so the
    // test can tell which one the view used.
    const stored = clusterPalette(colors).slice(0, 1);
    const container = await render(
      <PaletteView colors={colors} tabId={1} clusters={stored} />,
    );
    expect(container.textContent).toContain('1 swatch from 4 measured values');
    expect(container.querySelectorAll('li[class*="bg-surface-2"]').length).toBeGreaterThan(0);
  });

  it('recomputes as soon as a role filter is on', async () => {
    const stored = clusterPalette(colors).slice(0, 1);
    const container = await render(
      <PaletteView colors={colors} tabId={1} clusters={stored} />,
    );
    await act(async () => {
      chip(container, 'Background')?.click();
    });
    // Filtered to one background value, which the stored clusters do not
    // describe, so the view clustered the filtered list itself.
    expect(container.textContent).toContain('1 swatch from 1 measured value');
    expect(container.textContent).toContain('#e11d48');
  });

  it('recomputes when the summary carries no clusters at all', async () => {
    const container = await render(<PaletteView colors={colors} tabId={1} />);
    expect(container.textContent).toContain('3 swatches from 4 measured values');
  });
});
