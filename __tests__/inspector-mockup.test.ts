import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INSPECTOR_KEY, bootInspector, type InspectorApi } from '../lib/inspector/boot';
import { MOCKUP_HOST_TAG, createMockupLayer, type MockupSettings } from '../lib/inspector/mockup';
import type { ContentResponse, MockupState } from '../lib/messages';

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function mockupOf(overrides: Partial<MockupState> = {}): MockupState {
  return {
    dataUrl: PIXEL,
    opacity: 0.5,
    x: 0,
    y: 0,
    scale: 1,
    visible: true,
    blend: 'normal',
    locked: false,
    ...overrides,
  };
}

/** jsdom reports a zero sized rect, so the painted box is stated outright. */
function stubRect(image: HTMLImageElement, x: number, y: number, width: number, height: number): void {
  image.getBoundingClientRect = () =>
    ({
      x,
      y,
      width,
      height,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({}),
    }) as DOMRect;
}

function cleanup(): void {
  const container = globalThis as unknown as Record<symbol, { api: InspectorApi } | undefined>;
  // Switch the previous boot off before dropping it. The inspector intercepts
  // clicks on `window` in the capture phase, and a listener that outlived its
  // own overlay would swallow the next test's clicks as if they were the page's.
  try {
    container[INSPECTOR_KEY]?.api.setMode('off');
  } catch {
    // A boot that never installed anything has nothing to switch off.
  }
  delete container[INSPECTOR_KEY];
  document.body.innerHTML = '';
  document.querySelectorAll('design-inspector-host').forEach((node) => node.remove());
  document.querySelectorAll(MOCKUP_HOST_TAG).forEach((node) => node.remove());
}

beforeEach(cleanup);
afterEach(cleanup);

// ---------------------------------------------------------------------------
// The layer itself

describe('createMockupLayer', () => {
  function layerHarness() {
    const moves: MockupSettings[] = [];
    const layer = createMockupLayer({ onStateChange: (state) => moves.push(state) });
    const image = layer.root.getElementById('mockup') as HTMLImageElement;
    return { layer, image, moves };
  }

  it('hosts itself outside the inspector overlay so blending reaches the page', () => {
    const { layer } = layerHarness();
    expect(document.querySelectorAll(MOCKUP_HOST_TAG)).toHaveLength(1);
    // A host that generates no box cannot become an isolated blending group.
    expect(layer.host.style.display).toBe('contents');
    layer.destroy();
    expect(document.querySelectorAll(MOCKUP_HOST_TAG)).toHaveLength(0);
  });

  it('applies opacity, blend, scale and the document offset', () => {
    const { layer, image } = layerHarness();
    layer.set(mockupOf({ opacity: 0.25, blend: 'difference', scale: 2, x: 40, y: 60 }));
    expect(image.hidden).toBe(false);
    expect(image.src).toBe(PIXEL);
    expect(image.style.opacity).toBe('0.25');
    expect(image.style.mixBlendMode).toBe('difference');
    expect(image.style.transform).toBe('scale(2)');
    expect(image.style.left).toBe('40px');
    expect(image.style.top).toBe('60px');
  });

  it('hides an invisible mockup without forgetting its settings', () => {
    const { layer, image } = layerHarness();
    layer.set(mockupOf({ visible: false, x: 12 }));
    expect(image.hidden).toBe(true);
    expect(layer.current()).toMatchObject({ visible: false, x: 12 });
  });

  it('is a keyboard target only while it is unlocked', () => {
    const { layer, image } = layerHarness();
    layer.set(mockupOf({ locked: false }));
    expect(image.getAttribute('tabindex')).toBe('0');
    expect(image.dataset.locked).toBe('false');

    layer.set(mockupOf({ locked: true }));
    expect(image.hasAttribute('tabindex')).toBe(false);
    expect(image.dataset.locked).toBe('true');
  });

  it('nudges by 1px with an arrow key and by 10px with Shift', () => {
    const { layer, image, moves } = layerHarness();
    layer.set(mockupOf({ x: 100, y: 100 }));

    image.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(layer.current()).toMatchObject({ x: 101, y: 100 });

    image.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
    );
    expect(layer.current()).toMatchObject({ x: 101, y: 110 });

    // Each nudge is reported once, so the panel can persist it.
    expect(moves).toHaveLength(2);
    expect(moves[1]).toMatchObject({ x: 101, y: 110 });
  });

  it('ignores the arrow keys while the position is locked', () => {
    const { layer, image, moves } = layerHarness();
    layer.set(mockupOf({ x: 100, locked: true }));
    image.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(layer.current()).toMatchObject({ x: 100 });
    expect(moves).toHaveLength(0);
  });

  it('never takes pointer events, locked or not (F4)', () => {
    const { layer, image } = layerHarness();
    const css = layer.root.querySelector('style')?.textContent ?? '';
    expect(css).toContain('pointer-events: none');
    expect(css).not.toContain('pointer-events: auto');

    layer.set(mockupOf({ locked: false }));
    expect(image.style.pointerEvents).toBe('');
  });

  it('takes the pointer only for a point inside an unlocked, visible image', () => {
    const { layer, image } = layerHarness();
    stubRect(image, 100, 200, 300, 160);

    layer.set(mockupOf({ locked: true }));
    expect(layer.dragStart({ x: 150, y: 250 })).toBe(false);

    layer.set(mockupOf({ locked: false, visible: false }));
    expect(layer.dragStart({ x: 150, y: 250 })).toBe(false);

    layer.set(mockupOf({ locked: false }));
    expect(layer.dragStart({ x: 50, y: 250 })).toBe(false);
    expect(layer.dragStart({ x: 150, y: 900 })).toBe(false);
    expect(layer.dragStart({ x: 150, y: 250 })).toBe(true);
    expect(image.dataset.dragging).toBe('true');
  });

  it('refuses the pointer when there is no mockup at all', () => {
    const { layer } = layerHarness();
    expect(layer.dragStart({ x: 10, y: 10 })).toBe(false);
  });

  it('moves the image live and reports the new offset once, at the end', () => {
    const { layer, image, moves } = layerHarness();
    layer.set(mockupOf({ x: 100, y: 200 }));
    stubRect(image, 100, 200, 300, 160);

    expect(layer.dragStart({ x: 150, y: 250 })).toBe(true);
    layer.dragMove({ x: 170, y: 280 });
    expect(layer.current()).toMatchObject({ x: 120, y: 230 });
    // Nothing is reported while the pointer is still down.
    expect(moves).toHaveLength(0);

    layer.dragMove({ x: 180, y: 300 });
    layer.dragEnd();
    expect(layer.current()).toMatchObject({ x: 130, y: 250 });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ x: 130, y: 250 });
    expect(image.dataset.dragging).toBeUndefined();
  });

  it('ignores a move or an end that no drag started', () => {
    const { layer, image, moves } = layerHarness();
    layer.set(mockupOf({ x: 100, y: 200 }));
    stubRect(image, 100, 200, 300, 160);

    layer.dragMove({ x: 400, y: 400 });
    layer.dragEnd();
    expect(layer.current()).toMatchObject({ x: 100, y: 200 });
    expect(moves).toHaveLength(0);
  });

  it('hides for a screenshot and comes back afterwards', () => {
    const { layer, image } = layerHarness();
    layer.set(mockupOf());
    layer.setHostVisible(false);
    expect(image.hidden).toBe(true);
    layer.setHostVisible(true);
    expect(image.hidden).toBe(false);
  });

  it('clears the image and the state when the mockup is removed', () => {
    const { layer, image } = layerHarness();
    layer.set(mockupOf());
    layer.set(null);
    expect(layer.current()).toBeNull();
    expect(image.hidden).toBe(true);
    expect(image.hasAttribute('src')).toBe(false);
  });

  it('owns its own nodes so the inspector never treats them as page content', () => {
    const { layer, image } = layerHarness();
    expect(layer.owns(image)).toBe(true);
    expect(layer.owns(document.body)).toBe(false);
    expect(layer.owns(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The content script's handling of content.setMockup

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

function installChrome(): { listeners: Listener[]; sent: unknown[] } {
  const listeners: Listener[] = [];
  const sent: unknown[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'design-inspector-test',
      onMessage: {
        addListener: (listener: Listener) => listeners.push(listener),
        removeListener: () => undefined,
      },
      sendMessage: (message: unknown) => {
        sent.push(message);
        return Promise.resolve({ ok: true });
      },
    },
  };
  return { listeners, sent };
}

describe('content.setMockup', () => {
  let harness: ReturnType<typeof installChrome>;

  async function send(message: unknown): Promise<unknown> {
    const listener = harness.listeners[0];
    if (!listener) throw new Error('no listener was installed');
    let response: unknown;
    listener(message, { tab: { id: 7 } }, (value) => {
      response = value;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return response;
  }

  function stateOf(response: unknown) {
    return (response as Extract<ContentResponse, { state: unknown }>).state;
  }

  beforeEach(() => {
    harness = installChrome();
    document.body.innerHTML = '<section id="hero"><h1 id="head">Hi</h1></section>';
    bootInspector();
  });

  it('reports a null mockup in the state before one is ever set', async () => {
    expect(stateOf(await send({ type: 'content.getState' })).mockup).toBeNull();
  });

  it('renders a mockup with the inspector still off, and reports it in the state', async () => {
    const response = await send({ type: 'content.setMockup', mockup: mockupOf({ opacity: 0.3 }) });
    const state = stateOf(response);
    expect(state.mode).toBe('off');
    expect(state.mockup).toEqual({
      opacity: 0.3,
      x: 0,
      y: 0,
      scale: 1,
      visible: true,
      blend: 'normal',
      locked: false,
    });
    // The image itself is far too large to echo in every state message.
    expect(state.mockup).not.toHaveProperty('dataUrl');

    const image = document
      .querySelector(MOCKUP_HOST_TAG)
      ?.shadowRoot?.getElementById('mockup') as HTMLImageElement | null;
    expect(image?.hidden).toBe(false);
    expect(image?.style.opacity).toBe('0.3');
  });

  it('includes the mockup in every state it broadcasts', async () => {
    harness.sent.length = 0;
    await send({ type: 'content.setMockup', mockup: mockupOf({ x: 25 }) });
    const states = (harness.sent as { type: string; state?: { mockup?: { x: number } | null } }[])
      .filter((event) => event.type === 'event.state');
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((event) => event.state?.mockup?.x === 25)).toBe(true);
  });

  it('clears the mockup on null and leaves no trace with the inspector off', async () => {
    await send({ type: 'content.setMockup', mockup: mockupOf() });
    expect(document.querySelectorAll('design-inspector-host')).toHaveLength(1);

    const state = stateOf(await send({ type: 'content.setMockup', mockup: null }));
    expect(state.mockup).toBeNull();
    expect(document.querySelectorAll(MOCKUP_HOST_TAG)).toHaveLength(0);
    expect(document.querySelectorAll('design-inspector-host')).toHaveLength(0);
  });

  it('keeps the overlay when the mockup is cleared while inspecting', async () => {
    await send({ type: 'content.setMode', mode: 'active' });
    await send({ type: 'content.setMockup', mockup: mockupOf() });
    await send({ type: 'content.setMockup', mockup: null });
    expect(document.querySelectorAll('design-inspector-host')).toHaveLength(1);
  });

  it('hides the mockup when the inspector exits and shows it again on a fresh set', async () => {
    await send({ type: 'content.setMode', mode: 'active' });
    await send({ type: 'content.setMockup', mockup: mockupOf() });
    expect(document.querySelectorAll(MOCKUP_HOST_TAG)).toHaveLength(1);

    const off = await send({ type: 'content.setMode', mode: 'off' });
    // Hidden, because the host went with the overlay, but not forgotten.
    expect(document.querySelectorAll(MOCKUP_HOST_TAG)).toHaveLength(0);
    expect(stateOf(off).mockup).not.toBeNull();

    await send({ type: 'content.setMockup', mockup: mockupOf() });
    expect(document.querySelectorAll(MOCKUP_HOST_TAG)).toHaveLength(1);
  });

  it('offers the badge toggle only while a mockup exists', async () => {
    await send({ type: 'content.setMode', mode: 'active' });
    const root = document.querySelector('design-inspector-host')?.shadowRoot;
    const toggle = root?.getElementById('badge-mockup') as HTMLButtonElement;
    expect(toggle.hidden).toBe(true);

    await send({ type: 'content.setMockup', mockup: mockupOf() });
    expect(toggle.hidden).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(stateOf(await send({ type: 'content.getState' })).mockup?.visible).toBe(false);

    await send({ type: 'content.setMockup', mockup: null });
    expect(toggle.hidden).toBe(true);
  });
});
