import { describe, expect, it } from 'vitest';

import type { Rect } from '@/lib/contracts';
import {
  measureAxisLabels,
  measureBoxes,
  measureGuides,
  measurementCopyText,
} from '@/lib/inspector/measure';

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe('measureBoxes', () => {
  it('reports the gap between the nearest edges of separated boxes', () => {
    const a = rect(0, 0, 100, 50);
    const b = rect(124, 0, 100, 50);
    const measurement = measureBoxes(a, b);

    expect(measurement.case).toBe('separated');
    expect(measurement.gapX).toBe(24);
    // The vertical spans overlap completely, which is a 0px vertical distance.
    expect(measurement.gapY).toBeLessThan(0);
    expect(measureAxisLabels(measurement)).toEqual({ x: '24px', y: '0px' });
    expect(measurementCopyText(measurement)).toBe('gap-x: 24px, gap-y: 0px');
  });

  it('measures both axes when the boxes are diagonally apart', () => {
    const measurement = measureBoxes(rect(0, 0, 40, 40), rect(60, 100, 40, 40));
    expect(measurement.case).toBe('separated');
    expect(measurement.gapX).toBe(20);
    expect(measurement.gapY).toBe(60);
    expect(measurementCopyText(measurement)).toBe('gap-x: 20px, gap-y: 60px');
  });

  it('reads touching edges as a 0px gap, not as an overlap', () => {
    const measurement = measureBoxes(rect(0, 0, 100, 50), rect(100, 0, 100, 50));
    expect(measurement.case).toBe('separated');
    expect(measurement.gapX).toBe(0);
    expect(measureAxisLabels(measurement).x).toBe('0px');
  });

  it('labels an intersecting pair as an overlap with positive numbers', () => {
    const measurement = measureBoxes(rect(0, 0, 100, 100), rect(80, 60, 100, 100));
    expect(measurement.case).toBe('overlap');
    expect(measurement.gapX).toBe(-20);
    expect(measurement.gapY).toBe(-40);
    expect(measureAxisLabels(measurement)).toEqual({ x: 'overlap 20px', y: 'overlap 40px' });
    expect(measurementCopyText(measurement)).toBe('overlap-x: 20px, overlap-y: 40px');
  });

  it('reports the four insets when b sits inside a', () => {
    const measurement = measureBoxes(rect(0, 0, 200, 100), rect(20, 10, 100, 60));
    expect(measurement.case).toBe('containment');
    expect(measurement.contains).toBe('b-in-a');
    expect(measurement.edges).toEqual({ top: 10, right: 80, bottom: 30, left: 20 });
    expect(measurementCopyText(measurement)).toBe(
      'inset-top: 10px, inset-right: 80px, inset-bottom: 30px, inset-left: 20px',
    );
  });

  it('reports the insets from the inner box when a sits inside b', () => {
    const measurement = measureBoxes(rect(20, 10, 100, 60), rect(0, 0, 200, 100));
    expect(measurement.case).toBe('containment');
    expect(measurement.contains).toBe('a-in-b');
    expect(measurement.edges).toEqual({ top: 10, right: 80, bottom: 30, left: 20 });
  });

  it('counts a shared edge as containment, not as an overlap', () => {
    const measurement = measureBoxes(rect(0, 0, 200, 100), rect(0, 10, 100, 60));
    expect(measurement.case).toBe('containment');
    expect(measurement.edges.left).toBe(0);
  });

  it('rounds to two decimals before deciding the case', () => {
    const measurement = measureBoxes(rect(0, 0, 100, 50), rect(100.001, 0, 10, 50));
    expect(measurement.gapX).toBe(0);
    expect(measurement.case).toBe('separated');
  });
});

describe('measureGuides', () => {
  it('draws one guide per axis for a separated pair', () => {
    const a = rect(0, 0, 100, 50);
    const b = rect(124, 0, 100, 50);
    const guides = measureGuides(a, b, measureBoxes(a, b));

    expect(guides).toHaveLength(2);
    const horizontal = guides.find((guide) => guide.orientation === 'horizontal');
    expect(horizontal?.rect.x).toBe(100);
    expect(horizontal?.rect.width).toBe(24);
    expect(horizontal?.label).toBe('24px');
  });

  it('draws one guide per side for containment', () => {
    const a = rect(0, 0, 200, 100);
    const b = rect(20, 10, 100, 60);
    const guides = measureGuides(a, b, measureBoxes(a, b));

    expect(guides).toHaveLength(4);
    expect(guides.map((guide) => guide.label)).toEqual(['10px', '80px', '30px', '20px']);
  });
});
