import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSelection, elementAtPoint, snapToSvgRoot } from '../lib/inspector/select';

const original = document.elementsFromPoint;

function stack(...elements: Element[]): void {
  document.elementsFromPoint = () => [...elements, document.body, document.documentElement];
}

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * Every controller built by a test, so a failing assertion cannot leave its
 * window listeners behind to swallow the next test's events.
 */
const controllers: { destroy(): void }[] = [];

afterEach(() => {
  while (controllers.length > 0) controllers.pop()?.destroy();
  document.elementsFromPoint = original;
  vi.restoreAllMocks();
});

describe('elementAtPoint', () => {
  it('returns the topmost page element', () => {
    document.body.innerHTML = '<p id="target">Hello</p>';
    const target = document.getElementById('target') as Element;
    stack(target);
    expect(elementAtPoint(5, 5, () => false)).toBe(target);
  });

  it('skips extension owned elements', () => {
    document.body.innerHTML = '<design-inspector-host></design-inspector-host><p id="target">Hi</p>';
    const host = document.querySelector('design-inspector-host') as Element;
    const target = document.getElementById('target') as Element;
    stack(host, target);
    expect(elementAtPoint(5, 5, (node) => node === host)).toBe(target);
  });

  it('descends into an open shadow root', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span id="inner">Inside</span>';
    const inner = shadow.getElementById('inner') as Element;
    shadow.elementFromPoint = () => inner;
    stack(host);
    expect(elementAtPoint(5, 5, () => false)).toBe(inner);
  });

  it('stops descending when the shadow hit is our own node', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<span id="inner">Inside</span>';
    const inner = shadow.getElementById('inner') as Element;
    shadow.elementFromPoint = () => inner;
    stack(host);
    expect(elementAtPoint(5, 5, (node) => node === inner)).toBe(host);
  });

  it('returns null when the point hits nothing', () => {
    document.elementsFromPoint = () => [];
    expect(elementAtPoint(5, 5, () => false)).toBeNull();
  });

  it('survives a throwing elementsFromPoint', () => {
    document.elementsFromPoint = () => {
      throw new Error('detached');
    };
    expect(elementAtPoint(5, 5, () => false)).toBeNull();
  });
});

describe('snapToSvgRoot', () => {
  function svgFixture(): void {
    document.body.innerHTML = `
      <svg id="logo-svg" viewBox="0 0 48 48">
        <g id="group"><path id="mark" d="M8 40 L24 8 L40 40 Z" /></g>
        <svg id="nested"><circle id="dot" /></svg>
      </svg>
      <p id="text">Not an svg</p>`;
  }

  it('snaps an inner path up to the outermost svg', () => {
    svgFixture();
    const svg = document.getElementById('logo-svg') as Element;
    expect(snapToSvgRoot(document.getElementById('mark') as Element)).toBe(svg);
    expect(snapToSvgRoot(document.getElementById('group') as Element)).toBe(svg);
    expect(snapToSvgRoot(document.getElementById('dot') as Element)).toBe(svg);
    expect(snapToSvgRoot(document.getElementById('nested') as Element)).toBe(svg);
    expect(snapToSvgRoot(svg)).toBe(svg);
  });

  it('leaves elements outside the SVG namespace alone', () => {
    svgFixture();
    const text = document.getElementById('text') as Element;
    expect(snapToSvgRoot(text)).toBe(text);
  });

  it('applies to the element under the pointer, so hover and click agree', () => {
    svgFixture();
    const mark = document.getElementById('mark') as Element;
    stack(mark);
    expect(elementAtPoint(5, 5, () => false)).toBe(document.getElementById('logo-svg'));
  });
});

describe('createSelection', () => {
  function harness(options: { pinned?: Element | null; mockup?: boolean } = {}) {
    const events: string[] = [];
    let pinned: Element | null = options.pinned ?? null;
    let edgesLocked = false;
    // Stands in for an unlocked mockup image painted under the pointer.
    const mockupTakesPointer = options.mockup === true;
    const controller = createSelection({
      owns: (node) => (node as Element | null)?.id === 'ours',
      onHover: (element) => events.push(`hover:${element?.id ?? 'none'}`),
      onPin: (element) => {
        pinned = element;
        events.push(`pin:${element.id}`);
      },
      onEscape: () => events.push('escape'),
      onViewportChange: () => events.push('viewport'),
      onRefreshPinned: () => events.push('refresh'),
      onPinnedRemoved: () => events.push('removed'),
      onNavigate: (direction) => events.push(`navigate:${direction}`),
      onReread: () => events.push('reread'),
      onToggleOutlines: () => events.push('outlines'),
      onMeasureTarget: (element) => events.push(`measure:${element?.id ?? 'none'}`),
      onMeasureEnd: () => events.push('measure-end'),
      onMeasureLock: (element) => events.push(`measure-lock:${element.id}`),
      onEdgeProbe: (point) =>
        events.push(point ? `edges:${point.x},${point.y}` : 'edges:none'),
      onEdgeLock: (point) => events.push(`edges-lock:${point.x},${point.y}`),
      mockupDragStart: (point) => {
        if (!mockupTakesPointer) return false;
        events.push(`mockup-start:${point.x},${point.y}`);
        return true;
      },
      mockupDragMove: (point) => events.push(`mockup-move:${point.x},${point.y}`),
      mockupDragEnd: () => events.push('mockup-end'),
      edgesLocked: () => edgesLocked,
      pinnedElement: () => pinned,
      panelHasFocus: () => true,
      mayRefresh: () => true,
    });
    controllers.push(controller);
    return { controller, events, lockEdges: () => (edgesLocked = true) };
  }

  it('intercepts a page click and pins instead of activating the link', () => {
    document.body.innerHTML = '<a id="link" href="#go">Go</a>';
    const link = document.getElementById('link') as HTMLElement;
    stack(link);
    const { controller, events } = harness();
    controller.setMode('active');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(events).toContain('pin:link');
    controller.destroy();
  });

  it('lets page clicks through in paused mode', () => {
    document.body.innerHTML = '<a id="link" href="#go">Go</a>';
    const link = document.getElementById('link') as HTMLElement;
    stack(link);
    const { controller, events } = harness();
    controller.setMode('active');
    controller.setMode('paused');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
    expect(events.some((event) => event.startsWith('pin:'))).toBe(false);
    controller.destroy();
  });

  it('never intercepts clicks on our own overlay', () => {
    document.body.innerHTML = '<div id="ours">Badge</div>';
    const ours = document.getElementById('ours') as HTMLElement;
    const { controller } = harness();
    controller.setMode('active');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    ours.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    controller.destroy();
  });

  it('routes Escape and panel keys, and ignores typing in a field', () => {
    document.body.innerHTML = '<input id="field" />';
    const field = document.getElementById('field') as HTMLElement;
    const { controller, events } = harness();
    controller.setMode('active');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events).toContain('escape');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(events).toContain('navigate:up');
    expect(events).toContain('navigate:down');
    expect(events).toContain('reread');

    events.length = 0;
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(events).toEqual([]);
    controller.destroy();
  });

  it('toggles layout outlines on Alt+O and ignores it while typing', () => {
    document.body.innerHTML = '<input id="field" />';
    const field = document.getElementById('field') as HTMLElement;
    const { controller, events } = harness();
    controller.setMode('active');

    const pressed = new KeyboardEvent('keydown', {
      key: 'o',
      code: 'KeyO',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(pressed);
    expect(events).toContain('outlines');
    expect(pressed.defaultPrevented).toBe(true);

    // A Mac layout reports 'ø' for Alt+O, so the physical code has to carry it.
    events.length = 0;
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ø', code: 'KeyO', altKey: true, bubbles: true }),
    );
    expect(events).toEqual(['outlines']);

    events.length = 0;
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', altKey: true, bubbles: true }),
    );
    expect(events).toEqual([]);

    // A plain o is still a plain o.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true }));
    expect(events).toEqual([]);
    controller.destroy();
  });

  it('measures against a second element while Alt is held and stops on release', () => {
    document.body.innerHTML = '<p id="a">Pinned</p><p id="b">Other</p>';
    const pinned = document.getElementById('a') as HTMLElement;
    const other = document.getElementById('b') as HTMLElement;
    stack(other);
    const { controller, events } = harness({ pinned });
    controller.setMode('active');

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));
    expect(events).toContain('measure:b');

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
    expect(events).toContain('measure-end');
    controller.destroy();
  });

  it('does nothing on Alt when nothing is pinned', () => {
    document.body.innerHTML = '<p id="b">Other</p>';
    const other = document.getElementById('b') as HTMLElement;
    stack(other);
    const { controller, events } = harness();
    controller.setMode('active');

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));

    expect(events.some((event) => event.startsWith('measure'))).toBe(false);
    controller.destroy();
  });

  it('ignores Alt while the target is editable', () => {
    document.body.innerHTML = '<p id="a">Pinned</p><input id="field" /><p id="b">Other</p>';
    const pinned = document.getElementById('a') as HTMLElement;
    const field = document.getElementById('field') as HTMLElement;
    const other = document.getElementById('b') as HTMLElement;
    stack(other);
    const { controller, events } = harness({ pinned });
    controller.setMode('active');

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true }));

    expect(events.some((event) => event.startsWith('measure'))).toBe(false);
    controller.destroy();
  });

  it('locks the measurement on Alt+click instead of pinning', () => {
    document.body.innerHTML = '<p id="a">Pinned</p><p id="b">Other</p>';
    const pinned = document.getElementById('a') as HTMLElement;
    const other = document.getElementById('b') as HTMLElement;
    stack(other);
    const { controller, events } = harness({ pinned });
    controller.setMode('active');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true });
    other.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(events).toContain('measure-lock:b');
    expect(events.some((event) => event.startsWith('pin:'))).toBe(false);

    // A plain click still pins, which is what releases a locked measurement.
    other.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(events).toContain('pin:b');
    controller.destroy();
  });

  it('probes the nearest edges while Shift is held and stops on release', () => {
    document.body.innerHTML = '<p id="b">Anywhere</p>';
    const target = document.getElementById('b') as HTMLElement;
    stack(target);
    // Point-to-edge needs nothing pinned, unlike Alt measurement.
    const { controller, events } = harness();
    controller.setMode('active');

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 90 }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }),
    );
    expect(events).toContain('edges:40,90');
    // The hover card is cleared so it cannot sit over the guides.
    expect(events).toContain('hover:none');

    events.length = 0;
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    expect(events).toContain('edges:none');
    controller.destroy();
  });

  it('keeps a locked edge reading when Shift is released', () => {
    document.body.innerHTML = '<p id="b">Anywhere</p>';
    const target = document.getElementById('b') as HTMLElement;
    stack(target);
    const { controller, events, lockEdges } = harness();
    controller.setMode('active');

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 20 }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }),
    );
    lockEdges();

    events.length = 0;
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    expect(events).not.toContain('edges:none');
    controller.destroy();
  });

  it('locks the edge reading on Shift+click instead of pinning', () => {
    document.body.innerHTML = '<p id="b">Anywhere</p>';
    const target = document.getElementById('b') as HTMLElement;
    stack(target);
    const { controller, events } = harness();
    controller.setMode('active');

    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
      clientX: 12,
      clientY: 34,
    });
    target.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(events).toContain('edges-lock:12,34');
    expect(events.some((event) => event.startsWith('pin:'))).toBe(false);
    controller.destroy();
  });

  it('leaves Alt measurement alone when both modifiers are held', () => {
    document.body.innerHTML = '<p id="a">Pinned</p><p id="b">Other</p>';
    const pinned = document.getElementById('a') as HTMLElement;
    const other = document.getElementById('b') as HTMLElement;
    stack(other);
    const { controller, events } = harness({ pinned });
    controller.setMode('active');

    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 5, clientY: 5, altKey: true, shiftKey: true }),
    );
    expect(events.some((event) => event.startsWith('edges:'))).toBe(false);
    controller.destroy();
  });

  it('ignores Shift while the target is editable', () => {
    document.body.innerHTML = '<input id="field" /><p id="b">Other</p>';
    const field = document.getElementById('field') as HTMLElement;
    const other = document.getElementById('b') as HTMLElement;
    stack(other);
    const { controller, events } = harness();
    controller.setMode('active');

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 5 }));
    events.length = 0;
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }),
    );
    expect(events.some((event) => event.startsWith('edges:'))).toBe(false);
    controller.destroy();
  });

  it('drops a scheduled hover frame before an Alt+click locks (F1)', () => {
    document.body.innerHTML = '<p id="a">Pinned</p><p id="b">Other</p>';
    const pinned = document.getElementById('a') as HTMLElement;
    const other = document.getElementById('b') as HTMLElement;
    stack(other);
    const frames: (FrameRequestCallback | null)[] = [];
    let cancelled = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      cancelled += 1;
      frames[handle - 1] = null;
    });

    const { controller, events } = harness({ pinned });
    controller.setMode('active');

    // A move schedules a frame that has not run yet.
    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 5, clientY: 5, altKey: true }),
    );
    expect(frames).toHaveLength(1);

    // The click lands in the same frame.
    other.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
    expect(events).toContain('measure-lock:b');
    expect(cancelled).toBe(1);

    // Nothing is left to run, so nothing can retarget the measurement.
    events.length = 0;
    frames.forEach((frame) => frame?.(0));
    expect(events).toEqual([]);
    controller.destroy();
  });

  it('locks from a modifier click that lands on our own UI (F5)', () => {
    document.body.innerHTML = '<p id="a">Pinned</p><div id="ours">Panel</div><p id="b">Under</p>';
    const pinned = document.getElementById('a') as HTMLElement;
    const ours = document.getElementById('ours') as HTMLElement;
    const under = document.getElementById('b') as HTMLElement;
    // Our own panel is on top; the page element under it is what is measured.
    stack(under);
    const { controller, events } = harness({ pinned });
    controller.setMode('active');

    const alt = new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true });
    ours.dispatchEvent(alt);
    expect(events).toContain('measure-lock:b');
    expect(alt.defaultPrevented).toBe(true);

    events.length = 0;
    const shift = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
      clientX: 40,
      clientY: 50,
    });
    ours.dispatchEvent(shift);
    expect(events).toContain('edges-lock:40,50');
    expect(shift.defaultPrevented).toBe(true);

    // A plain click on our UI is still our UI's: buttons have to work.
    events.length = 0;
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    ours.dispatchEvent(plain);
    expect(events).toEqual([]);
    expect(plain.defaultPrevented).toBe(false);
    controller.destroy();
  });

  it('never claims a plain pointerdown on our own UI', () => {
    document.body.innerHTML = '<div id="ours">Panel</div>';
    const ours = document.getElementById('ours') as HTMLElement;
    const { controller } = harness();
    controller.setMode('active');

    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, altKey: true });
    ours.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    controller.destroy();
  });

  it('drags an unlocked mockup while paused and never while inspecting (F4)', () => {
    document.body.innerHTML = '<p id="b">Page</p>';
    const target = document.getElementById('b') as HTMLElement;
    stack(target);
    const { controller, events } = harness({ mockup: true });

    // Inspecting: the click belongs to the selection, mockup or no mockup.
    controller.setMode('active');
    target.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }),
    );
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(events.some((event) => event.startsWith('mockup-'))).toBe(false);
    expect(events).toContain('pin:b');

    // Paused: the same press moves the comp instead.
    events.length = 0;
    controller.setMode('paused');
    const down = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 40,
    });
    target.dispatchEvent(down);
    expect(events).toContain('mockup-start:30,40');
    expect(down.defaultPrevented).toBe(true);

    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 70 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 70 }));
    expect(events).toContain('mockup-move:50,70');
    expect(events).toContain('mockup-end');
    controller.destroy();
  });

  it('falls through to normal selection when no mockup takes the pointer', () => {
    document.body.innerHTML = '<p id="b">Page</p>';
    const target = document.getElementById('b') as HTMLElement;
    stack(target);
    const { controller, events } = harness();
    controller.setMode('paused');

    const down = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 40,
    });
    target.dispatchEvent(down);
    expect(events.some((event) => event.startsWith('mockup-'))).toBe(false);
    expect(down.defaultPrevented).toBe(false);
    controller.destroy();
  });

  it('removes every listener when turned off', () => {
    document.body.innerHTML = '<a id="link" href="#go">Go</a>';
    const link = document.getElementById('link') as HTMLElement;
    stack(link);
    const { controller, events } = harness();
    controller.setMode('active');
    controller.setMode('off');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(click.defaultPrevented).toBe(false);
    expect(events).toEqual([]);
    controller.destroy();
  });
});
