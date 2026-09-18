// Rulers and guides (Designer Tools territory, competitive research section 4).
//
// Two strips inside the shadow root, one along the top and one along the left,
// ticked in CSS px of the document rather than of the viewport: the numbers are
// document coordinates, so a tick keeps its label while the page scrolls under
// it. Clicking a ruler drops a guide at that document coordinate, which is why
// guides survive scrolling without any bookkeeping.
//
// The tick maths is pure so the arithmetic is testable without a layout engine;
// the drawing lives in overlay.ts with the rest of the shadow DOM.

/** Thickness of each ruler strip, in CSS px. */
export const RULER_SIZE = 20;

/** Smallest tick. Every tick is a line; only major ticks carry a number. */
export const MINOR_STEP = 10;

/** Every tenth minor tick is labelled. */
export const MAJOR_STEP = 100;

export interface RulerTick {
  /** Offset along the ruler, in viewport px from the strip's origin. */
  position: number;
  /** The document coordinate this tick names. */
  value: number;
  /** True for the labelled, full-height ticks. */
  major: boolean;
}

/**
 * Ticks covering `length` viewport px starting at document offset `scroll`.
 *
 * The first tick is the first multiple of `minor` at or before `scroll`, so a
 * partially scrolled ruler still lines up with the document grid instead of
 * starting wherever the viewport happens to begin. A tick just off the leading
 * edge is included on purpose: its label is drawn to the right of the line and
 * would otherwise pop in and out at the boundary.
 */
export function rulerTicks(
  scroll: number,
  length: number,
  minor: number = MINOR_STEP,
  major: number = MAJOR_STEP,
): RulerTick[] {
  const step = Math.max(1, minor);
  const majorStep = Math.max(step, major);
  if (length <= 0) return [];

  const first = Math.floor(scroll / step) * step;
  const last = scroll + length;
  const ticks: RulerTick[] = [];
  // A guard on the count, not on the geometry: a pathological viewport must not
  // be able to ask for a million nodes.
  const maxTicks = 4000;

  for (let value = first; value <= last && ticks.length < maxTicks; value += step) {
    ticks.push({
      position: value - scroll,
      value,
      // Modulo on a float would drift, so the comparison is done on integers.
      major: Math.round(value) % Math.round(majorStep) === 0,
    });
  }
  return ticks;
}

export type GuideAxis = 'x' | 'y';

export interface PageGuide {
  id: string;
  axis: GuideAxis;
  /** Document coordinate: x for a vertical guide, y for a horizontal one. */
  position: number;
}

let guideCounter = 0;

export function createGuide(axis: GuideAxis, position: number): PageGuide {
  guideCounter += 1;
  return { id: `guide-${guideCounter}`, axis, position: Math.round(position) };
}

/**
 * Guides live for the page session only, at module scope, so leaving and
 * re-entering the inspector on the same page keeps them and a reload forgets
 * them. Nothing here reaches storage (PRD 17.1).
 */
const sessionGuides: PageGuide[] = [];

export function listGuides(): PageGuide[] {
  return [...sessionGuides];
}

export function addGuide(axis: GuideAxis, position: number): PageGuide {
  const guide = createGuide(axis, position);
  sessionGuides.push(guide);
  return guide;
}

export function moveGuide(id: string, position: number): void {
  const guide = sessionGuides.find((entry) => entry.id === id);
  if (guide) guide.position = Math.round(position);
}

export function removeGuide(id: string): void {
  const index = sessionGuides.findIndex((entry) => entry.id === id);
  if (index >= 0) sessionGuides.splice(index, 1);
}

/** Test seam, and what a fresh page session starts from. */
export function resetGuides(): void {
  sessionGuides.length = 0;
  guideCounter = 0;
}
