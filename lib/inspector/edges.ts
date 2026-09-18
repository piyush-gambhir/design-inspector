// Point-to-edge measurement, Dimensions style (competitive Tier 2 item 3).
//
// LAY-02 measures between two element boxes. This measures from wherever the
// pointer is to the nearest edge in each of the four directions, which is what
// people reach for when the thing they want to measure is not an element: the
// inside of a padded card, the gutter between two columns, the space under a
// heading.
//
// The technique, stated plainly because PRD 16.1 requires the method to be
// legible: we do not read rendered pixels. Two things are combined. We sample
// the topmost element under a point, step outward along one axis in fixed
// increments, and call it an edge the first time the topmost element is a
// different one. We also take the boxes of every element the pointer is inside
// and treat their own borders as edges. The first alone missed the closer one
// whenever a wrapper's box ended before the hit test changed (tester finding
// F10). It is a geometric reading about element boxes, not a visual reading
// about colour, so a border drawn inside one element is invisible to it. The
// panel says "Nearest element edges, geometric" for exactly that reason.
//
// Everything here is pure: the sampler is injected, so the walk is unit
// testable without a layout engine.

/** Sampling resolution. Four px keeps a full probe under ~500 samples. */
export const EDGE_STEP = 4;

/** Nothing is measured further than this from the pointer. */
export const EDGE_MAX_DISTANCE = 2000;

/** How the method is described wherever a reading is shown. */
export const EDGE_METHOD_LABEL = 'Nearest element edges, geometric';

export type EdgeDirection = 'top' | 'right' | 'bottom' | 'left';

export interface EdgeDistance {
  /** CSS px from the pointer to the edge, or to where the search stopped. */
  distance: number;
  /** True when the topmost element actually changed within range. */
  found: boolean;
}

export interface NearestEdges {
  top: EdgeDistance;
  right: EdgeDistance;
  bottom: EdgeDistance;
  left: EdgeDistance;
  /** False when nothing is under the pointer at all. */
  hasOrigin: boolean;
}

export type EdgeSampler = (x: number, y: number) => Element | null;

export interface Viewport {
  width: number;
  height: number;
}

/** One box from the stack under the pointer, in viewport coordinates. */
export interface EdgeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DIRECTIONS: { key: EdgeDirection; dx: number; dy: number }[] = [
  { key: 'top', dx: 0, dy: -1 },
  { key: 'right', dx: 1, dy: 0 },
  { key: 'bottom', dx: 0, dy: 1 },
  { key: 'left', dx: -1, dy: 0 },
];

/** How far the walk can go before it leaves the viewport. */
function limitFor(
  direction: EdgeDirection,
  origin: { x: number; y: number },
  viewport: Viewport,
): number {
  const room =
    direction === 'top'
      ? origin.y
      : direction === 'bottom'
        ? viewport.height - origin.y
        : direction === 'left'
          ? origin.x
          : viewport.width - origin.x;
  return Math.max(0, Math.min(EDGE_MAX_DISTANCE, room));
}

/**
 * Distances from `origin` to each of a rect's two edges along one direction,
 * counting only the ones that lie beyond the pointer.
 */
function rectDistances(direction: EdgeDirection, origin: { x: number; y: number }, rect: EdgeRect): number[] {
  const values =
    direction === 'top'
      ? [origin.y - rect.y, origin.y - (rect.y + rect.height)]
      : direction === 'bottom'
        ? [rect.y - origin.y, rect.y + rect.height - origin.y]
        : direction === 'left'
          ? [origin.x - rect.x, origin.x - (rect.x + rect.width)]
          : [rect.x - origin.x, rect.x + rect.width - origin.x];
  return values.filter((value) => value > 0);
}

/**
 * Distances from `origin` to the nearest element edge in each direction.
 *
 * Two readings are combined. The walk steps outward and reports where the
 * topmost element changes, which finds the boundary of whatever is painted
 * under the pointer. `stackRects` carries the boxes of every element the
 * pointer is inside, and their own edges are taken into account too: a wrapper
 * whose inner box ends before the hit test changes has a real edge there, and
 * the nearest edge is the one a designer is asking about (tester finding F10).
 *
 * A direction with nothing found within range reports the distance the search
 * covered with `found: false`, so the caller can draw the guide and still say
 * the edge was not reached. It never reports a number it did not observe.
 */
export function nearestEdges(
  sample: EdgeSampler,
  origin: { x: number; y: number },
  viewport: Viewport,
  step: number = EDGE_STEP,
  stackRects: readonly EdgeRect[] = [],
): NearestEdges {
  const stride = Math.max(1, step);
  const start = sample(origin.x, origin.y);

  const walk = (direction: EdgeDirection, dx: number, dy: number): EdgeDistance => {
    const limit = limitFor(direction, origin, viewport);
    let best: EdgeDistance = { distance: limit, found: false };

    if (start) {
      for (let distance = stride; distance <= limit; distance += stride) {
        const found = sample(origin.x + dx * distance, origin.y + dy * distance);
        if (found !== start) {
          best = { distance, found: true };
          break;
        }
      }
    }

    for (const rect of stackRects) {
      for (const distance of rectDistances(direction, origin, rect)) {
        if (distance > limit) continue;
        if (best.found && distance >= best.distance) continue;
        if (!best.found && distance > best.distance) continue;
        best = { distance, found: true };
      }
    }

    return best;
  };

  const [top, right, bottom, left] = DIRECTIONS.map((entry) =>
    walk(entry.key, entry.dx, entry.dy),
  ) as [EdgeDistance, EdgeDistance, EdgeDistance, EdgeDistance];

  return { top, right, bottom, left, hasOrigin: start !== null };
}

/** The clipboard text for a point-to-edge reading. */
export function edgesCopyText(edges: NearestEdges): string {
  const part = (name: EdgeDirection): string => {
    const value = edges[name];
    return `${name}: ${value.found ? `${value.distance}px` : `>${value.distance}px`}`;
  };
  return `${(['top', 'right', 'bottom', 'left'] as const).map(part).join(', ')} (${EDGE_METHOD_LABEL})`;
}
