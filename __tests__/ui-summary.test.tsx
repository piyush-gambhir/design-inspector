import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AssetReading, PageSummary } from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';
import { AssetsTab } from '@/lib/ui/sidepanel/AssetsTab';
import { ExampleControls, MAX_HIGHLIGHTS } from '@/lib/ui/sidepanel/ExampleControls';
import { SECTION_IDS, SummaryTab } from '@/lib/ui/sidepanel/SummaryTab';

vi.mock('@/lib/exports', () => ({
  summaryToMarkdown: () => {
    throw new Error('summary-adapter unavailable');
  },
  toJsonEnvelope: () => {
    throw new Error('json-adapter unavailable');
  },
}));

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

function example(locator: string, label: string) {
  return { locator, label };
}

const summary: PageSummary = {
  id: 'summary-1',
  schemaVersion: SCHEMA_VERSION,
  source: {
    url: 'https://example.com/pricing',
    title: 'Pricing',
    capturedAt: '2026-09-18T10:00:00.000Z',
    viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
    rootFontSize: 16,
    scrollX: 0,
    scrollY: 0,
  },
  scope: {
    eligibleElements: 2400,
    scannedElements: 2000,
    capped: true,
    cap: 2000,
    durationMs: 1480.6,
    skipped: [{ reason: 'hidden', count: 380 }],
    inaccessibleFrames: 1,
    openShadowRoots: 2,
    notes: ['One cross-origin frame was not readable.'],
  },
  typography: [
    {
      key: 'inter-600-72',
      familyReading: 'Inter Display',
      familyConfidence: 'matched',
      weight: 600,
      style: 'normal',
      sizePx: 72,
      lineHeightRaw: '75.6px',
      letterSpacingRaw: '-1.44px',
      count: 3,
      sample: 'Pricing that scales',
      examples: [example('h1', 'h1'), example('h2.card', 'h2.card')],
    },
  ],
  sizeScale: [
    { sizePx: 72, count: 3 },
    { sizePx: 16, count: 210 },
  ],
  colors: [
    {
      role: 'text',
      color: {
        raw: 'rgb(10, 10, 10)',
        hex: '#0A0A0A',
        rgb: 'rgb(10, 10, 10)',
        oklch: 'oklch(0.18 0 0)',
        alpha: 1,
        lossy: false,
      },
      key: 'rgb(10,10,10)',
      count: 210,
      inferredRole: 'neutral',
      examples: [example('h1', 'h1')],
    },
    {
      role: 'background',
      color: {
        raw: 'rgba(37, 99, 235, 0.12)',
        hex: '#2563EB1F',
        rgb: 'rgba(37, 99, 235, 0.12)',
        oklch: null,
        alpha: 0.12,
        lossy: true,
      },
      key: 'rgba(37,99,235,0.12)',
      count: 8,
      inferredRole: 'accent',
      examples: [example('.badge', '.badge')],
    },
  ],
  spacing: {
    padding: [
      { valuePx: 24, count: 96, examples: [example('.card', '.card')] },
      { valuePx: 0, count: 300, examples: [example('body', 'body')] },
    ],
    margin: [{ valuePx: -8, count: 2, examples: [example('.pull', '.pull')] }],
    gap: [{ valuePx: 16, count: 40, examples: [example('.row', '.row')] }],
  },
  fonts: [
    {
      family: 'Inter Display',
      declared: true,
      loaded: true,
      matchedToContent: true,
      source: {
        kind: 'self-hosted',
        url: 'https://example.com/fonts/inter-display.woff2',
        format: 'woff2',
        subset: true,
        note: 'Discovered from an @font-face src descriptor.',
      },
      weights: ['400', '600'],
      faces: [
        {
          family: 'Inter Display',
          weight: '600',
          style: 'normal',
          urls: ['https://example.com/fonts/inter-display.woff2'],
          format: 'woff2',
          unicodeRange: null,
          status: 'loaded',
        },
      ],
    },
    {
      family: 'Georgia',
      declared: false,
      loaded: null,
      matchedToContent: true,
      source: { kind: 'system', url: null, format: null, subset: null },
      weights: [],
      faces: [],
    },
  ],
  radii: [{ value: '8px 8px 0 0', count: 12, examples: [example('.tab', '.tab')] }],
  shadows: [
    { value: '0 1px 2px rgba(0,0,0,0.08)', count: 30, examples: [example('.card', '.card')] },
  ],
  stack: {
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
    ],
    hints: [],
    scope: 'page',
    observedAt: '2026-09-18T10:00:00.000Z',
  },
  limitations: ['Only the current viewport was measured.'],
};

const assets: AssetReading[] = [
  {
    kind: 'img',
    url: 'https://cdn.example.com/hero.png',
    candidates: [
      { url: 'https://cdn.example.com/hero.png', descriptor: '1x' },
      { url: 'https://cdn.example.com/hero@2x.png', descriptor: '2x' },
    ],
    renderedWidth: 640,
    renderedHeight: 360,
    intrinsicWidth: 1280,
    intrinsicHeight: 720,
    fileSize: 204800,
    mimeType: 'image/png',
    svgMarkup: null,
    alt: 'Product hero',
    usageCount: 4,
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
    svgMarkup: '<svg xmlns="http://www.w3.org/2000/svg"><title>Icon</title></svg>',
    alt: null,
    limitations: ['Not loaded yet'],
  },
];

beforeEach(() => {
  sent = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test',
      getManifest: () => ({ version: '0.1.0' }),
      sendMessage: vi.fn(async (message: unknown) => {
        sent.push(message);
        return { ok: true, downloadId: 1 };
      }),
      onMessage: { addListener: () => undefined, removeListener: () => undefined },
    },
  };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('SummaryTab', () => {
  it('renders the PRD section order', async () => {
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
    const headings = [...container.querySelectorAll('h3')].map(node => node.textContent);
    expect(headings).toEqual([
      'Scope',
      'Type scale',
      'Typography combinations',
      'Palette',
      'Spacing',
      'Radii',
      'Shadows',
      'Fonts',
      'Stack',
    ]);
  });

  it('states the scan scope and the cap it hit', async () => {
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
    expect(container.textContent).toContain('1440 x 900 at 2x');
    expect(container.textContent).toContain('2000 scanned of 2400 eligible');
    expect(container.textContent).toContain('Reached the 2000 element cap');
    expect(container.textContent).toContain('1481 ms');
  });

  it('caps the display size of a type sample but reports the measured size', async () => {
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
    const sample = container.querySelector<HTMLElement>('.type-sample');
    expect(sample?.style.fontSize).toBe('28px');
    expect(sample?.textContent).toBe('Pricing that scales');
    expect(container.textContent).toContain('72 px / 4.5 rem');
    expect(container.textContent).toContain('Matched');
  });

  it('labels an inferred accent and keeps the raw color value', async () => {
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
    expect(container.textContent).toContain('accent (inferred)');
    expect(container.textContent).toContain('raw rgba(37, 99, 235, 0.12)');
    expect(container.textContent).toContain('alpha 0.12');
  });

  it('keeps zero and negative spacing out of the default view', async () => {
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
    const collapsed = [...container.querySelectorAll('details')].filter(details =>
      details.textContent?.includes('Show zero and negative'),
    );
    expect(collapsed.length).toBeGreaterThan(0);
    expect(collapsed.every(details => !details.open)).toBe(true);
  });

  it('offers a download only for a self-hosted font file', async () => {
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
    const downloads = [...container.querySelectorAll('button')].filter(
      button => button.textContent === 'Download font file',
    );
    expect(downloads).toHaveLength(1);
    await act(async () => {
      downloads[0]?.click();
    });
    expect(sent).toEqual([
      {
        type: 'download.url',
        url: 'https://example.com/fonts/inter-display.woff2',
        filename: 'Inter Display.woff2',
      },
    ]);
  });

  it('highlights a group and then steps through its examples', async () => {
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
    const show = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Show on page',
    );
    await act(async () => {
      show?.click();
    });
    expect(sent[0]).toEqual({
      type: 'element.highlight',
      tabId: 1,
      locators: ['h1', 'h2.card'],
    });
    const next = [...container.querySelectorAll('button')].find(
      button => button.getAttribute('aria-label') === 'Next example',
    );
    await act(async () => {
      next?.click();
    });
    expect(sent[1]).toEqual({ type: 'element.highlight', tabId: 1, locators: ['h2.card'] });
  });

  it('sends a save with the page title and no screenshot', async () => {
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
    const save = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Save summary',
    );
    await act(async () => {
      save?.click();
    });
    expect(sent[0]).toMatchObject({
      type: 'reference.save',
      title: 'Pricing summary',
      note: '',
      captureScreenshot: false,
    });
  });

  it('shows a missing export adapter instead of failing silently', async () => {
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
    const copy = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Copy Markdown',
    );
    await act(async () => {
      copy?.click();
    });
    expect(container.textContent).toContain('Markdown export is unavailable');
  });

  it('shows the stale banner and the scan progress bar', async () => {
    const staleContainer = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale
        onScan={() => undefined}
      />,
    );
    expect(staleContainer.textContent).toContain('Page changed. Refresh for a current reading.');

    const loadingContainer = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={null}
        loading
        error={null}
        progress={{ scanned: 500, total: 2000 }}
        stale={false}
        onScan={() => undefined}
      />,
    );
    expect(loadingContainer.textContent).toContain('Scanning 500 of 2000 elements.');
    expect(
      loadingContainer.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
    ).toBe('25');
  });

  it('offers a Cancel button beside the progress bar while scanning', async () => {
    let cancelled = 0;
    const container = await render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={null}
        loading
        error={null}
        progress={{ scanned: 500, total: 2000 }}
        stale={false}
        onScan={() => undefined}
        onCancel={() => {
          cancelled += 1;
        }}
      />,
    );
    const cancel = [...container.querySelectorAll('button')].find(
      node => node.textContent === 'Cancel',
    );
    expect(cancel).toBeDefined();
    await act(async () => {
      cancel?.click();
    });
    expect(cancelled).toBe(1);
  });
});

describe('SummaryTab filter', () => {
  /** React tracks its own value, so the change has to go through the prototype setter. */
  function type(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 150));
    });
  }

  async function renderTab(): Promise<HTMLDivElement> {
    return render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
  }

  it('offers a keyboard reachable filter input and shows everything until it is used', async () => {
    const container = await renderTab();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]');

    expect(input).not.toBeNull();
    expect(input?.getAttribute('aria-label')).toBe('Filter the summary');
    expect(input?.getAttribute('placeholder')).toBe('Filter values, families, colors');
    expect(container.textContent).not.toContain('shown');
    expect(container.textContent).not.toContain('No matches in');
  });

  it('filters the sections, counts what is shown, and collapses the rest', async () => {
    const container = await renderTab();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;

    await act(async () => {
      type(input, 'georgia');
    });
    await settle();

    expect(container.textContent).toContain('1 of 14 shown');
    expect(container.textContent).toContain('Georgia');
    expect(container.textContent).toContain('No matches in Typography combinations');
    expect(container.textContent).toContain('No matches in Palette');
    expect(container.textContent).toContain('No matches in Spacing');
    expect(container.textContent).toContain('No matches in Radii');
    expect(container.textContent).toContain('No matches in Shadows');
    expect(container.textContent).toContain('No matches in Stack');
  });

  it('clears the filter on Escape', async () => {
    const container = await renderTab();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;

    await act(async () => {
      type(input, 'georgia');
    });
    await settle();
    expect(container.textContent).toContain('No matches in Palette');

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();

    expect(input.value).toBe('');
    expect(container.textContent).not.toContain('No matches in');
    expect(container.textContent).not.toContain('shown');
  });
});

describe('AssetsTab', () => {
  it('renders each asset with its dimensions, size, and limitations', async () => {
    const container = await render(
      <AssetsTab tabId={1} assets={assets} loading={false} error={null} onList={() => undefined} />,
    );
    expect(container.textContent).toContain('640 x 360 px');
    expect(container.textContent).toContain('1280 x 720 px');
    expect(container.textContent).toContain('200.0 KB');
    expect(container.textContent).toContain('image/png');
    expect(container.textContent).toContain('Not loaded yet');
    expect(container.textContent).toContain('2 candidates');
  });

  it('shows a repeat reference as a neutral detail, not a caveat', async () => {
    const container = await render(
      <AssetsTab tabId={1} assets={assets} loading={false} error={null} onList={() => undefined} />,
    );
    const usage = [...container.querySelectorAll('div')].find(
      node => node.textContent?.startsWith('Usage'),
    );
    expect(usage?.textContent).toContain('Used 4 times');
    // It is a detail row, not one of the caveat list items.
    const caveats = [...container.querySelectorAll('ul.mt-1 li')].map(node => node.textContent);
    expect(caveats).not.toContain('Used 4 times');
  });

  it('offers file details as a separate request and says what it costs', async () => {
    let enriched = 0;
    const container = await render(
      <AssetsTab
        tabId={1}
        assets={assets}
        loading={false}
        error={null}
        onList={() => undefined}
        onEnrich={() => {
          enriched += 1;
        }}
      />,
    );
    expect(container.textContent).toContain("contacts each asset's host");
    const button = [...container.querySelectorAll('button')].find(
      node => node.textContent === 'Fetch file details',
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
    expect(enriched).toBe(1);
  });

  it('has no fetch button when the surface does not offer enrichment', async () => {
    const container = await render(
      <AssetsTab tabId={1} assets={assets} loading={false} error={null} onList={() => undefined} />,
    );
    expect(container.textContent).not.toContain('Fetch file details');
  });

  it('shows Unknown rather than zero for an unknown size', async () => {
    const container = await render(
      <AssetsTab tabId={1} assets={assets} loading={false} error={null} onList={() => undefined} />,
    );
    expect(container.textContent).toContain('Unknown');
    expect(container.textContent).not.toContain('0 B');
  });

  it('previews inline SVG through a data URL and never raw markup', async () => {
    const container = await render(
      <AssetsTab tabId={1} assets={assets} loading={false} error={null} onList={() => undefined} />,
    );
    const sources = [...container.querySelectorAll('img')].map(image => image.getAttribute('src'));
    expect(sources.some(source => source?.startsWith('data:image/svg+xml'))).toBe(true);
    // The page's own markup is never parsed into this document, only encoded
    // into an <img src>. The only live SVG nodes are our own icons.
    expect(container.querySelector('svg > title')).toBeNull();
    expect(container.innerHTML).not.toContain('<title>Icon</title>');
  });

  it('downloads a URL asset by its filename and inline SVG as data', async () => {
    const container = await render(
      <AssetsTab tabId={1} assets={assets} loading={false} error={null} onList={() => undefined} />,
    );
    const buttons = [...container.querySelectorAll('button')].filter(
      button => button.textContent === 'Download',
    );
    await act(async () => {
      buttons[0]?.click();
    });
    await act(async () => {
      buttons[1]?.click();
    });
    expect(sent[0]).toEqual({
      type: 'download.url',
      url: 'https://cdn.example.com/hero.png',
      filename: 'hero.png',
    });
    expect(sent[1]).toMatchObject({ type: 'download.data', filename: 'inline-asset.svg' });
  });
});

describe('SummaryTab traceability (SUM-06)', () => {
  async function renderTab(): Promise<HTMLDivElement> {
    return render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
  }

  it('folds typography combinations under a collapsible step per size', async () => {
    const container = await renderTab();
    const steps = [...container.querySelectorAll('details')].filter(details =>
      details.querySelector('summary')?.textContent?.includes('combination'),
    );

    expect(steps).toHaveLength(1);
    expect(steps[0]?.querySelector('summary')?.textContent).toContain('72 px');
    expect(steps[0]?.querySelector('summary')?.textContent).toContain('1 combination');
    expect(steps[0]?.querySelector('summary')?.textContent).toContain('x3');
    // A scale this short is not worth a second click.
    expect(steps[0]?.open).toBe(true);
  });

  it('keeps the example controls out of the way until the row is hovered or focused', async () => {
    const container = await renderTab();
    const show = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Show on page',
    );
    const row = show?.closest('div');

    expect(row?.className).toContain('opacity-0');
    // The group is named, so an open section's own `group` cannot reveal every
    // row at once.
    expect(row?.className).toContain('group-hover/row:opacity-100');
    // Still in the DOM and still reachable: focus inside the row reveals it.
    expect(row?.className).toContain('group-focus-within/row:opacity-100');
    expect(row?.closest('li')?.className).toContain('group/row');
    expect(show?.hasAttribute('hidden')).toBe(false);
  });

  it('offers an explicit scroll after an offscreen element refuses to select', async () => {
    const chrome = (globalThis as unknown as {
      chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } };
    }).chrome;
    chrome.runtime.sendMessage = vi.fn(async (message: unknown) => {
      sent.push(message);
      const request = message as { type: string; scroll?: boolean };
      if (request.type !== 'element.select') return { ok: true };
      return request.scroll
        ? { ok: true }
        : { ok: false, error: 'Element is offscreen' };
    });

    const container = await renderTab();
    const select = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'h1',
    );
    await act(async () => {
      select?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Scroll to the element on the page and try again.');
    const scroll = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Scroll to it and select',
    );
    expect(scroll).toBeDefined();

    await act(async () => {
      scroll?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(sent.at(-1)).toEqual({
      type: 'element.select',
      tabId: 1,
      locator: 'h1',
      scroll: true,
    });
    expect(container.textContent).toContain('Pinned on the page.');
    expect(container.textContent).not.toContain('Scroll to it and select');
  });

  it('clusters the palette and filters it by role chip', async () => {
    const container = await renderTab();

    const chips = container.querySelector('[aria-label="Filter the palette by role"]');
    const labels = [...(chips?.querySelectorAll('button') ?? [])].map(node => node.textContent);
    expect(labels).toEqual(['All', 'Text', 'Background']);

    const background = [...(chips?.querySelectorAll('button') ?? [])].find(
      node => node.textContent === 'Background',
    );
    await act(async () => {
      background?.click();
    });

    expect(container.textContent).toContain('#2563EB1F');
    expect(container.textContent).not.toContain('#0A0A0A');
  });

  it('keeps every occurrence behind a disclosure under the clustered palette', async () => {
    const container = await renderTab();
    const disclosure = [...container.querySelectorAll('details')].find(details =>
      details.textContent?.includes('Show all 2 occurrences'),
    );
    expect(disclosure).toBeDefined();
    expect(disclosure?.open).toBe(false);
  });
});

describe('SummaryTab keyboard navigation (UX note 3)', () => {
  async function renderTab(): Promise<HTMLDivElement> {
    return render(
      <SummaryTab
        tabId={1}
        pageTitle="Pricing"
        summary={summary}
        loading={false}
        error={null}
        progress={null}
        stale={false}
        onScan={() => undefined}
      />,
    );
  }

  it('offers a Jump to link for every section, each pointing at a real region', async () => {
    const container = await renderTab();
    const links = [...container.querySelectorAll('a[data-role="jump-link"]')] as HTMLAnchorElement[];
    expect(links.map(link => link.textContent)).toEqual([
      'Type scale',
      'Typography',
      'Palette',
      'Spacing',
      'Radii',
      'Shadows',
      'Fonts',
      'Stack',
    ]);

    for (const link of links) {
      const id = link.getAttribute('href')?.slice(1) ?? '';
      const section = container.querySelector(`#${id}`) as HTMLElement | null;
      expect(section, id).not.toBeNull();
      // A landmark a keyboard can actually land on.
      expect(section?.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('focuses the section the link names, so the swatches can be skipped', async () => {
    const container = await renderTab();
    const link = container.querySelector(
      `a[href="#${SECTION_IDS.spacing}"]`,
    ) as HTMLAnchorElement;
    const section = container.querySelector(`#${SECTION_IDS.spacing}`) as HTMLElement;
    section.scrollIntoView = () => undefined;

    await act(async () => {
      link.click();
    });
    expect(document.activeElement).toBe(section);
  });
});

describe('ExampleControls at the aggregate cap (F7)', () => {
  it('says how many of the group it is showing once there are more than 20', async () => {
    const examples = Array.from({ length: 24 }, (_unused, index) =>
      example(`p:nth-of-type(${index})`, `p ${index}`),
    );
    const container = await render(<ExampleControls examples={examples} tabId={1} />);
    const show = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Show on page',
    ) as HTMLButtonElement;

    await act(async () => {
      show.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Showing the first 20 of 24 examples.');
    const request = sent.at(-1) as { locators: string[] };
    expect(request.locators).toHaveLength(MAX_HIGHLIGHTS);
  });

  it('says nothing about a cap for a group that fits under it', async () => {
    const examples = Array.from({ length: 5 }, (_unused, index) =>
      example(`p:nth-of-type(${index})`, `p ${index}`),
    );
    const container = await render(<ExampleControls examples={examples} tabId={1} />);
    const show = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Show on page',
    ) as HTMLButtonElement;

    await act(async () => {
      show.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('Showing the first');
  });
});
