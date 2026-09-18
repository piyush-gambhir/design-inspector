import { describe, expect, it } from 'vitest';

import { filterSummary, matchesQuery } from '@/lib/ui/sidepanel/summary-filter';
import { pageSummary } from './fixtures/summary';

describe('matchesQuery', () => {
  it('is a case-insensitive substring over the entry text', () => {
    expect(matchesQuery(['Inter Display'], 'inter')).toBe(true);
    expect(matchesQuery(['Inter Display'], 'DISPLAY')).toBe(true);
    expect(matchesQuery(['Inter Display'], 'helvetica')).toBe(false);
  });

  it('takes every whitespace separated term, so "24 px" finds 24px', () => {
    expect(matchesQuery(['24px'], '24 px')).toBe(true);
    expect(matchesQuery(['24px'], '24 rem')).toBe(false);
  });

  it('matches everything when the query is empty', () => {
    expect(matchesQuery(['anything'], '')).toBe(true);
    expect(matchesQuery(['anything'], '   ')).toBe(true);
  });
});

describe('filterSummary', () => {
  it('shows everything for an empty query', () => {
    const filtered = filterSummary(pageSummary, '');
    expect(filtered.active).toBe(false);
    expect(filtered.typography).toBe(pageSummary.typography);
    expect(filtered.colors).toBe(pageSummary.colors);
    expect(filtered.shown).toBe(filtered.total);
    expect(filtered.total).toBeGreaterThan(0);
  });

  it('filters typography by family', () => {
    const filtered = filterSummary(pageSummary, 'Inter Display');
    expect(filtered.active).toBe(true);
    expect(filtered.typography.map(group => group.familyReading)).toEqual(['Inter Display']);
    expect(filtered.fonts.map(font => font.family)).toEqual(['Inter Display']);
    expect(filtered.colors).toEqual([]);
    expect(filtered.shown).toBeLessThan(filtered.total);
  });

  it('filters typography by weight and by size in px and rem', () => {
    expect(filterSummary(pageSummary, '600').typography.map(group => group.weight)).toEqual([600]);
    expect(filterSummary(pageSummary, '72px').typography.map(group => group.sizePx)).toEqual([72]);
    // 16px against a 16px root is 1rem.
    expect(filterSummary(pageSummary, '1rem').typography.map(group => group.sizePx)).toEqual([16]);
  });

  it('filters colors by hex, by raw value, and by role', () => {
    const byHex = filterSummary(pageSummary, '#4f46e5');
    expect(byHex.colors.map(group => group.color.hex)).toEqual(['#4f46e5']);

    const byRole = filterSummary(pageSummary, 'border');
    expect(byRole.colors.map(group => group.role)).toEqual(['border']);

    const byRaw = filterSummary(pageSummary, '#e4e4e7');
    expect(byRaw.colors.map(group => group.color.raw)).toEqual(['#e4e4e7']);
  });

  it('filters spacing, radii, and shadows by value', () => {
    const spacing = filterSummary(pageSummary, '24');
    expect(spacing.spacing.padding.map(entry => entry.valuePx)).toEqual([24]);
    expect(spacing.spacing.margin).toEqual([]);

    expect(filterSummary(pageSummary, '16px 16px').radii.map(group => group.value)).toEqual([
      '16px 16px 4px 16px',
    ]);
    expect(filterSummary(pageSummary, '0.06').shadows).toHaveLength(1);
    expect(filterSummary(pageSummary, 'inset').shadows).toEqual([]);
  });

  it('filters the stack report by detection and hint name', () => {
    const filtered = filterSummary(pageSummary, 'next');
    expect(filtered.stack.detections.map(detection => detection.name)).toEqual(['Next.js']);
    expect(filtered.stack.hints).toEqual([]);
  });

  it('counts what is shown against what there was', () => {
    const filtered = filterSummary(pageSummary, 'px');
    expect(filtered.shown).toBeGreaterThan(0);
    expect(filtered.shown).toBeLessThanOrEqual(filtered.total);

    const nothing = filterSummary(pageSummary, 'zzzz');
    expect(nothing.shown).toBe(0);
    expect(nothing.typography).toEqual([]);
    expect(nothing.stack.detections).toEqual([]);
    expect(nothing.total).toBe(filtered.total);
  });
});
