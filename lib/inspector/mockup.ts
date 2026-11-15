


























import type { MockupState } from '../messages';

export const MOCKUP_HOST_TAG = 'design-inspector-mockup';


const MOCKUP_Z_INDEX = 2147483646;


const NUDGE_PX = 1;
const NUDGE_SHIFT_PX = 10;

export type MockupSettings = Omit<MockupState, 'dataUrl'>;

export interface MockupCallbacks {




  onStateChange(state: MockupSettings): void;
}

export interface MockupLayer {
  host: HTMLElement;
  root: ShadowRoot;





  dragStart(point: { x: number; y: number }): boolean;
  dragMove(point: { x: number; y: number }): void;
  dragEnd(): void;

  set(mockup: MockupState | null): void;

  current(): MockupSettings | null;

  reposition(): void;

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
