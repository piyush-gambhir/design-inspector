// Grid and flex geometry for the pinned element's layout overlay
// (PRD LAY-01, competitive Tier 1 item 4).
//
// Pure functions over computed strings and boxes, so every track, line, and
// gap band is unit testable without a layout engine. The overlay never invents
// a track: a computed template we cannot read as a plain px list is refused by
// name instead of guessed at (`none`, `repeat(`, `masonry`, named lines).

import type { Rect } from '../contracts';
import { roundTo, splitTopLevel } from '../readings/units';

const PX_TRACK = /^-?\d+(?:\.\d+)?px$/;

/**
 * Resolved track sizes from a computed `grid-template-columns` or
 * `grid-template-rows`. Chrome serializes these as a space separated px list
 * once the grid is laid out. Anything else, including `none`, an unresolved
 * `repeat(`, `masonry`, or a list carrying `[line-names]`, returns null so the
 * caller can say so rather than draw a wrong grid.
 */
export function parseTrackList(computed: string | null | undefined): number[] | null {
  const text = (computed ?? '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'none' || lower === 'auto' || lower === 'masonry' || lower === 'subgrid') {
    return null;
  }

  const tokens = splitTopLevel(text, ' ');
  if (tokens.length === 0) return null;

  const sizes: number[] = [];
  for (const token of tokens) {
    if (!PX_TRACK.test(token)) return null;
    const value = Number.parseFloat(token);
    if (!Number.isFinite(value)) return null;
    sizes.push(roundTo(value, 2));
  }
  return sizes;
}

export interface TrackBand {
  /** Offset from the start of the content box, in CSS px. */
  start: number;
  size: number;
  /** True for the gap bands between two tracks. */
  gap: boolean;
  /** 1-based track number. Null for gap bands. */
  index: number | null;
}

/**
 * Tracks and the gap bands between them, as offsets along one axis of the
 * content box. The trailing gap after the last track does not exist in CSS, so
 * it is not drawn.
 */
export function trackBands(sizes: number[], gap: number): TrackBand[] {
  const bands: TrackBand[] = [];
  let offset = 0;
  sizes.forEach((size, index) => {
    bands.push({ start: roundTo(offset, 2), size: roundTo(size, 2), gap: false, index: index + 1 });
    offset += size;
    if (index < sizes.length - 1 && gap > 0) {
      bands.push({ start: roundTo(offset, 2), size: roundTo(gap, 2), gap: true, index: null });
      offset += gap;
    }
  });
  return bands;
}

export type FlexAxis = 'horizontal' | 'vertical';

/** The main axis a computed `flex-direction` runs along. */
export function flexMainAxis(direction: string | null | undefined): FlexAxis {
  const text = (direction ?? 'row').trim().toLowerCase();
  return text.startsWith('column') ? 'vertical' : 'horizontal';
}

export interface GapBand {
  /** Viewport-space box of the band between one child and the next. */
  rect: Rect;
  /** The measured distance along the main axis, in CSS px. */
  size: number;
}

/**
 * The bands between consecutive children along the main axis, in viewport
 * coordinates. Children are ordered by their painted position rather than
 * their DOM order, so `row-reverse` and `order` read correctly, and a pair that
 * does not share a line on the cross axis is skipped: with `flex-wrap` the
 * distance from the end of one line to the start of the next is not a gap.
 */
export function flexGapBands(children: Rect[], axis: FlexAxis): GapBand[] {
  const horizontal = axis === 'horizontal';
  const mainStart = (rect: Rect): number => (horizontal ? rect.x : rect.y);
  const mainEnd = (rect: Rect): number => (horizontal ? rect.x + rect.width : rect.y + rect.height);
  const crossStart = (rect: Rect): number => (horizontal ? rect.y : rect.x);
  const crossEnd = (rect: Rect): number => (horizontal ? rect.y + rect.height : rect.x + rect.width);

  const ordered = [...children].sort((left, right) => mainStart(left) - mainStart(right));
  const bands: GapBand[] = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index] as Rect;
    const next = ordered[index + 1] as Rect;

    // Same line only: the cross-axis spans have to actually overlap.
    const sharedStart = Math.max(crossStart(current), crossStart(next));
    const sharedEnd = Math.min(crossEnd(current), crossEnd(next));
    if (sharedEnd <= sharedStart) continue;

    const size = roundTo(mainStart(next) - mainEnd(current), 2);
    if (size <= 0) continue;

    bands.push({
      rect: horizontal
        ? { x: mainEnd(current), y: sharedStart, width: size, height: sharedEnd - sharedStart }
        : { x: sharedStart, y: mainEnd(current), width: sharedEnd - sharedStart, height: size },
      size,
    });
  }

  return bands;
}
