import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { PageSummary, SavedReference } from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';
import { parseColor } from '@/lib/readings/color';
import { CompareView } from '@/lib/ui/sidepanel/CompareView';
import {
  compareCounts,
  comparePalettes,
  compareSummaries,
  comparisonToMarkdown,
  familyEntries,
  typeScaleEntries,
} from '@/lib/ui/sidepanel/compare';
import { pageSummary } from './fixtures/summary';

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

/** The fixture summary at a given viewport width, as a second capture. */
function summaryAt(width: number, overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    ...pageSummary,
    source: {
      ...pageSummary.source,
      viewport: { width, height: 900, devicePixelRatio: 2 },
    },
    ...overrides,
  };
}

function reference(id: string, summary: PageSummary, title: string): SavedReference {
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    kind: 'summary',
    title,
    note: '',
    createdAt: '2026-09-18T10:32:00.000Z',
    updatedAt: '2026-09-18T10:32:00.000Z',
    snapshot: summary,
    screenshotId: null,
    screenshotIsCrop: null,
  };
}

function colorGroup(hex: string, role: 'text' | 'background', count: number) {
  const color = parseColor(hex);
  return {
    role,
    color,
    key: (color.hex ?? color.raw).toLowerCase(),
    count,
    inferredRole: null,
    examples: [],
  };
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.();
});

describe('compareCounts', () => {
  it('pairs by key and says which side each row came from', () => {
    const rows = compareCounts(
      [
        { key: '16', label: '16 px', count: 40 },
        { key: '72', label: '72 px', count: 1 },
      ],
      [
        { key: '16', label: '16 px', count: 30 },
        { key: '32', label: '32 px', count: 4 },
      ],
    );

    expect(rows.map(row => [row.label, row.a, row.b, row.side])).toEqual([
      ['16 px', 40, 30, 'both'],
      ['32 px', null, 4, 'b'],
      ['72 px', 1, null, 'a'],
    ]);
  });

  it('separates absent from zero', () => {
    const rows = compareCounts([{ key: 'x', label: 'x', count: 0 }], []);
    expect(rows[0]?.a).toBe(0);
    expect(rows[0]?.b).toBeNull();
    expect(rows[0]?.side).toBe('a');
  });

  it('ranks rows with the supplied order and breaks ties on the label', () => {
    const rows = compareCounts(
      [
        { key: '16', label: '16 px', count: 40 },
        { key: '72', label: '72 px', count: 1 },
      ],
      [],
      row => Number.parseFloat(row.key),
    );
    expect(rows.map(row => row.key)).toEqual(['72', '16']);
  });

  it('reads the type scale and the families out of a summary', () => {
    expect(typeScaleEntries(pageSummary).map(entry => entry.label)).toEqual(['72 px', '16 px']);
    const families = familyEntries(pageSummary);
    expect(families.map(entry => [entry.label, entry.count])).toEqual([
      ['Inter Display', 1],
      ['Inter', 42],
    ]);
  });
});

describe('comparePalettes', () => {
  it('matches clusters across two summaries by oklch distance', () => {
    const rows = comparePalettes(
      [colorGroup('#4f46e5', 'text', 9), colorGroup('#0a0a0a', 'text', 40)],
      [colorGroup('#5248e8', 'text', 4), colorGroup('#e11d48', 'background', 2)],
    );

    const indigo = rows.find(row => row.label === '#4f46e5');
    expect(indigo?.side).toBe('both');
    expect(indigo?.b?.representative.color.hex).toBe('#5248e8');

    expect(rows.find(row => row.label === '#0a0a0a')?.side).toBe('a');
    expect(rows.find(row => row.label === '#e11d48')?.side).toBe('b');
  });

  it('never claims one cluster as the match for two rows', () => {
    const rows = comparePalettes(
      [colorGroup('#4f46e5', 'text', 9), colorGroup('#5248e8', 'background', 8)],
      [colorGroup('#4f46e5', 'text', 3)],
    );
    // Both A entries cluster together, so exactly one row is a pair.
    expect(rows.filter(row => row.side === 'both')).toHaveLength(1);
  });
});

describe('comparisonToMarkdown', () => {
  it('states both sources, times and viewports, then one table per section', () => {
    const markdown = comparisonToMarkdown(summaryAt(1440), summaryAt(390), { a: 'A', b: 'B' });

    expect(markdown).toContain('# Comparison: A and B');
    expect(markdown).toContain('| Viewport | 1440 x 900 CSS px | 390 x 900 CSS px |');
    expect(markdown).toContain('| Captured | 2026-09-18T10:30:00.000Z | 2026-09-18T10:30:00.000Z |');
    for (const section of [
      '## Type scale',
      '## Palette',
      '## Font families',
      '## Padding',
      '## Margin',
      '## Gap',
      '## Radii',
      '## Shadows',
      '## Stack',
    ]) {
      expect(markdown).toContain(section);
    }
    expect(markdown).toContain('| 72 px | 1 | 1 | Both |');
    expect(markdown).toContain(
      'Counts are element and property occurrences, not visual area.',
    );
  });

  it('marks a value that only one side recorded', () => {
    const narrow = summaryAt(390, { sizeScale: [{ sizePx: 16, count: 42 }] });
    const markdown = comparisonToMarkdown(summaryAt(1440), narrow, { a: 'A', b: 'B' });
    expect(markdown).toContain('| 72 px | 1 | - | A only |');
  });

  it('escapes a pipe so a shadow value cannot break the table', () => {
    const odd = summaryAt(390, {
      shadows: [{ value: '0 1px 2px rgba(0,0,0,0.1) | inset', count: 1, examples: [] }],
    });
    expect(comparisonToMarkdown(summaryAt(1440), odd, { a: 'A', b: 'B' })).toContain('\\|');
  });
});

describe('compareSummaries', () => {
  it('keeps the section order the view renders', () => {
    expect(compareSummaries(pageSummary, pageSummary).sections.map(section => section.title)).toEqual([
      'Type scale',
      'Font families',
      'Padding',
      'Margin',
      'Gap',
      'Radii',
      'Shadows',
      'Stack',
    ]);
  });
});

describe('CompareView', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });

  it('heads the comparison with both sources, capture times and viewports', async () => {
    const container = await render(
      <CompareView
        a={reference('a', summaryAt(1440), 'Desktop capture')}
        b={reference('b', summaryAt(390), 'Mobile capture')}
        onClose={() => undefined}
      />,
    );

    expect(container.textContent).toContain('Desktop capture');
    expect(container.textContent).toContain('Mobile capture');
    expect(container.textContent).toContain('1440 x 900 CSS px');
    expect(container.textContent).toContain('390 x 900 CSS px');
    expect(container.textContent).toContain('https://example.com/');
    // The local, readable stamp, not the ISO string: that one is for exports.
    expect(container.textContent).toMatch(/Captured \d{1,2} \w{3} 2026, \d{2}:\d{2}/);
    // The same URL twice is the responsive case, and the view says so.
    expect(container.textContent).toContain('The same URL at two captures');
  });

  it('renders every section, with a dash where a side recorded nothing', async () => {
    const narrow = summaryAt(390, { radii: [] });
    const container = await render(
      <CompareView
        a={reference('a', summaryAt(1440), 'Desktop')}
        b={reference('b', narrow, 'Mobile')}
        onClose={() => undefined}
      />,
    );

    const headings = [...container.querySelectorAll('h4')].map(node => node.textContent);
    expect(headings).toEqual([
      'Type scale',
      'Palette',
      'Font families',
      'Padding',
      'Margin',
      'Gap',
      'Radii',
      'Shadows',
      'Stack',
    ]);
    expect(container.textContent).toContain('A only');
  });

  it('copies the comparison as Markdown and confirms it', async () => {
    const container = await render(
      <CompareView
        a={reference('a', summaryAt(1440), 'Desktop')}
        b={reference('b', summaryAt(390), 'Mobile')}
        onClose={() => undefined}
      />,
    );
    const copy = [...container.querySelectorAll('button')].find(
      button => button.textContent === 'Copy as Markdown',
    );
    await act(async () => {
      copy?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const written = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] ?? '';
    expect(written).toContain('| Viewport | 1440 x 900 CSS px | 390 x 900 CSS px |');
    expect(container.textContent).toContain('Comparison copied as Markdown.');
  });

  it('closes on request', async () => {
    let closed = 0;
    const container = await render(
      <CompareView
        a={reference('a', summaryAt(1440), 'Desktop')}
        b={reference('b', summaryAt(390), 'Mobile')}
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    const close = [...container.querySelectorAll('button')].find(
      button => button.getAttribute('aria-label') === 'Close the comparison',
    );
    await act(async () => {
      close?.click();
    });
    expect(closed).toBe(1);
  });
});
