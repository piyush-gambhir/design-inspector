






















export const EDGE_STEP = 4;


export const EDGE_MAX_DISTANCE = 2000;


export const EDGE_METHOD_LABEL = 'Nearest element edges, geometric';

export type EdgeDirection = 'top' | 'right' | 'bottom' | 'left';

export interface EdgeDistance {

  distance: number;

  found: boolean;
}

export interface NearestEdges {
  top: EdgeDistance;
  right: EdgeDistance;
  bottom: EdgeDistance;
  left: EdgeDistance;

  hasOrigin: boolean;
}

export type EdgeSampler = (x: number, y: number) => Element | null;

export interface Viewport {
  width: number;
  height: number;
}


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


export function edgesCopyText(edges: NearestEdges): string {
  const part = (name: EdgeDirection): string => {
    const value = edges[name];
    return `${name}: ${value.found ? `${value.distance}px` : `>${value.distance}px`}`;
  };
  return `${(['top', 'right', 'bottom', 'left'] as const).map(part).join(', ')} (${EDGE_METHOD_LABEL})`;
}
