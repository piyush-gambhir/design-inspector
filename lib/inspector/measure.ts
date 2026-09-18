// Distance measurement between two visible boxes (PRD LAY-02).
//
// Pure geometry over two `getBoundingClientRect` boxes in CSS px. Nothing here
// touches the DOM, so the three cases and every number they report are unit
// testable.
//
// Sign convention for `edges`: a positive value means b's edge sits inside a's
// edge on that side. Containment is exactly the case where all four values are
// non negative (b inside a) or all four are non positive (a inside b); the
// reported insets then always run from the inner box outward, so they read as
// positive distances whichever way round the pair was measured.
//
// These are geometric distances between painted boxes. They are never a margin
// reading: a 24px gap can come from a margin, a gap, a flex justification, or
// an absolute offset, and the overlay must not claim to know which (PRD LAY-02).

import type { Rect, Sides } from '../contracts';
import { formatPx, roundTo } from '../readings/units';

export type MeasureCase = 'separated' | 'overlap' | 'containment';

export interface BoxMeasurement {
  case: MeasureCase;
  /** Nearest-edge distance on the x axis. Negative when the x spans overlap. */
  gapX: number;
  /** Nearest-edge distance on the y axis. Negative when the y spans overlap. */
  gapY: number;
  /**
   * Four edge distances. For containment these are the insets from the inner
   * box's edges out to the outer box's edges, all non negative.
   */
  edges: Sides<number>;
  /** Which box sits inside the other. Null unless the case is containment. */
  contains: 'a-in-b' | 'b-in-a' | null;
}

function round(value: number): number {
  return roundTo(value, 2);
}

/** Positive where b's edge is inside a's edge on that side. */
function edgesOf(a: Rect, b: Rect): Sides<number> {
  return {
    top: round(b.y - a.y),
    right: round(a.x + a.width - (b.x + b.width)),
    bottom: round(a.y + a.height - (b.y + b.height)),
    left: round(b.x - a.x),
  };
}

function negate(sides: Sides<number>): Sides<number> {
  return {
    top: round(-sides.top),
    right: round(-sides.right),
    bottom: round(-sides.bottom),
    left: round(-sides.left),
  };
}

function sidesList(sides: Sides<number>): number[] {
  return [sides.top, sides.right, sides.bottom, sides.left];
}

/**
 * The measurement between two boxes. Rounding happens before the case is
 * decided, so the numbers on screen are the ones that chose the case: two
 * boxes whose edges touch report a 0px gap and read as separated, not as an
 * overlap of nothing.
 */
export function measureBoxes(a: Rect, b: Rect): BoxMeasurement {
  const gapX = round(Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const gapY = round(Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  const edges = edgesOf(a, b);

  const intersecting = gapX < 0 && gapY < 0;
  if (intersecting) {
    const values = sidesList(edges);
    if (values.every((value) => value >= 0)) {
      return { case: 'containment', gapX, gapY, edges, contains: 'b-in-a' };
    }
    if (values.every((value) => value <= 0)) {
      return { case: 'containment', gapX, gapY, edges: negate(edges), contains: 'a-in-b' };
    }
    return { case: 'overlap', gapX, gapY, edges, contains: null };
  }

  return { case: 'separated', gapX, gapY, edges, contains: null };
}

/**
 * Per-axis labels for the guides. A separated pair whose spans overlap on one
 * axis reads 0px on that axis, which is the distance a user would measure with
 * a ruler; an intersecting pair reads `overlap Npx` on both axes.
 */
export function measureAxisLabels(measurement: BoxMeasurement): { x: string; y: string } {
  if (measurement.case === 'overlap') {
    return {
      x: `overlap ${formatPx(Math.abs(measurement.gapX))}`,
      y: `overlap ${formatPx(Math.abs(measurement.gapY))}`,
    };
  }
  return {
    x: formatPx(Math.max(0, measurement.gapX)),
    y: formatPx(Math.max(0, measurement.gapY)),
  };
}

/** The clipboard text for the panel's measure block. */
export function measurementCopyText(measurement: BoxMeasurement): string {
  if (measurement.case === 'containment') {
    const { top, right, bottom, left } = measurement.edges;
    return [
      `inset-top: ${formatPx(top)}`,
      `inset-right: ${formatPx(right)}`,
      `inset-bottom: ${formatPx(bottom)}`,
      `inset-left: ${formatPx(left)}`,
    ].join(', ');
  }
  if (measurement.case === 'overlap') {
    return `overlap-x: ${formatPx(Math.abs(measurement.gapX))}, overlap-y: ${formatPx(Math.abs(measurement.gapY))}`;
  }
  return `gap-x: ${formatPx(Math.max(0, measurement.gapX))}, gap-y: ${formatPx(Math.max(0, measurement.gapY))}`;
}

export interface Guide {
  /** Viewport-space box to draw the guide line in. */
  rect: Rect;
  orientation: 'horizontal' | 'vertical';
  label: string;
}

function span(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);
  if (overlapEnd > overlapStart) return (overlapStart + overlapEnd) / 2;
  return ((aStart + aEnd) / 2 + (bStart + bEnd) / 2) / 2;
}

/**
 * The guide lines for a measurement, in viewport coordinates. Separated and
 * overlapping pairs get one guide per axis; containment gets one guide per
 * inset side.
 */
export function measureGuides(a: Rect, b: Rect, measurement: BoxMeasurement): Guide[] {
  const labels = measureAxisLabels(measurement);
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;

  if (measurement.case === 'containment') {
    const inner = measurement.contains === 'a-in-b' ? a : b;
    const outer = measurement.contains === 'a-in-b' ? b : a;
    const innerRight = inner.x + inner.width;
    const innerBottom = inner.y + inner.height;
    const midX = inner.x + inner.width / 2;
    const midY = inner.y + inner.height / 2;
    const { top, right, bottom, left } = measurement.edges;
    return [
      {
        orientation: 'vertical',
        rect: { x: midX, y: outer.y, width: 0, height: Math.max(0, inner.y - outer.y) },
        label: formatPx(top),
      },
      {
        orientation: 'horizontal',
        rect: {
          x: innerRight,
          y: midY,
          width: Math.max(0, outer.x + outer.width - innerRight),
          height: 0,
        },
        label: formatPx(right),
      },
      {
        orientation: 'vertical',
        rect: {
          x: midX,
          y: innerBottom,
          width: 0,
          height: Math.max(0, outer.y + outer.height - innerBottom),
        },
        label: formatPx(bottom),
      },
      {
        orientation: 'horizontal',
        rect: { x: outer.x, y: midY, width: Math.max(0, inner.x - outer.x), height: 0 },
        label: formatPx(left),
      },
    ];
  }

  const guideY = span(a.y, aBottom, b.y, bBottom);
  const guideX = span(a.x, aRight, b.x, bRight);

  const horizontal: Guide =
    measurement.gapX >= 0
      ? b.x >= aRight
        ? {
            orientation: 'horizontal',
            rect: { x: aRight, y: guideY, width: Math.max(0, b.x - aRight), height: 0 },
            label: labels.x,
          }
        : {
            orientation: 'horizontal',
            rect: { x: bRight, y: guideY, width: Math.max(0, a.x - bRight), height: 0 },
            label: labels.x,
          }
      : {
          orientation: 'horizontal',
          rect: {
            x: Math.max(a.x, b.x),
            y: guideY,
            width: Math.max(0, Math.min(aRight, bRight) - Math.max(a.x, b.x)),
            height: 0,
          },
          label: labels.x,
        };

  const vertical: Guide =
    measurement.gapY >= 0
      ? b.y >= aBottom
        ? {
            orientation: 'vertical',
            rect: { x: guideX, y: aBottom, width: 0, height: Math.max(0, b.y - aBottom) },
            label: labels.y,
          }
        : {
            orientation: 'vertical',
            rect: { x: guideX, y: bBottom, width: 0, height: Math.max(0, a.y - bBottom) },
            label: labels.y,
          }
      : {
          orientation: 'vertical',
          rect: {
            x: guideX,
            y: Math.max(a.y, b.y),
            width: 0,
            height: Math.max(0, Math.min(aBottom, bBottom) - Math.max(a.y, b.y)),
          },
          label: labels.y,
        };

  return [horizontal, vertical];
}
