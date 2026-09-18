import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAJOR_STEP,
  MINOR_STEP,
  RULER_SIZE,
  addGuide,
  listGuides,
  moveGuide,
  removeGuide,
  resetGuides,
  rulerTicks,
} from '../lib/inspector/rulers';

beforeEach(() => {
  resetGuides();
});

describe('rulerTicks', () => {
  it('ticks every 10px and labels every 100px from the document origin', () => {
    const ticks = rulerTicks(0, 100);
    expect(ticks.map((tick) => tick.value)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.value)).toEqual([0, 100]);
    // With no scroll, the document coordinate and the screen offset agree.
    expect(ticks.every((tick) => tick.position === tick.value)).toBe(true);
  });

  it('keeps the numbers in document space and the positions in viewport space', () => {
    const ticks = rulerTicks(250, 40);
    expect(ticks[0]).toEqual({ position: 0, value: 250, major: false });
    expect(ticks.map((tick) => tick.value)).toEqual([250, 260, 270, 280, 290]);
    expect(ticks.map((tick) => tick.position)).toEqual([0, 10, 20, 30, 40]);
  });

  it('starts at the document grid, not at the scroll offset', () => {
    const ticks = rulerTicks(97, 30);
    // 90 is the first multiple of the minor step at or before 97, so its line
    // is drawn 7px off the leading edge rather than being dropped.
    expect(ticks[0]).toEqual({ position: -7, value: 90, major: false });
    expect(ticks.some((tick) => tick.major && tick.value === 100)).toBe(true);
  });

  it('uses the exported steps as its defaults', () => {
    expect(MINOR_STEP).toBe(10);
    expect(MAJOR_STEP).toBe(100);
    expect(RULER_SIZE).toBeGreaterThan(0);
    expect(rulerTicks(0, 20, MINOR_STEP, MAJOR_STEP)).toEqual(rulerTicks(0, 20));
  });

  it('returns nothing for a zero or negative length', () => {
    expect(rulerTicks(0, 0)).toEqual([]);
    expect(rulerTicks(0, -50)).toEqual([]);
  });

  it('caps the tick count rather than building an unbounded list', () => {
    expect(rulerTicks(0, 10_000_000).length).toBeLessThanOrEqual(4000);
  });
});

describe('page guides', () => {
  it('adds, moves and removes guides for the page session', () => {
    const vertical = addGuide('x', 120.4);
    const horizontal = addGuide('y', 300);
    expect(listGuides()).toHaveLength(2);
    expect(vertical.position).toBe(120);
    expect(vertical.axis).toBe('x');

    moveGuide(vertical.id, 240.7);
    expect(listGuides().find((guide) => guide.id === vertical.id)?.position).toBe(241);

    removeGuide(horizontal.id);
    expect(listGuides().map((guide) => guide.id)).toEqual([vertical.id]);
  });

  it('gives every guide its own id', () => {
    const ids = [addGuide('x', 10), addGuide('x', 10), addGuide('y', 10)].map((g) => g.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('ignores a move or a remove for a guide that is gone', () => {
    expect(() => moveGuide('guide-999', 10)).not.toThrow();
    expect(() => removeGuide('guide-999')).not.toThrow();
  });

  it('hands out a copy, so a caller cannot mutate the session list', () => {
    addGuide('x', 10);
    listGuides().push({ id: 'fake', axis: 'y', position: 0 });
    expect(listGuides()).toHaveLength(1);
  });
});
