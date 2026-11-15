






import type { InspectorMode } from '../messages';


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





  onPin(element: Element, point: { x: number; y: number }): void;
  onEscape(): void;
  onViewportChange(): void;
  onRefreshPinned(): void;
  onPinnedRemoved(): void;
  onNavigate(direction: 'up' | 'down'): void;
  onReread(): void;

  onToggleOutlines(): void;




  onMeasureTarget(element: Element | null): void;

  onMeasureEnd(): void;

  onMeasureLock(element: Element): void;





  onEdgeProbe(point: { x: number; y: number } | null): void;

  onEdgeLock(point: { x: number; y: number }): void;






  mockupDragStart(point: { x: number; y: number }): boolean;
  mockupDragMove(point: { x: number; y: number }): void;
  mockupDragEnd(): void;
  pinnedElement(): Element | null;
  panelHasFocus(): boolean;

  mayRefresh(): boolean;

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





export function elementAtPoint(
  x: number,
  y: number,
  owns: (node: Node | null | undefined) => boolean,
): Element | null {




  let target: Element | null = null;
  try {
    const top = document.elementFromPoint(x, y);
    if (top && !owns(top) && top.tagName.toLowerCase() !== 'html') target = top;
  } catch {

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

  let measuring = false;

  let probingEdges = false;


  let mockupDragging = false;







  let hoveredElement: Element | null = null;
  const forgetHover = (): void => {
    hoveredElement = null;
  };


  const mayMeasure = (): boolean => mode === 'active' && callbacks.pinnedElement() !== null;


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



    if (event.altKey && mayMeasure()) measuring = true;


    else if (!event.altKey && measuring) endMeasure();



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


      if (event.type !== 'click') return;
      const ours = event as MouseEvent;
      if (!ours.altKey && !ours.shiftKey) return;

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



    if (mouse.altKey || mouse.shiftKey) cancelPointerFrame();


    if (mouse.shiftKey && !mouse.altKey) {
      callbacks.onEdgeLock({ x: mouse.clientX, y: mouse.clientY });
      return;
    }
    const element = elementAtPoint(mouse.clientX, mouse.clientY, callbacks.owns);
    if (!element) return;


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


    forgetHover();
    callbacks.onMeasureEnd();
  };


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


  const onWindowBlur = (): void => {
    endMeasure();
    endEdgeProbe();
  };











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

        }
      }
    }
  }






  const onVisibilityChange = (): void => {
    if (document.hidden) {
      detachObservers();
      return;
    }
    if (!watched || mode === 'off' || mutationObserver || resizeObserver) return;
    if (!watched.isConnected) return;
    attachObservers(watched);

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

        endMeasure();
        endEdgeProbe();
        removePointerListeners();
      }
    },





    watch(element) {

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



  addMockupListeners();

  return controller;
}

export { COPY_QUIET_MS };
