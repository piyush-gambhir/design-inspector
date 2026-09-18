import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ElementSnapshot, PageSummary, SavedElementReference, SavedReference } from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';

const fakeIdb = vi.hoisted(() => {
  const screenshots = new Map<string, Blob>();
  return {
    screenshots,
    db: {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => ({ createIndex: () => undefined }),
      get: async (name: string, key: string) =>
        name === 'screenshots' ? screenshots.get(key) : undefined,
      getAll: async () => [],
      put: async () => undefined,
      delete: async () => undefined,
      clear: async () => undefined,
    },
  };
});

vi.mock('idb', () => ({
  openDB: async () => fakeIdb.db,
}));

// The export adapters belong to another workstream. Stubbing them keeps this a
// test of the panel's wiring and its failure surface, not of their output.
vi.mock('../lib/ui/sidepanel/exports', async () => {
  const actual = await vi.importActual<typeof import('../lib/ui/sidepanel/exports')>(
    '../lib/ui/sidepanel/exports',
  );
  return {
    ...actual,
    downloadBundle: async () => ({
      ok: false as const,
      error: 'The bundle could not be built. buildReferenceBundle not implemented',
    }),
  };
});

vi.mock('@/lib/exports', () => ({
  // Workstream P owns the bundle adapter; until it lands it throws, and the
  // Saved tab has to say so rather than appear to have started a download.
  buildReferenceBundle: async () => {
    throw new Error('buildReferenceBundle not implemented');
  },
  referenceToMarkdown: () => {
    throw new Error('reference-adapter unavailable');
  },
  summaryToMarkdown: () => {
    throw new Error('summary-adapter unavailable');
  },
  toJsonEnvelope: () => {
    throw new Error('json-adapter unavailable');
  },
  toTasteLedger: () => {
    throw new Error('ledger-adapter unavailable');
  },
}));

const { SavedTab, groupByHost, hostnameOf, markdownFor, sortReferences } = await import(
  '@/lib/ui/sidepanel/SavedTab'
);
const { pageSummary } = await import('./fixtures/summary');

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

type ReferenceOverrides = Omit<Partial<SavedElementReference>, 'kind' | 'snapshot'> & {
  kind?: SavedReference['kind'];
  snapshot?: ElementSnapshot | PageSummary;
  url?: string;
};

function reference(overrides: ReferenceOverrides = {}): SavedReference {
  const id = overrides.id ?? 'ref-1';
  const url = (overrides as { url?: string }).url ?? 'https://example.com/pricing';
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    kind: 'element',
    title: `Reference ${id}`,
    note: '',
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
    screenshotId: null,
    screenshotIsCrop: null,
    ...overrides,
    snapshot: (overrides.snapshot ?? {
      id: `snap-${id}`,
      schemaVersion: SCHEMA_VERSION,
      source: {
        url,
        title: 'Pricing',
        capturedAt: '2026-09-18T10:00:00.000Z',
        viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
        rootFontSize: 16,
        scrollX: 0,
        scrollY: 0,
      },
      element: {
        tag: 'h1',
        id: null,
        classes: [],
        role: null,
        label: 'h1',
        textSample: null,
        locator: 'h1',
      },
    }) as SavedReference['snapshot'],
  } as SavedReference;
}

function snapshotAt(url: string) {
  return {
    id: 'snap',
    schemaVersion: SCHEMA_VERSION,
    source: {
      url,
      title: 'Page',
      capturedAt: '2026-09-18T10:00:00.000Z',
      viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
      rootFontSize: 16,
      scrollX: 0,
      scrollY: 0,
    },
  } as unknown as SavedReference['snapshot'];
}

beforeEach(() => {
  fakeIdb.screenshots.clear();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:fake-screenshot'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
});

describe('grouping helpers', () => {
  it('reads the hostname and survives a junk URL', () => {
    expect(hostnameOf('https://example.com/pricing')).toBe('example.com');
    expect(hostnameOf('not a url')).toBe('Unknown source');
  });

  it('groups by host and keeps the incoming order inside a group', () => {
    const groups = groupByHost([
      reference({ id: 'a', snapshot: snapshotAt('https://a.com/one') }),
      reference({ id: 'b', snapshot: snapshotAt('https://b.com/one') }),
      reference({ id: 'c', snapshot: snapshotAt('https://a.com/two') }),
    ]);
    expect(groups.map(group => group.host)).toEqual(['a.com', 'b.com']);
    expect(groups[0]?.references.map(entry => entry.id)).toEqual(['a', 'c']);
  });

  it('routes summaries and elements to different adapters', () => {
    expect(() => markdownFor(reference({ kind: 'element' }))).toThrow(/reference-adapter/);
    expect(() => markdownFor(reference({ kind: 'summary' }))).toThrow(/summary-adapter/);
  });
});

describe('SavedTab', () => {
  it('shows an empty state that explains only deliberate saves are stored', async () => {
    const container = await render(<SavedTab references={[]} onReload={() => undefined} />);
    expect(container.textContent).toContain('Nothing saved yet');
    expect(container.textContent).toContain('Only deliberate saves are stored');
  });

  it('renders references grouped by host with their captured context', async () => {
    const references = [
      reference({ id: 'a', title: 'Hero heading', note: 'Tight tracking.' }),
      reference({ id: 'b', kind: 'summary', snapshot: snapshotAt('https://other.test/home') }),
    ];
    const container = await render(
      <SavedTab references={references} onReload={() => undefined} />,
    );
    expect(container.textContent).toContain('example.com');
    expect(container.textContent).toContain('other.test');
    expect(container.textContent).toContain('1440 x 900');
    expect(container.textContent).toContain('Summary');
    expect(container.textContent).toContain('Element');

    // Newest first breaks its tie on id, exactly as the storage layer does, so
    // 'b' leads and the element reference is the second card.
    const titles = [...container.querySelectorAll<HTMLInputElement>(
      'input[aria-label="Reference title"]',
    )].map(input => input.value);
    expect(titles).toEqual(['Reference b', 'Hero heading']);
    const notes = [...container.querySelectorAll<HTMLTextAreaElement>(
      'textarea[aria-label="Why I saved this"]',
    )].map(box => box.value);
    expect(notes).toEqual(['', 'Tight tracking.']);
  });

  it('renders a screenshot thumbnail and labels a visible crop', async () => {
    fakeIdb.screenshots.set('shot-1', new Blob(['png']));
    const container = await render(
      <SavedTab
        references={[reference({ id: 'a', screenshotId: 'shot-1', screenshotIsCrop: true })]}
        onReload={() => undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('blob:fake-screenshot');
    expect(container.textContent).toContain('Visible crop');
  });

  it('revokes the screenshot object URL on unmount', async () => {
    fakeIdb.screenshots.set('shot-1', new Blob(['png']));
    await render(
      <SavedTab
        references={[reference({ id: 'a', screenshotId: 'shot-1', screenshotIsCrop: false })]}
        onReload={() => undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    mounted.pop()?.();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-screenshot');
  });

  it('asks before deleting', async () => {
    const container = await render(
      <SavedTab references={[reference({ id: 'a' })]} onReload={() => undefined} />,
    );
    const deleteButton = [...container.querySelectorAll('button')].find(button =>
      button.getAttribute('aria-label')?.startsWith('Delete '),
    );
    expect(deleteButton).toBeDefined();
    await act(async () => {
      deleteButton?.click();
    });
    expect(container.textContent).toContain('Delete this reference?');
  });

  it('refuses to export with nothing selected', async () => {
    const container = await render(
      <SavedTab references={[reference({ id: 'a' })]} onReload={() => undefined} />,
    );
    const copyMarkdown = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Copy Markdown',
    );
    await act(async () => {
      copyMarkdown?.click();
    });
    expect(container.textContent).toContain('Select at least one reference first.');
  });

  it('surfaces a missing export adapter instead of failing silently', async () => {
    const container = await render(
      <SavedTab references={[reference({ id: 'a' })]} onReload={() => undefined} />,
    );
    const selectAll = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Select all',
    );
    await act(async () => {
      selectAll?.click();
    });
    const copyMarkdown = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Copy Markdown',
    );
    await act(async () => {
      copyMarkdown?.click();
    });
    expect(container.textContent).toContain('Markdown export is unavailable');
  });

  // PRD 19.3 "storage full": the only copy of the research is local, so a full
  // disk has to name the cause and the two ways out, and the edit the user made
  // must stay in the field so it can be retried after clearing space.
  it('surfaces a storage quota failure on an inline edit with the way out', async () => {
    const saved = reference({ id: 'a', title: 'Hero heading' });
    const originalGet = fakeIdb.db.get;
    const originalPut = fakeIdb.db.put;
    fakeIdb.db.get = (async (name: string, key: string) =>
      name === 'references' && key === 'a' ? saved : originalGet(name, key)) as typeof originalGet;
    fakeIdb.db.put = (async () => {
      // What IndexedDB actually throws when the origin is over quota.
      const error = new Error('The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }) as typeof originalPut;

    try {
      const container = await render(<SavedTab references={[saved]} onReload={() => undefined} />);
      const title = container.querySelector<HTMLInputElement>(
        'input[aria-label="Reference title"]',
      );
      expect(title).toBeTruthy();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      await act(async () => {
        setter?.call(title, 'Hero heading, revised');
        title?.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // React maps onBlur onto the bubbling focusout event.
      await act(async () => {
        title?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.textContent).toContain('Local storage is full.');
      expect(container.textContent).toContain('Delete some saved references or clear the collection');
      expect(title?.value).toBe('Hero heading, revised');
    } finally {
      fakeIdb.db.get = originalGet;
      fakeIdb.db.put = originalPut;
    }
  });

  it('reports local storage usage as Unknown rather than zero', async () => {
    const container = await render(
      <SavedTab references={[reference({ id: 'a' })]} onReload={() => undefined} />,
    );
    expect(container.textContent).toContain('Local storage in use: Unknown');
  });
});

describe('sortReferences', () => {
  const at = (id: string, createdAt: string, url: string) =>
    reference({ id, createdAt, snapshot: snapshotAt(url) });

  const collection = [
    at('a', '2026-09-18T10:00:00.000Z', 'https://zeta.test/one'),
    at('b', '2026-09-18T12:00:00.000Z', 'https://alpha.test/one'),
    at('c', '2026-09-18T11:00:00.000Z', 'https://zeta.test/two'),
  ];

  it('orders newest first by default and oldest first on request', () => {
    expect(sortReferences(collection, 'newest').map(entry => entry.id)).toEqual(['b', 'c', 'a']);
    expect(sortReferences(collection, 'oldest').map(entry => entry.id)).toEqual(['a', 'c', 'b']);
  });

  it('orders by site, keeping each site newest first', () => {
    expect(sortReferences(collection, 'site').map(entry => entry.id)).toEqual(['b', 'c', 'a']);
    const hosts = sortReferences(collection, 'site').map(entry =>
      hostnameOf(entry.snapshot.source.url),
    );
    expect(hosts).toEqual(['alpha.test', 'zeta.test', 'zeta.test']);
  });

  it('never mutates the collection it was given', () => {
    const input = [...collection];
    sortReferences(input, 'oldest');
    expect(input.map(entry => entry.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('SavedTab selection and sorting', () => {
  const collection = [
    reference({ id: 'a', createdAt: '2026-09-18T10:00:00.000Z' }),
    reference({ id: 'b', createdAt: '2026-09-18T12:00:00.000Z' }),
    reference({ id: 'c', createdAt: '2026-09-18T11:00:00.000Z', snapshot: snapshotAt('https://other.test/home') }),
  ];

  it('re-orders the list from the sort control', async () => {
    const container = await render(<SavedTab references={collection} onReload={() => undefined} />);
    const sort = container.querySelector<HTMLSelectElement>('#saved-sort') as HTMLSelectElement;
    expect([...sort.options].map(option => option.textContent)).toEqual([
      'Newest first',
      'Oldest first',
      'By site',
    ]);

    const ids = () =>
      [...container.querySelectorAll<HTMLInputElement>('input[aria-label^="Select "]')].map(box =>
        box.getAttribute('aria-label'),
      );
    // Grouping is by host, so the sort decides the order of the groups and of
    // the cards inside them: b then a on example.com, then c on other.test.
    expect(ids()).toEqual(['Select Reference b', 'Select Reference a', 'Select Reference c']);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(sort, 'oldest');
      sort.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(ids()).toEqual(['Select Reference a', 'Select Reference b', 'Select Reference c']);
  });

  it('counts the references in a group and selects the whole group at once', async () => {
    const container = await render(<SavedTab references={collection} onReload={() => undefined} />);
    expect(container.textContent).toContain('2 references');
    expect(container.textContent).toContain('1 reference');

    const selectGroup = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Select group',
    );
    await act(async () => {
      selectGroup?.click();
    });
    expect(container.textContent).toContain('2 of 3 selected');

    const clearGroup = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Clear group',
    );
    await act(async () => {
      clearGroup?.click();
    });
    expect(container.textContent).toContain('0 of 3 selected');
  });

  it('explains how to save when the collection is empty', async () => {
    const container = await render(<SavedTab references={[]} onReload={() => undefined} />);
    expect(container.textContent).toContain('press Save reference');
    expect(container.textContent).toContain('press Save summary');
  });
});

describe('SavedTab bundle export', () => {
  it('names the reason when the bundle adapter is unavailable', async () => {
    const container = await render(
      <SavedTab references={[reference({ id: 'a' })]} onReload={() => undefined} />,
    );
    const selectAll = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Select all',
    );
    await act(async () => {
      selectAll?.click();
    });
    const bundle = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Export bundle (ZIP)',
    );
    expect(bundle).toBeDefined();
    await act(async () => {
      bundle?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Bundle export is unavailable:');
    expect(container.textContent).toContain('buildReferenceBundle not implemented');
  });

  it('refuses a bundle with nothing selected', async () => {
    const container = await render(
      <SavedTab references={[reference({ id: 'a' })]} onReload={() => undefined} />,
    );
    const bundle = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Export bundle (ZIP)',
    );
    await act(async () => {
      bundle?.click();
    });
    expect(container.textContent).toContain('Select at least one reference first.');
  });
});

describe('SavedTab compare', () => {
  function summaryReference(id: string, width: number, height: number): SavedReference {
    return reference({
      id,
      kind: 'summary',
      title: `Capture ${id}`,
      snapshot: {
        ...pageSummary,
        source: {
          ...pageSummary.source,
          viewport: { width, height, devicePixelRatio: 2 },
        },
      },
    });
  }

  it('stays disabled until exactly two summaries are selected', async () => {
    const references = [summaryReference('a', 1440, 900), reference({ id: 'b' })];
    const container = await render(<SavedTab references={references} onReload={() => undefined} />);
    const compare = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Compare',
    ) as HTMLButtonElement;
    expect(compare.disabled).toBe(true);

    const selectAll = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Select all',
    );
    await act(async () => {
      selectAll?.click();
    });
    // One summary and one element is still not a pair of summaries.
    expect(
      ([...container.querySelectorAll('button')].find(
        button => button.textContent === 'Compare',
      ) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('opens a comparison whose header carries both viewports', async () => {
    const references = [summaryReference('a', 1440, 900), summaryReference('b', 390, 844)];
    const container = await render(<SavedTab references={references} onReload={() => undefined} />);
    const selectAll = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Select all',
    );
    await act(async () => {
      selectAll?.click();
    });
    const compare = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Compare',
    );
    await act(async () => {
      compare?.click();
    });

    expect(container.textContent).toContain('Compare summaries');
    expect(container.textContent).toContain('1440 x 900 CSS px');
    expect(container.textContent).toContain('390 x 844 CSS px');

    const close = [...container.querySelectorAll('button')].find(
      button => button.getAttribute('aria-label') === 'Close the comparison',
    );
    await act(async () => {
      close?.click();
    });
    expect(container.textContent).not.toContain('Compare summaries');
  });
});
