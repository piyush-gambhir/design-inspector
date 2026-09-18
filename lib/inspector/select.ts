// Pointer, keyboard, and observer wiring (PRD INS-02, INS-03, INS-05, INS-06).
//
// While the mode is `active` every pointer and click event that targets the
// page is swallowed in the capture phase, so a selection click never also
// follows a link or submits a form. `paused` keeps the overlay and the pinned
// card but removes that interception; `off` removes everything.

import type { InspectorMode } from '../messages';

/** Ignore refreshes for this long after a copy so the value cannot move. */
const COPY_QUIET_MS = 1000;
const MUTATION_DEBOUNCE_MS = 150;
const MAX_OBSERVED_ANCESTORS = 12;

const INTERCEPTED_EVENTS = [
  'click',
  'auxclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
] as const;

export interface SelectionCallbacks {
  owns(node: Node | null | undefined): boolean;
  onHover(element: Element | null): void;
  /**
   * `point` is where the click landed, in viewport coordinates. The selection
   * rules need it: a click on a full-tile link is about the heading under the
   * pointer, not about the tile (tester UX note 6).
   */
  onPin(element: Element, point: { x: number; y: number }): void;
  onEscape(): void;
  onViewportChange(): void;
  onRefreshPinned(): void;
  onPinnedRemoved(): void;
  onNavigate(direction: 'up' | 'down'): void;
  onReread(): void;
  /** Alt+O while inspecting. */
  onToggleOutlines(): void;
  /**
   * Alt held with something pinned: the element to measure against, or null
   * when the pointer is over nothing measurable (PRD LAY-02).
   */
  onMeasureTarget(element: Element | null): void;
  /** Alt released. A locked measurement is the callee's to keep. */
  onMeasureEnd(): void;
  /** Alt+click: hold the current measurement so the labels can be read. */
  onMeasureLock(element: Element): void;
  /**
   * Shift held while inspecting: measure from the pointer to the nearest
   * element edge in each direction (competitive Tier 2 item 3). Null ends it.
   * Shift is deliberately not Alt: Alt is element-to-element (PRD LAY-02).
   */
  onEdgeProbe(point: { x: number; y: number } | null): void;
  /** Shift+click: hold the current edge reading until Escape. */
  onEdgeLock(point: { x: number; y: number }): void;
  /**
   * The mockup image is `pointer-events: none` so it can never swallow an
   * inspection click, which means its drag has to be driven from here.
   * Returns true when an unlocked mockup was under the point and took the
   * pointer; false falls through to normal selection.
   */
  mockupDragStart(point: { x: number; y: number }): boolean;
  mockupDragMove(point: { x: number; y: number }): void;
  mockupDragEnd(): void;
  pinnedElement(): Element | null;
  panelHasFocus(): boolean;
  /** False while the user is selecting text in our panel or just copied. */
  mayRefresh(): boolean;
  /** True while an edge reading is locked, so Shift-release must not clear it. */
  edgesLocked(): boolean;
}

export interface SelectionController {
  setMode(mode: InspectorMode): void;
  watch(element: Element | null): void;
  destroy(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (!element || typeof (element as Element).tagName !== 'string') return false;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  const html = element as HTMLElement;
  if (html.isContentEditable) return true;
  try {
    return !!element.closest('[contenteditable=""], [contenteditable="true"]');
  } catch {
    return false;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SVG_ANCESTORS = 50;

/**
 * The outermost `<svg>` around an SVG element, so clicking an icon selects the
 * icon and not one of its paths. Elements outside the SVG namespace (HTML
 * inside `<foreignObject>`, anything else) are returned untouched, and an
 * `<svg>` nested in another `<svg>` resolves to the outer one. The inner node
 * stays reachable with ArrowDown.
 */
export function snapToSvgRoot(element: Element): Element {
  if (element.namespaceURI !== SVG_NS) return element;

  let outermost: Element | null = null;
  let current: Element | null = element;
  for (let depth = 0; current && depth < MAX_SVG_ANCESTORS; depth += 1) {
    if (current.namespaceURI === SVG_NS && current.tagName.toLowerCase() === 'svg') {
      outermost = current;
    }
    current = current.parentElement;
  }
  return outermost ?? element;
}

/**
 * The eligible element under the pointer. Extension UI is skipped and open
 * shadow roots are descended into (PRD 16.2).
 */
export function elementAtPoint(
  x: number,
  y: number,
  owns: (node: Node | null | undefined) => boolean,
): Element | null {
  // `elementsFromPoint` walks the whole stack under the pointer and allocates
  // an array for it. The answer is almost always the topmost element, so the
  // single hit test is tried first and the full stack is only built when the
  // top of it is our own UI or the document element (PERF 3).
  let target: Element | null = null;
  try {
    const top = document.elementFromPoint(x, y);
    if (top && !owns(top) && top.tagName.toLowerCase() !== 'html') target = top;
  } catch {
    // An engine without the single-point form, jsdom included, falls through.
    target = null;
  }

  if (!target) {
    let candidates: Element[] = [];
    try {
      candidates = Array.from(document.elementsFromPoint(x, y));
    } catch {
      return null;
    }
    for (const candidate of candidates) {
      if (owns(candidate)) continue;
      const tag = candidate.tagName.toLowerCase();
      if (tag === 'html') continue;
      target = candidate;
      break;
    }
    if (!target) {
      target = candidates.find((candidate) => !owns(candidate)) ?? null;
    }
  }
  if (!target) return null;

  let current: Element = target;
  for (let depth = 0; depth < 10; depth += 1) {
    const shadow = current.shadowRoot;
    if (!shadow) break;
    let inner: Element | null = null;
    try {
      inner = shadow.elementFromPoint(x, y);
    } catch {
      inner = null;
    }
    if (!inner || inner === current || owns(inner)) break;
    current = inner;
  }
  return snapToSvgRoot(current);
}

export function createSelection(callbacks: SelectionCallbacks): SelectionController {
  let mode: InspectorMode = 'off';
  let pointerFrame = 0;
  let viewportFrame = 0;
  let mutationTimer = 0;
  let lastPoint: { x: number; y: number } | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let watched: Element | null = null;
  /** True while Alt is held with an element pinned. */
  let measuring = false;
  /** True while Shift is held: point-to-edge, which needs nothing pinned. */
  let probingEdges = false;

  /** True while an unlocked mockup image is being dragged by the pointer. */
  let mockupDragging = false;

  /**
   * The element the last hover frame resolved to. A pointer crossing a wide
   * element produces sixty identical answers a second; re-reading and
   * re-rendering the same element sixty times is the single largest avoidable
   * cost in the hover path, so an unchanged answer stops here (PERF 3).
   */
  let hoveredElement: Element | null = null;
  const forgetHover = (): void => {
    hoveredElement = null;
  };

  /** Measurement needs a pinned element to measure from; Alt alone does nothing. */
  const mayMeasure = (): boolean => mode === 'active' && callbacks.pinnedElement() !== null;

  /** Drops a hover frame that has been scheduled but has not run yet. */
  const cancelPointerFrame = (): void => {
    if (!pointerFrame) return;
    window.cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
  };

  const measureAt = (point: { x: number; y: number }): void => {
    const element = elementAtPoint(point.x, point.y, callbacks.owns);
    const pinned = callbacks.pinnedElement();
    callbacks.onMeasureTarget(element && element !== pinned ? element : null);
  };

  const onPointerMove = (event: PointerEvent | MouseEvent): void => {
    if (mode !== 'active') return;
    lastPoint = { x: event.clientX, y: event.clientY };
    // Alt can be held before the pointer moves, and it can also be pressed
    // outside our keydown handler's reach, so the modifier is read off the
    // pointer event as well.
    if (event.altKey && mayMeasure()) measuring = true;
    // A keyup can be missed (a release outside the window, a system shortcut),
    // so the pointer's own modifier state is what ends measure mode too.
    else if (!event.altKey && measuring) endMeasure();

    // Shift is read the same way, and it wins over nothing: Alt is still
    // element-to-element, so a pointer holding both measures elements.
    if (event.shiftKey && !event.altKey) probingEdges = true;
    else if (!event.shiftKey && probingEdges) endEdgeProbe();

    if (pointerFrame) return;
    pointerFrame = window.requestAnimationFrame(() => {
      pointerFrame = 0;
      if (mode !== 'active' || !lastPoint) return;
      if (measuring && mayMeasure()) {
        measureAt(lastPoint);
        return;
      }
      if (probingEdges) {
        // The hover card would sit on top of the guides it is describing.
        callbacks.onHover(null);
        callbacks.onEdgeProbe(lastPoint);
        return;
      }
      const element = elementAtPoint(lastPoint.x, lastPoint.y, callbacks.owns);
      if (element === hoveredElement) return;
      hoveredElement = element;
      callbacks.onHover(element);
    });
  };

  /**
   * Alt+click and Shift+click lock what is on screen. The measurement and the
   * edge reading are both drawn from the point under the pointer with our own
   * nodes skipped, so a modifier click that lands on our panel or badge is
   * about the page underneath it and has to lock the same thing a click on the
   * page would (tester finding F5). Only a plain click on our UI is our UI's.
   */
  const lockFromModifierClick = (mouse: MouseEvent): boolean => {
    if (mouse.shiftKey && !mouse.altKey) {
      callbacks.onEdgeLock({ x: mouse.clientX, y: mouse.clientY });
      return true;
    }
    if (!mouse.altKey) return false;
    const element = elementAtPoint(mouse.clientX, mouse.clientY, callbacks.owns);
    if (!element) return false;
    if (!mayMeasure() || element === callbacks.pinnedElement()) return false;
    callbacks.onMeasureLock(element);
    return true;
  };

  const onInterceptedEvent = (event: Event): void => {
    if (mode !== 'active') return;

    if (callbacks.owns(event.target as Node | null)) {
      // Our own controls keep every plain pointer event: the panel drag, the
      // badge buttons, and text selection inside the panel all depend on it.
      if (event.type !== 'click') return;
      const ours = event as MouseEvent;
      if (!ours.altKey && !ours.shiftKey) return;
      // A pending hover frame would repaint over the lock we are about to set.
      cancelPointerFrame();
      if (!lockFromModifierClick(ours)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.type !== 'click') return;
    const mouse = event as MouseEvent;
    // A move scheduled earlier in this frame has not run yet. Letting it run
    // after the lock would retarget the measurement and drop the lock with it
    // (tester finding F1), so the frame is dropped before anything is locked.
    if (mouse.altKey || mouse.shiftKey) cancelPointerFrame();
    // Shift+click locks the edge reading so the four labels can be read and
    // copied. It never pins, so the selection is left alone.
    if (mouse.shiftKey && !mouse.altKey) {
      callbacks.onEdgeLock({ x: mouse.clientX, y: mouse.clientY });
      return;
    }
    const element = elementAtPoint(mouse.clientX, mouse.clientY, callbacks.owns);
    if (!element) return;
    // Alt+click locks the measurement instead of pinning a new element; a
    // plain click pins, which is also what releases a locked measurement.
    if (mouse.altKey && mayMeasure() && element !== callbacks.pinnedElement()) {
      callbacks.onMeasureLock(element);
      return;
    }
    callbacks.onPin(element, { x: mouse.clientX, y: mouse.clientY });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (mode === 'off') return;
    if (isEditableTarget(event.target)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onEscape();
      return;
    }

    // Alt+O toggles layout outlines from anywhere on the page. `code` is read
    // first because Alt+O produces 'ø' on a Mac layout.
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.code === 'KeyO' || event.key.toLowerCase() === 'o')
    ) {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onToggleOutlines();
      return;
    }

    // Holding Alt over a second element measures against the pinned one.
    // Nothing pinned means Alt does nothing at all.
    if (
      event.key === 'Alt' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !measuring &&
      mayMeasure()
    ) {
      measuring = true;
      if (lastPoint) measureAt(lastPoint);
      return;
    }

    // Holding Shift measures from the pointer to the nearest element edges.
    // It needs nothing pinned, which is the whole point of the second mode.
    if (
      event.key === 'Shift' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !probingEdges &&
      mode === 'active'
    ) {
      probingEdges = true;
      if (lastPoint) {
        callbacks.onHover(null);
        callbacks.onEdgeProbe(lastPoint);
      }
      return;
    }

    if (!callbacks.panelHasFocus()) return;

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      callbacks.onNavigate('up');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      callbacks.onNavigate('down');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      callbacks.onReread();
    }
  };

  const endMeasure = (): void => {
    if (!measuring) return;
    measuring = false;
    // The hover card was hidden while measuring, so the next frame has to draw
    // it again even if the pointer never left the element.
    forgetHover();
    callbacks.onMeasureEnd();
  };

  /** Releasing Shift ends the probe unless the user locked the reading. */
  const endEdgeProbe = (): void => {
    if (!probingEdges) return;
    probingEdges = false;
    forgetHover();
    if (callbacks.edgesLocked()) return;
    callbacks.onEdgeProbe(null);
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (mode === 'off') return;
    if (event.key === 'Alt' || !event.altKey) endMeasure();
    if (event.key === 'Shift' || !event.shiftKey) endEdgeProbe();
  };

  /** Alt+Tab and friends take the key release with them. */
  const onWindowBlur = (): void => {
    endMeasure();
    endEdgeProbe();
  };

  // ---------------------------------------------------------------------------
  // Mockup dragging (tester finding F4)
  //
  // The mockup image never takes pointer events of its own: an image that did
  // would swallow the inspection click for everything it covers, which is the
  // whole page. The drag is driven from here instead, and only while the
  // inspector is not `active`: an active inspector's clicks belong to the
  // selection, so the comp is moved from the Tools tab, with the arrow keys, or
  // after pressing "Interact with page".

  const onMockupPointerDown = (event: PointerEvent): void => {
    if (mockupDragging) return;
    if (mode === 'active') return;
    if (event.button !== undefined && event.button !== 0) return;
    if (!callbacks.mockupDragStart({ x: event.clientX, y: event.clientY })) return;
    mockupDragging = true;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onMockupPointerMove = (event: PointerEvent): void => {
    if (!mockupDragging) return;
    callbacks.mockupDragMove({ x: event.clientX, y: event.clientY });
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onMockupPointerUp = (event: PointerEvent): void => {
    if (!mockupDragging) return;
    mockupDragging = false;
    callbacks.mockupDragEnd();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  function addMockupListeners(): void {
    window.addEventListener('pointerdown', onMockupPointerDown, { capture: true });
    window.addEventListener('pointermove', onMockupPointerMove, { capture: true });
    window.addEventListener('pointerup', onMockupPointerUp, { capture: true });
    window.addEventListener('pointercancel', onMockupPointerUp, { capture: true });
  }

  function removeMockupListeners(): void {
    window.removeEventListener('pointerdown', onMockupPointerDown, { capture: true });
    window.removeEventListener('pointermove', onMockupPointerMove, { capture: true });
    window.removeEventListener('pointerup', onMockupPointerUp, { capture: true });
    window.removeEventListener('pointercancel', onMockupPointerUp, { capture: true });
    if (mockupDragging) {
      mockupDragging = false;
      callbacks.mockupDragEnd();
    }
  }

  const onViewportChange = (): void => {
    if (mode === 'off') return;
    if (viewportFrame) return;
    viewportFrame = window.requestAnimationFrame(() => {
      viewportFrame = 0;
      callbacks.onViewportChange();
    });
  };

  const scheduleRefresh = (): void => {
    if (mutationTimer) window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => {
      mutationTimer = 0;
      const pinned = callbacks.pinnedElement();
      if (!pinned) return;
      if (!pinned.isConnected) {
        callbacks.onPinnedRemoved();
        return;
      }
      if (!callbacks.mayRefresh()) return;
      callbacks.onRefreshPinned();
    }, MUTATION_DEBOUNCE_MS);
  };

  function addPointerListeners(): void {
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    for (const type of INTERCEPTED_EVENTS) {
      window.addEventListener(type, onInterceptedEvent, { capture: true });
    }
  }

  function removePointerListeners(): void {
    window.removeEventListener('pointermove', onPointerMove, { capture: true });
    for (const type of INTERCEPTED_EVENTS) {
      window.removeEventListener(type, onInterceptedEvent, { capture: true });
    }
    cancelPointerFrame();
  }

  function addAmbientListeners(): void {
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function removeAmbientListeners(): void {
    window.removeEventListener('scroll', onViewportChange, { capture: true });
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
    window.removeEventListener('blur', onWindowBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    measuring = false;
    forgetHover();
    probingEdges = false;
    if (viewportFrame) {
      window.cancelAnimationFrame(viewportFrame);
      viewportFrame = 0;
    }
  }

  /**
   * Disconnect the observers without forgetting what they were watching, so a
   * tab coming back to the foreground can pick the same element up again.
   */
  function detachObservers(): void {
    resizeObserver?.disconnect();
    resizeObserver = null;
    mutationObserver?.disconnect();
    mutationObserver = null;
    if (mutationTimer) {
      window.clearTimeout(mutationTimer);
      mutationTimer = 0;
    }
  }

  function stopObservers(): void {
    detachObservers();
    watched = null;
  }

  /** Observe the pinned element and up to twelve of its ancestors (INS-06). */
  function attachObservers(element: Element): void {
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => scheduleRefresh());
      try {
        resizeObserver.observe(element);
      } catch {
        resizeObserver = null;
      }
    }

    if (typeof MutationObserver === 'function') {
      mutationObserver = new MutationObserver(() => scheduleRefresh());
      const targets: Element[] = [element];
      let current = element.parentElement;
      while (current && targets.length < MAX_OBSERVED_ANCESTORS) {
        targets.push(current);
        current = current.parentElement;
      }
      for (const target of targets) {
        try {
          mutationObserver.observe(target, {
            attributes: true,
            attributeFilter: ['class', 'style'],
            childList: true,
          });
        } catch {
          // Skip a target that cannot be observed.
        }
      }
    }
  }

  /**
   * A hidden document cannot be looked at, so nothing needs to be kept live
   * for it: the observers come off and the pending refresh is dropped. They
   * come back when the tab does (PERF 3).
   */
  const onVisibilityChange = (): void => {
    if (document.hidden) {
      detachObservers();
      return;
    }
    if (!watched || mode === 'off' || mutationObserver || resizeObserver) return;
    if (!watched.isConnected) return;
    attachObservers(watched);
    // The page may have moved on while the tab was in the background.
    scheduleRefresh();
  };

  const controller: SelectionController = {
    setMode(next) {
      if (next === mode) return;
      const previous = mode;
      mode = next;
      forgetHover();

      if (next === 'off') {
        removePointerListeners();
        removeAmbientListeners();
        stopObservers();
        return;
      }

      if (previous === 'off') addAmbientListeners();

      if (next === 'active') {
        addPointerListeners();
      } else {
        // Pausing hands the page back to the user, measurement included.
        endMeasure();
        endEdgeProbe();
        removePointerListeners();
      }
    },

    /**
     * Observes the pinned element for live readings (PRD INS-06). Nothing
     * pinned means no observers at all, and a hidden document has none either.
     */
    watch(element) {
      // Pinning and unpinning both change what the hover card should show.
      forgetHover();
      if (watched === element) return;
      stopObservers();
      watched = element;
      if (!element || mode === 'off' || document.hidden) return;
      attachObservers(element);
    },

    destroy() {
      mode = 'off';
      removePointerListeners();
      removeAmbientListeners();
      removeMockupListeners();
      stopObservers();
    },
  };

  // A mockup can be on the page with the inspector off or paused, which is
  // exactly when it is draggable, so these listeners are not tied to the mode.
  addMockupListeners();

  return controller;
}

export { COPY_QUIET_MS };
