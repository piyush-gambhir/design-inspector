import { describe, expect, it } from 'vitest';

import {
  EDGE_MAX_DISTANCE,
  EDGE_METHOD_LABEL,
  EDGE_STEP,
  edgesCopyText,
  nearestEdges,
  type EdgeSampler,
} from '../lib/inspector/edges';

const VIEWPORT = { width: 1000, height: 800 };

/**
 * A sampler over axis-aligned rectangles, topmost last, so a test can describe
 * a page as boxes instead of as a DOM.
 */
function samplerFor(
  boxes: { element: Element; x: number; y: number; width: number; height: number }[],
): EdgeSampler {
  return (x, y) => {
    let hit: Element | null = null;
    for (const box of boxes) {
      if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) {
        hit = box.element;
      }
    }
    return hit;
  };
}

function el(id: string): Element {
  const node = document.createElement('div');
  node.id = id;
  return node;
}

describe('nearestEdges', () => {
  it('finds the four edges of the box under the pointer', () => {
    const page = el('page');
    const card = el('card');
    const sample = samplerFor([
      { element: page, x: 0, y: 0, width: 1200, height: 900 },
      { element: card, x: 100, y: 200, width: 300, height: 160 },
    ]);

    // Pointer at the middle of the card, which spans 100..400 by 200..360.
    // Every distance is the first 4px sample that left the card.
    const edges = nearestEdges(sample, { x: 250, y: 280 }, VIEWPORT);
    expect(edges.hasOrigin).toBe(true);
    expect(edges.top).toEqual({ distance: 84, found: true });
    expect(edges.bottom).toEqual({ distance: 80, found: true });
    expect(edges.left).toEqual({ distance: 152, found: true });
    expect(edges.right).toEqual({ distance: 152, found: true });
  });

  it('reports distances on the sampling step, never between two samples', () => {
    const page = el('page');
    const card = el('card');
    const sample = samplerFor([
      { element: page, x: 0, y: 0, width: 1200, height: 900 },
      // The card's right edge at 253 is not a multiple of the step, so the
      // first sample past it is what gets reported.
      { element: card, x: 100, y: 200, width: 153, height: 160 },
    ]);
    const edges = nearestEdges(sample, { x: 200, y: 280 }, VIEWPORT);
    expect(edges.right.found).toBe(true);
    expect(edges.right.distance % EDGE_STEP).toBe(0);
    expect(edges.right.distance).toBe(56);
  });

  it('stops at the viewport rather than sampling outside it', () => {
    const page = el('page');
    const sample = samplerFor([{ element: page, x: 0, y: 0, width: 1200, height: 900 }]);
    const edges = nearestEdges(sample, { x: 20, y: 30 }, VIEWPORT);
    expect(edges.left).toEqual({ distance: 20, found: false });
    expect(edges.top).toEqual({ distance: 30, found: false });
    expect(edges.right).toEqual({ distance: 980, found: false });
    expect(edges.bottom).toEqual({ distance: 770, found: false });
  });

  it('never walks further than the maximum, however large the viewport', () => {
    const page = el('page');
    const sample = samplerFor([{ element: page, x: 0, y: 0, width: 100_000, height: 100_000 }]);
    const edges = nearestEdges(sample, { x: 50_000, y: 50_000 }, { width: 100_000, height: 100_000 });
    expect(edges.right.distance).toBe(EDGE_MAX_DISTANCE);
    expect(edges.right.found).toBe(false);
  });

  it('says so when there is nothing under the pointer at all', () => {
    const edges = nearestEdges(() => null, { x: 10, y: 10 }, VIEWPORT);
    expect(edges.hasOrigin).toBe(false);
    expect(edges.top.found).toBe(false);
    expect(edges.bottom.found).toBe(false);
  });

  it('counts a change to a different element as an edge, in either direction', () => {
    const left = el('left');
    const right = el('right');
    const sample = samplerFor([
      { element: left, x: 0, y: 0, width: 400, height: 900 },
      { element: right, x: 400, y: 0, width: 800, height: 900 },
    ]);
    // Sitting in `left`, the boundary at 400 is the right edge; going left
    // there is no boundary before the viewport.
    const edges = nearestEdges(sample, { x: 300, y: 100 }, VIEWPORT);
    expect(edges.right).toEqual({ distance: 100, found: true });
    expect(edges.left).toEqual({ distance: 300, found: false });
  });
});

describe('edgesCopyText', () => {
  it('marks an unconfirmed distance as a lower bound and names the method', () => {
    const page = el('page');
    const sample = samplerFor([{ element: page, x: 0, y: 0, width: 1200, height: 900 }]);
    const text = edgesCopyText(nearestEdges(sample, { x: 20, y: 30 }, VIEWPORT));
    expect(text).toContain('top: >30px');
    expect(text).toContain('left: >20px');
    expect(text).toContain(EDGE_METHOD_LABEL);
  });
});

describe('nearestEdges with the stack under the pointer (F10)', () => {
  it('takes a wrapper box edge that is closer than the hit-test change', () => {
    const page = el('page');
    const wrapper = el('wrapper');
    // The wrapper paints the same colour as the page and holds nothing else,
    // so the hit test only changes at the page's own boundary. Its box ends
    // long before that, and its edge is the one a designer is asking about.
    const sample = samplerFor([{ element: page, x: 0, y: 0, width: 2000, height: 1600 }]);
    void wrapper;

    const bare = nearestEdges(sample, { x: 500, y: 400 }, VIEWPORT);
    expect(bare.right).toEqual({ distance: 500, found: false });

    const withStack = nearestEdges(sample, { x: 500, y: 400 }, VIEWPORT, undefined, [
      { x: 0, y: 0, width: 2000, height: 1600 },
      { x: 400, y: 300, width: 200, height: 200 },
    ]);
    // The inner box spans 400..600 by 300..500 around a pointer at 500,400.
    expect(withStack.right).toEqual({ distance: 100, found: true });
    expect(withStack.left).toEqual({ distance: 100, found: true });
    expect(withStack.top).toEqual({ distance: 100, found: true });
    expect(withStack.bottom).toEqual({ distance: 100, found: true });
  });

  it('keeps the hit-test answer when it is the nearer of the two', () => {
    const page = el('page');
    const card = el('card');
    const sample = samplerFor([
      { element: page, x: 0, y: 0, width: 1000, height: 800 },
      { element: card, x: 100, y: 200, width: 300, height: 160 },
    ]);

    // The outer box's edges are far away, so the card's own walk still wins.
    const edges = nearestEdges(sample, { x: 250, y: 280 }, VIEWPORT, undefined, [
      { x: 0, y: 0, width: 1000, height: 800 },
    ]);
    expect(edges.top).toEqual({ distance: 84, found: true });
    expect(edges.right).toEqual({ distance: 152, found: true });
  });

  it('ignores a rect edge that lies outside the viewport room', () => {
    const page = el('page');
    const sample = samplerFor([{ element: page, x: 0, y: 0, width: 4000, height: 800 }]);
    const edges = nearestEdges(sample, { x: 20, y: 400 }, VIEWPORT, undefined, [
      { x: -500, y: 0, width: 4000, height: 800 },
    ]);
    // The rect's left edge is 520px away and only 20px of room exists.
    expect(edges.left).toEqual({ distance: 20, found: false });
  });

  it('never reports a distance of zero for a rect the pointer sits on', () => {
    const page = el('page');
    const sample = samplerFor([{ element: page, x: 0, y: 0, width: 1000, height: 800 }]);
    const edges = nearestEdges(sample, { x: 400, y: 300 }, VIEWPORT, undefined, [
      { x: 400, y: 300, width: 200, height: 200 },
    ]);
    // Left and top edges are exactly at the pointer, so they are not "beyond"
    // it and the walk's own answer stands.
    expect(edges.left.found).toBe(false);
    expect(edges.top.found).toBe(false);
    expect(edges.right).toEqual({ distance: 200, found: true });
  });
});
