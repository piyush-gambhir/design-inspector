















import type { Rect, Sides } from '../contracts';
import { formatPx, roundTo } from '../readings/units';

export type MeasureCase = 'separated' | 'overlap' | 'containment';

export interface BoxMeasurement {
  case: MeasureCase;

  gapX: number;

  gapY: number;




  edges: Sides<number>;

  contains: 'a-in-b' | 'b-in-a' | null;
}

function round(value: number): number {
  return roundTo(value, 2);
}


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
