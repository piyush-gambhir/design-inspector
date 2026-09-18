import { describe, expect, it } from 'vitest';
import type { ColorGroup, ElementScanRecord, FontRecord, TypographyGroup } from '@/lib/contracts';
import { parseColor } from '@/lib/readings/color';
import {
  aggregateSummary,
  clusterPalette,
  clusterRoleCounts,
  groupTypographyByScale,
} from '@/lib/readings/summary-aggregate';
import { color, corners, sides, source } from './fixtures/snapshots';
import { scanRecord, scope, stackReport, textRecord } from './fixtures/summary';

function run(records: ElementScanRecord[], fonts: FontRecord[] = []) {
  return aggregateSummary({ records, fonts, stack: stackReport, source, scope });
}

describe('aggregateSummary typography', () => {
  it('groups by the full typography key and sorts by size then count', () => {
    const summary = run([
      textRecord({ locator: 'h1', label: 'h1' }, { sizePx: 72, weight: 600 }),
      textRecord({ locator: 'p:nth-of-type(1)', label: 'p' }, { sizePx: 16 }),
      textRecord({ locator: 'p:nth-of-type(2)', label: 'p' }, { sizePx: 16 }),
      textRecord({ locator: 'em', label: 'em' }, { sizePx: 16, style: 'italic' }),
    ]);

    expect(summary.typography.map((group) => [group.sizePx, group.count])).toEqual([
      [72, 1],
      [16, 2],
      [16, 1],
    ]);
    expect(summary.typography[1]?.key).toBe('Inter|400|normal|16|24px|normal');
  });

  it('does not count an ancestor that has no text of its own', () => {
    const summary = run([
      scanRecord({ locator: 'section', label: 'section', hasOwnText: false }),
      textRecord({ locator: 'section > p', label: 'p' }),
    ]);

    expect(summary.typography).toHaveLength(1);
    expect(summary.typography[0]?.count).toBe(1);
    expect(summary.sizeScale).toEqual([{ sizePx: 16, count: 1 }]);
  });

  it('keeps the first non-empty sample, trimmed to 60 characters', () => {
    const long = 'A'.repeat(90);
    const summary = run([
      textRecord({ locator: 'p:nth-of-type(1)', label: 'p' }, { sample: '   ' }),
      textRecord({ locator: 'p:nth-of-type(2)', label: 'p' }, { sample: long }),
    ]);

    expect(summary.typography[0]?.sample).toBe('A'.repeat(60));
  });

  it('caps examples at twenty four per group, above the panel highlight cap', () => {
    const records = Array.from({ length: 40 }, (_unused, index) =>
      textRecord({ locator: `p:nth-of-type(${index})`, label: 'p' }),
    );
    // The panel highlights 20 at a time and says so, which it can only do when
    // a group is allowed to carry more than 20 (tester finding F7).
    expect(run(records).typography[0]?.examples).toHaveLength(24);
  });

  it('keeps every example when a group has fewer than the cap', () => {
    const records = Array.from({ length: 5 }, (_unused, index) =>
      textRecord({ locator: `p:nth-of-type(${index})`, label: 'p' }),
    );
    expect(run(records).typography[0]?.examples).toHaveLength(5);
  });

  it('rounds the compact size scale to two decimals and sorts it descending', () => {
    const summary = run([
      textRecord({ locator: 'a', label: 'a' }, { sizePx: 16.006 }),
      textRecord({ locator: 'b', label: 'b' }, { sizePx: 16.004 }),
      textRecord({ locator: 'c', label: 'c' }, { sizePx: 72 }),
    ]);

    expect(summary.sizeScale).toEqual([
      { sizePx: 72, count: 1 },
      { sizePx: 16.01, count: 1 },
      { sizePx: 16, count: 1 },
    ]);
  });
});

describe('aggregateSummary palette', () => {
  it('records every role and normalizes keys to hex, with alpha only below 1', () => {
    const summary = run([
      textRecord({ locator: 'p', label: 'p' }),
      scanRecord({
        locator: 'div',
        label: 'div',
        backgroundColor: color('rgba(255, 255, 255, 0.5)', { hex: '#ffffff', alpha: 0.5 }),
        borderColors: [color('rgb(228, 228, 231)', { hex: '#E4E4E7' })],
        fill: color('rgb(24, 24, 27)', { hex: '#18181b' }),
        stroke: color('rgb(113, 113, 122)', { hex: '#71717a' }),
      }),
    ]);

    const byRole = new Map(summary.colors.map((group) => [group.role, group.key]));
    expect(byRole.get('text')).toBe('#0a0a0a');
    expect(byRole.get('background')).toBe('#ffffff80');
    expect(byRole.get('border')).toBe('#e4e4e7');
    expect(byRole.get('fill')).toBe('#18181b');
    expect(byRole.get('stroke')).toBe('#71717a');
  });

  it('falls back to the collapsed raw serialization when there is no hex', () => {
    const summary = run([
      scanRecord({
        locator: 'div',
        label: 'div',
        backgroundColor: color('  color(srgb   0.1 0.2 0.3)  '),
      }),
    ]);

    expect(summary.colors[0]?.key).toBe('color(srgb 0.1 0.2 0.3)');
  });

  it('extracts gradient stops at the top level only', () => {
    const summary = run([
      scanRecord({
        locator: 'div',
        label: 'div',
        backgroundLayers: [
          'linear-gradient(180deg, rgba(255, 0, 0, 0.5) 0%, #00ff00 50%, oklch(0.7 0.2 30) 75%, color-mix(in oklch, rgb(1, 2, 3), white) 100%)',
          'url("https://example.com/noise.png")',
        ],
      }),
    ]);

    const stops = summary.colors.filter((group) => group.role === 'gradient-stop');
    expect(stops.map((group) => group.key)).toEqual(['#00ff00', '#ff000080', 'oklch(0.7 0.2 30)']);
    // The color nested inside color-mix is not a stop.
    expect(stops.some((group) => group.key === '#010203')).toBe(false);
  });

  it('ignores background layers that are not gradients', () => {
    const summary = run([
      scanRecord({
        locator: 'div',
        label: 'div',
        backgroundLayers: ['url("https://example.com/hero.jpg")'],
      }),
    ]);
    expect(summary.colors).toHaveLength(0);
  });

  it('marks a colorful low-count text color as accent and neutrals as neutral', () => {
    const records: ElementScanRecord[] = [];
    for (let index = 0; index < 10; index += 1) {
      records.push(textRecord({ locator: `p${index}`, label: 'p' }));
    }
    for (let index = 0; index < 2; index += 1) {
      records.push(
        textRecord(
          { locator: `a${index}`, label: 'a' },
          { color: color('rgb(79, 70, 229)', { hex: '#4f46e5' }) },
        ),
      );
    }
    for (let index = 0; index < 6; index += 1) {
      records.push(
        scanRecord({
          locator: `div${index}`,
          label: 'div',
          backgroundColor: color('rgb(255, 255, 255)', { hex: '#ffffff' }),
          borderColors: [color('rgb(79, 70, 229)', { hex: '#4f46e5' })],
        }),
      );
    }

    const summary = run(records);
    const label = (role: string, key: string) =>
      summary.colors.find((group) => group.role === role && group.key === key)?.inferredRole;

    expect(label('text', '#4f46e5')).toBe('accent');
    expect(label('text', '#0a0a0a')).toBe('neutral');
    expect(label('background', '#ffffff')).toBe('neutral');
    // Borders are never accent candidates.
    expect(label('border', '#4f46e5')).toBeNull();
  });

  it('does not mark a colorful color as accent when its count is at the median', () => {
    const summary = run([
      textRecord({ locator: 'p', label: 'p' }),
      textRecord(
        { locator: 'a', label: 'a' },
        { color: color('rgb(79, 70, 229)', { hex: '#4f46e5' }) },
      ),
    ]);

    expect(summary.colors.find((group) => group.key === '#4f46e5')?.inferredRole).toBeNull();
  });

  it('leaves chroma-unknown colors unlabelled', () => {
    const summary = run([
      textRecord({ locator: 'p', label: 'p' }, { color: color('color(srgb 0.1 0.2 0.3)') }),
    ]);
    expect(summary.colors[0]?.inferredRole).toBeNull();
  });
});

describe('aggregateSummary spacing', () => {
  it('counts each side, keeps zero and negatives, and orders them last', () => {
    const summary = run([
      scanRecord({
        locator: 'a',
        label: 'a',
        padding: sides(24),
        margin: sides(0, { top: -8, bottom: 16 }),
        gap: { row: 32, column: 32 },
      }),
      scanRecord({
        locator: 'b',
        label: 'b',
        padding: sides(0, { top: 96 }),
        margin: sides(0, { top: -8 }),
      }),
    ]);

    expect(summary.spacing.padding).toEqual([
      { valuePx: 24, count: 4, examples: [{ locator: 'a', label: 'a' }] },
      { valuePx: 96, count: 1, examples: [{ locator: 'b', label: 'b' }] },
      { valuePx: 0, count: 3, examples: [{ locator: 'b', label: 'b' }] },
    ]);
    expect(summary.spacing.margin.map((entry) => entry.valuePx)).toEqual([16, 0, -8]);
    expect(summary.spacing.gap).toEqual([
      { valuePx: 32, count: 2, examples: [{ locator: 'a', label: 'a' }] },
    ]);
  });
});

describe('aggregateSummary radii and shadows', () => {
  it('serializes equal corners as one value and unequal corners as four', () => {
    const summary = run([
      scanRecord({ locator: 'a', label: 'a', radius: corners('8px') }),
      scanRecord({ locator: 'b', label: 'b', radius: corners('8px') }),
      scanRecord({
        locator: 'c',
        label: 'c',
        radius: corners('16px', { bottomRight: '4px' }),
      }),
      scanRecord({ locator: 'd', label: 'd', radius: corners('0px') }),
    ]);

    expect(summary.radii).toEqual([
      { value: '8px', count: 2, examples: [{ locator: 'a', label: 'a' }, { locator: 'b', label: 'b' }] },
      { value: '16px 16px 4px 16px', count: 1, examples: [{ locator: 'c', label: 'c' }] },
    ]);
  });

  it('normalizes shadow whitespace, drops none, and sorts by count', () => {
    const summary = run([
      scanRecord({ locator: 'a', label: 'a', boxShadow: ['rgba(0, 0, 0, 0.1)   0px 1px  2px', 'none'] }),
      scanRecord({ locator: 'b', label: 'b', boxShadow: ['rgba(0, 0, 0, 0.1) 0px 1px 2px'] }),
      scanRecord({ locator: 'c', label: 'c', boxShadow: ['rgba(0, 0, 0, 0.2) 0px 8px 24px'] }),
    ]);

    expect(summary.shadows).toEqual([
      {
        value: 'rgba(0, 0, 0, 0.1) 0px 1px 2px',
        count: 2,
        examples: [{ locator: 'a', label: 'a' }, { locator: 'b', label: 'b' }],
      },
      {
        value: 'rgba(0, 0, 0, 0.2) 0px 8px 24px',
        count: 1,
        examples: [{ locator: 'c', label: 'c' }],
      },
    ]);
  });
});

describe('aggregateSummary fonts', () => {
  const declared: FontRecord[] = [
    {
      family: 'Inter',
      declared: true,
      loaded: null,
      matchedToContent: false,
      source: { kind: 'google', url: null, format: null, subset: null },
      weights: ['400'],
      faces: [],
    },
    {
      family: 'Unused Grotesk',
      declared: true,
      loaded: false,
      matchedToContent: false,
      source: { kind: 'unknown', url: null, format: null, subset: null },
      weights: [],
      faces: [],
    },
  ];

  it('marks declared families matched and appends families seen only in content', () => {
    const summary = run(
      [
        textRecord({ locator: 'p', label: 'p' }),
        textRecord({ locator: 'h1', label: 'h1' }, { familyReading: 'Inter Display', weight: 600 }),
        textRecord({ locator: 'h2', label: 'h2' }, { familyReading: 'Inter Display', weight: 500 }),
      ],
      declared,
    );

    expect(summary.fonts.map((font) => [font.family, font.declared, font.matchedToContent])).toEqual([
      ['Inter', true, true],
      ['Unused Grotesk', true, false],
      ['Inter Display', false, true],
    ]);
    const added = summary.fonts[2];
    expect(added?.weights).toEqual(['500', '600']);
    expect(added?.loaded).toBeNull();
    expect(added?.source.kind).toBe('unknown');
  });

  it('does not mutate the input font records', () => {
    run([textRecord({ locator: 'p', label: 'p' })], declared);
    expect(declared[0]?.matchedToContent).toBe(false);
  });
});

describe('aggregateSummary scope and determinism', () => {
  it('derives limitation sentences from the scan scope', () => {
    const summary = aggregateSummary({
      records: [],
      fonts: [],
      stack: stackReport,
      source,
      scope: { ...scope, capped: true },
    });

    expect(summary.limitations).toEqual([
      'The scan stopped at its 5000 element cap, so 812 of 1200 eligible elements were read.',
      '388 elements were skipped: not rendered.',
      '1 frame was inaccessible, so their content is not included.',
      'Counts are element and property occurrences, not visual area.',
    ]);
  });

  it('always ends with the counting definition', () => {
    const summary = run([]);
    expect(summary.limitations.at(-1)).toBe(
      'Counts are element and property occurrences, not visual area.',
    );
  });

  it('produces identical output for identical input apart from the generated id', () => {
    const records = [
      textRecord({ locator: 'h1', label: 'h1' }, { sizePx: 72 }),
      scanRecord({ locator: 'div', label: 'div', padding: sides(12) }),
    ];
    const first = run(records);
    const second = run(records);

    expect({ ...first, id: '' }).toEqual({ ...second, id: '' });
    expect(first.id).not.toBe(second.id);
  });

  it('passes the source, scope, and stack report through unchanged', () => {
    const summary = run([]);
    expect(summary.source).toBe(source);
    expect(summary.scope).toBe(scope);
    expect(summary.stack).toBe(stackReport);
    expect(summary.schemaVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Derived views: palette clusters and the type-scale fold (PRD SUM-03, SUM-06)

function paletteGroup(
  raw: string,
  role: ColorGroup['role'],
  count: number,
  overrides: Partial<ColorGroup> = {},
): ColorGroup {
  const value = parseColor(raw);
  return {
    role,
    color: value,
    key: (value.hex ?? value.raw).toLowerCase(),
    count,
    inferredRole: null,
    examples: [{ locator: raw, label: raw }],
    ...overrides,
  };
}

describe('aggregateSummary palette clusters', () => {
  it('carries the clusters built from the palette it just recorded', () => {
    const summary = run([
      textRecord({ locator: 'h1', label: 'h1' }, { color: color('#4f46e5', { hex: '#4f46e5' }) }),
      textRecord({ locator: 'p', label: 'p' }, { color: color('#5248e8', { hex: '#5248e8' }) }),
      scanRecord({
        locator: 'section',
        label: 'section',
        backgroundColor: color('#ffffff', { hex: '#ffffff' }),
      }),
    ]);

    const clusters = summary.paletteClusters ?? [];
    expect(clusters).toEqual(clusterPalette(summary.colors));
    // The two near-identical text colours read as one swatch, the page as two.
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.representative.color.hex)).toContain('#4f46e5');
    // The flat palette is untouched: every measured row is still there.
    expect(summary.colors).toHaveLength(3);
  });

  it('records an empty cluster list for a page with no colors', () => {
    expect(run([]).paletteClusters).toEqual([]);
  });
});

describe('clusterPalette', () => {
  it('merges colors that differ by less than the cluster thresholds', () => {
    const clusters = clusterPalette([
      paletteGroup('#4f46e5', 'text', 9),
      paletteGroup('#5248e8', 'text', 4),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.totalCount).toBe(13);
    // The representative is the member seen most often, not the first read.
    expect(clusters[0]?.representative.color.hex).toBe('#4f46e5');
    expect(clusters[0]?.members.map((member) => member.color.hex)).toEqual([
      '#4f46e5',
      '#5248e8',
    ]);
  });

  it('keeps distinct hues apart at the same lightness and chroma', () => {
    const clusters = clusterPalette([
      paletteGroup('#e11d48', 'background', 6),
      paletteGroup('#1d4ed8', 'background', 5),
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.representative.color.hex)).toEqual([
      '#e11d48',
      '#1d4ed8',
    ]);
  });

  it('ignores hue for greys, whose hue carries no meaning', () => {
    // Two near-blacks whose hues are 180 degrees apart but whose chroma is
    // below the grey threshold.
    const clusters = clusterPalette([
      paletteGroup('#0a0a0a', 'text', 40),
      paletteGroup('#0b0b0c', 'text', 6),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.totalCount).toBe(46);
  });

  it('unions the roles of its members and counts them per role', () => {
    const clusters = clusterPalette([
      paletteGroup('#0a0a0a', 'text', 40),
      paletteGroup('#0a0a0a', 'border', 4),
      paletteGroup('#0b0b0c', 'background', 2),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.roles).toEqual(['text', 'background', 'border']);
    expect(clusterRoleCounts(clusters[0]!)).toEqual([
      { role: 'text', count: 40 },
      { role: 'background', count: 2 },
      { role: 'border', count: 4 },
    ]);
  });

  it('sorts clusters by total count, with a stable tie-break', () => {
    const clusters = clusterPalette([
      paletteGroup('#e11d48', 'border', 3),
      paletteGroup('#1d4ed8', 'border', 12),
      paletteGroup('#16a34a', 'border', 3),
    ]);

    expect(clusters.map((cluster) => cluster.totalCount)).toEqual([12, 3, 3]);
    expect(clusters.map((cluster) => cluster.key)).toEqual(['#1d4ed8', '#16a34a', '#e11d48']);
  });

  it('applies the existing accent rule to the cluster totals', () => {
    const clusters = clusterPalette([
      paletteGroup('#0a0a0a', 'text', 90),
      paletteGroup('#ffffff', 'background', 60),
      paletteGroup('#4f46e5', 'text', 4),
      paletteGroup('#e11d48', 'border', 2),
    ]);

    const byHex = new Map(
      clusters.map((cluster) => [cluster.representative.color.hex, cluster.inferredRole]),
    );
    expect(byHex.get('#0a0a0a')).toBe('neutral');
    expect(byHex.get('#ffffff')).toBe('neutral');
    expect(byHex.get('#4f46e5')).toBe('accent');
    // A border is never an accent candidate, so it stays unlabelled.
    expect(byHex.get('#e11d48')).toBeNull();
  });

  it('keeps an unparseable color in a cluster of its own', () => {
    const clusters = clusterPalette([
      paletteGroup('#0a0a0a', 'text', 5),
      paletteGroup('color(display-p3 0.1 0.1 0.1)', 'text', 4),
    ]);

    expect(clusters.length).toBeGreaterThan(1);
  });

  it('returns nothing for an empty palette', () => {
    expect(clusterPalette([])).toEqual([]);
  });
});

describe('groupTypographyByScale', () => {
  function combination(sizePx: number, key: string, count: number): TypographyGroup {
    return {
      key,
      familyReading: 'Inter',
      familyConfidence: 'declared',
      weight: 400,
      style: 'normal',
      sizePx,
      lineHeightRaw: '24px',
      letterSpacingRaw: 'normal',
      count,
      sample: 'Sample',
      examples: [],
    };
  }

  it('folds combinations under their size, largest step first', () => {
    const steps = groupTypographyByScale([
      combination(16, 'a', 20),
      combination(72, 'b', 1),
      combination(16, 'c', 4),
    ]);

    expect(steps.map((step) => [step.sizePx, step.combinations.length, step.count])).toEqual([
      [72, 1, 1],
      [16, 2, 24],
    ]);
    expect(steps[1]?.combinations.map((group) => group.key)).toEqual(['a', 'c']);
  });

  it('rounds the step the same way the compact size scale does', () => {
    const steps = groupTypographyByScale([
      combination(16.004, 'a', 1),
      combination(16.006, 'b', 1),
    ]);

    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.sizePx)).toEqual([16.01, 16]);
  });

  it('returns nothing when there are no combinations', () => {
    expect(groupTypographyByScale([])).toEqual([]);
  });
});
