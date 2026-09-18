// Pixel-perfect mockup overlay (competitive Tier 2 item 1, PerfectPixel
// territory).
//
// A reference image laid over the page in document coordinates, at adjustable
// opacity, offset, scale and blend. The side panel owns the file and the
// persistence; this module owns the pixels.
//
// Why its own shadow host rather than a layer in the main overlay root: the
// inspector host is `position: fixed` with a z-index, which makes it a stacking
// context, and a stacking context is an isolated group for blending. An image
// inside it with `mix-blend-mode: difference` would blend against the overlay's
// own transparent backdrop, which is the identity operation, and the difference
// toggle would silently do nothing. This host generates no box of its own
// (`display: contents`), so the image's own fixed positioning puts it in the
// document's root stacking context and `difference` compares against the page,
// which is the entire point of the feature. It sits one z-index below the
// inspector overlay, so the box-model bands still read on top of it, and far
// above anything a page paints, so the layout outlines stay underneath.
//
// Nothing here is written to the page: the host is ours, it is removed on
// teardown, and the image never becomes part of the inspected document.
//
// The image is `pointer-events: none` at all times, locked or not. An image
// that took pointer events would swallow every inspection click it covers, and
// a full page comp covers the page (tester finding F4). The drag is driven from
// select.ts instead, through `dragStart`, `dragMove` and `dragEnd`.

import type { MockupState } from '../messages';

export const MOCKUP_HOST_TAG = 'design-inspector-mockup';

/** One below the inspector overlay, so bands and labels stay readable. */
const MOCKUP_Z_INDEX = 2147483646;

/** Arrow-key nudge, and the larger step Shift asks for. */
const NUDGE_PX = 1;
const NUDGE_SHIFT_PX = 10;

export type MockupSettings = Omit<MockupState, 'dataUrl'>;

export interface MockupCallbacks {
  /**
   * The user moved the image on the page, by drag or by arrow key. The panel
   * persists the new offset; nothing else changes.
   */
  onStateChange(state: MockupSettings): void;
}

export interface MockupLayer {
  host: HTMLElement;
  root: ShadowRoot;
  /**
   * Takes the pointer when an unlocked, visible mockup is painted under the
   * point. False means nothing here belongs to the mockup and the caller should
   * carry on with whatever the pointer was going to do.
   */
  dragStart(point: { x: number; y: number }): boolean;
  dragMove(point: { x: number; y: number }): void;
  dragEnd(): void;
  /** Null clears the image and the state. */
  set(mockup: MockupState | null): void;
  /** The current settings, without the image. Null when there is no mockup. */
  current(): MockupSettings | null;
  /** Re-place the image after a scroll or a resize. */
  reposition(): void;
  /** Hidden for a screenshot or an eyedropper pick, without being forgotten. */
  setHostVisible(visible: boolean): void;
  owns(node: Node | null | undefined): boolean;
  destroy(): void;
}

const MOCKUP_STYLES = `
:host { all: initial; display: contents; }
#mockup {
  position: fixed;
  top: 0;
  left: 0;
  z-index: ${MOCKUP_Z_INDEX};
  transform-origin: top left;
  pointer-events: none;
  max-width: none;
  max-height: none;
  user-select: none;
  -webkit-user-drag: none;
}
#mockup[hidden] { display: none; }
/* The compositing hint exists only for the drag. A permanent will-change on a
   full-page image keeps a full-page texture in GPU memory for as long as the
   comp is on screen, which is exactly the cost this extension is not allowed
   to impose while nothing is moving (PERF 3). */
#mockup[data-dragging="true"] { will-change: transform; }
#mockup:focus-visible { outline: 2px solid oklch(0.62 0.17 255); outline-offset: 2px; }
`;

export function createMockupLayer(callbacks: MockupCallbacks): MockupLayer {
  const host = document.createElement(MOCKUP_HOST_TAG);
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'display:contents;';
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = MOCKUP_STYLES;
  root.appendChild(style);

  const image = document.createElement('img');
  image.id = 'mockup';
  image.alt = '';
  image.hidden = true;
  image.draggable = false;
  root.appendChild(image);

  (document.documentElement ?? document.body).appendChild(host);

  let state: MockupSettings | null = null;
  let dataUrl = '';
  let hostVisible = true;
  let drag: { startX: number; startY: number; originX: number; originY: number } | null = null;

  function place(): void {
    if (!state) return;
    // Document coordinates: the image is fixed, so the scroll offset is applied
    // here rather than by the browser. One assignment per axis, so a scroll
    // costs two style writes and no layout read.
    image.style.left = `${state.x - window.scrollX}px`;
    image.style.top = `${state.y - window.scrollY}px`;
  }

  function paint(): void {
    if (!state || !dataUrl) {
      image.hidden = true;
      image.removeAttribute('tabindex');
      return;
    }
    image.hidden = !state.visible || !hostVisible;
    image.style.opacity = String(state.opacity);
    image.style.mixBlendMode = state.blend === 'difference' ? 'difference' : 'normal';
    image.style.transform = `scale(${state.scale})`;
    image.dataset.locked = state.locked ? 'true' : 'false';
    // Only an unlocked mockup is a keyboard target: a locked one is scenery.
    if (state.locked) image.removeAttribute('tabindex');
    else image.tabIndex = 0;
    image.setAttribute(
      'aria-label',
      state.locked
        ? 'Mockup overlay, locked'
        : 'Mockup overlay, use arrow keys to move, or drag it while the inspector is paused',
    );
    place();
  }

  function commit(next: MockupSettings): void {
    state = next;
    paint();
    callbacks.onStateChange({ ...next });
  }

  /** The painted rect of the image, or null when nothing is painted. */
  function paintedRect(): { x: number; y: number; width: number; height: number } | null {
    if (!state || !dataUrl || image.hidden) return null;
    let rect: DOMRect;
    try {
      rect = image.getBoundingClientRect();
    } catch {
      return null;
    }
    if (rect.width <= 0 && rect.height <= 0) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  image.addEventListener('keydown', (event) => {
    if (!state || state.locked) return;
    const step = event.shiftKey ? NUDGE_SHIFT_PX : NUDGE_PX;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    event.stopPropagation();
    commit({ ...state, x: state.x + dx, y: state.y + dy });
  });

  return {
    host,
    root,

    dragStart(point) {
      if (!state || state.locked || !state.visible || !hostVisible) return false;
      const rect = paintedRect();
      if (!rect) return false;
      if (
        point.x < rect.x ||
        point.y < rect.y ||
        point.x > rect.x + rect.width ||
        point.y > rect.y + rect.height
      ) {
        return false;
      }
      drag = { startX: point.x, startY: point.y, originX: state.x, originY: state.y };
      image.dataset.dragging = 'true';
      return true;
    },

    dragMove(point) {
      if (!drag || !state) return;
      state = {
        ...state,
        x: Math.round(drag.originX + (point.x - drag.startX)),
        y: Math.round(drag.originY + (point.y - drag.startY)),
      };
      place();
    },

    dragEnd() {
      if (!drag || !state) {
        drag = null;
        delete image.dataset.dragging;
        return;
      }
      drag = null;
      delete image.dataset.dragging;
      // One state message per drag, at the end, rather than one per pixel.
      commit(state);
    },

    set(mockup) {
      if (!mockup) {
        state = null;
        dataUrl = '';
        drag = null;
        delete image.dataset.dragging;
        image.removeAttribute('src');
        paint();
        return;
      }
      const { dataUrl: nextUrl, ...settings } = mockup;
      // Re-assigning the same src would restart the decode and flash the image.
      if (nextUrl !== dataUrl) {
        dataUrl = nextUrl;
        image.src = nextUrl;
      }
      state = settings;
      paint();
    },

    current() {
      return state ? { ...state } : null;
    },

    reposition() {
      place();
    },

    setHostVisible(visible) {
      hostVisible = visible;
      paint();
    },

    owns(node) {
      if (!node) return false;
      let current: Node | null = node;
      while (current) {
        if (current === host || current === root) return true;
        current = current.parentNode ?? ((current as { host?: Node }).host ?? null);
      }
      return false;
    },

    destroy() {
      host.remove();
    },
  };
}
