import { describe, expect, it } from 'vitest';

import type { Rect } from '@/lib/contracts';
import {
  flexGapBands,
  flexMainAxis,
  parseTrackList,
  trackBands,
} from '@/lib/inspector/layout-overlay';

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe('parseTrackList', () => {
  it('reads a resolved px list', () => {
    expect(parseTrackList('296px 296px 296px')).toEqual([296, 296, 296]);
    expect(parseTrackList('  120.5px   40px ')).toEqual([120.5, 40]);
    expect(parseTrackList('0px')).toEqual([0]);
  });

  it('refuses anything it cannot read as px', () => {
    expect(parseTrackList('none')).toBeNull();
    expect(parseTrackList('')).toBeNull();
    expect(parseTrackList(null)).toBeNull();
    expect(parseTrackList('repeat(3, minmax(0, 1fr))')).toBeNull();
    expect(parseTrackList('minmax(0px, 1fr) 100px')).toBeNull();
    expect(parseTrackList('1fr 1fr')).toBeNull();
    expect(parseTrackList('100px auto')).toBeNull();
    expect(parseTrackList('masonry')).toBeNull();
    expect(parseTrackList('[full-start] 100px [full-end]')).toBeNull();
    expect(parseTrackList('50% 50%')).toBeNull();
  });
});

describe('trackBands', () => {
  it('places tracks and the gaps between them', () => {
    expect(trackBands([100, 200], 20)).toEqual([
      { start: 0, size: 100, gap: false, index: 1 },
      { start: 100, size: 20, gap: true, index: null },
      { start: 120, size: 200, gap: false, index: 2 },
    ]);
  });

  it('draws no trailing gap and no gap at all when there is none', () => {
    expect(trackBands([50], 20)).toEqual([{ start: 0, size: 50, gap: false, index: 1 }]);
    expect(trackBands([50, 50], 0)).toEqual([
      { start: 0, size: 50, gap: false, index: 1 },
      { start: 50, size: 50, gap: false, index: 2 },
    ]);
  });
});

describe('flexMainAxis', () => {
  it('maps a computed direction onto its axis', () => {
    expect(flexMainAxis('row')).toBe('horizontal');
    expect(flexMainAxis('row-reverse')).toBe('horizontal');
    expect(flexMainAxis('column')).toBe('vertical');
    expect(flexMainAxis('column-reverse')).toBe('vertical');
    expect(flexMainAxis(undefined)).toBe('horizontal');
  });
});

describe('flexGapBands', () => {
  it('measures the bands between children of a row', () => {
    const children = [rect(0, 0, 100, 40), rect(120, 0, 100, 40), rect(240, 0, 100, 40)];
    const bands = flexGapBands(children, 'horizontal');

    expect(bands).toHaveLength(2);
    expect(bands[0]).toEqual({ rect: { x: 100, y: 0, width: 20, height: 40 }, size: 20 });
    expect(bands[1]?.size).toBe(20);
  });

  it('measures the bands between children of a column', () => {
    const children = [rect(0, 0, 100, 40), rect(0, 52, 100, 40)];
    const bands = flexGapBands(children, 'vertical');

    expect(bands).toEqual([{ rect: { x: 0, y: 40, width: 100, height: 12 }, size: 12 }]);
  });

  it('orders children by painted position, so row-reverse still reads left to right', () => {
    const children = [rect(240, 0, 100, 40), rect(0, 0, 100, 40)];
    const bands = flexGapBands(children, 'horizontal');

    expect(bands).toEqual([{ rect: { x: 100, y: 0, width: 140, height: 40 }, size: 140 }]);
  });

  it('skips a pair that does not share a line, and touching children', () => {
    // Two wrapped lines: the second child starts a new row.
    const wrapped = [rect(0, 0, 100, 40), rect(0, 60, 100, 40)];
    expect(flexGapBands(wrapped, 'horizontal')).toEqual([]);

    const touching = [rect(0, 0, 100, 40), rect(100, 0, 100, 40)];
    expect(flexGapBands(touching, 'horizontal')).toEqual([]);
  });

  it('has nothing to draw for a single child', () => {
    expect(flexGapBands([rect(0, 0, 10, 10)], 'horizontal')).toEqual([]);
    expect(flexGapBands([], 'vertical')).toEqual([]);
  });
});
