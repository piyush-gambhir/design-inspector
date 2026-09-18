import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ElementSnapshot, FontIdentity, TypographyReading } from '../lib/contracts';
import { buildSnapshot } from '../lib/inspector/readings';
import {
  BADGE_COLLAPSE_WIDTH,
  ESCAPE_HINTS,
  ESCAPE_ORDER_TIP,
  GUIDE_DOUBLE_MS,
  HOST_TAG,
  chooseCardCorner,
  chooseWidePlacement,
  createOverlay,
  escapeHintFor,
  isElementRendered,
  nextEscapeStep,
  resetOverlaySession,
  resetPickedColors,
  type Overlay,
} from '../lib/inspector/overlay';
import { resetGuides } from '../lib/inspector/rulers';

let overlay: Overlay;

function callbacks() {
  return {
    onExit: () => undefined,
    onTogglePaused: () => undefined,
    onToggleOutlines: () => undefined,
    onToggleRulers: () => undefined,
    onToggleSemanticParents: () => undefined,
    onToggleLayoutOverlay: () => undefined,
    onToggleBadge: () => undefined,
    onToggleMockupVisible: () => undefined,
    onUnpin: () => undefined,
    onSelectAncestor: () => undefined,
    onSelectChild: () => undefined,
    onNavigate: () => undefined,
    onReread: () => undefined,
    onDownload: () => Promise.resolve(null),
    onAssetDetails: () => Promise.resolve({ fileSize: 2048, mimeType: 'image/png' }),
    onIdentifyFont: () => Promise.resolve('No font host was contacted in this test.'),
    onSave: () => Promise.resolve(null),
    cssFor: () => null,
    tailwindFor: () => null,
    tailwindClosestFor: () => null,
    onMockupMoved: () => undefined,
  };
}

/** jsdom reports zero sized rects, so geometry is stubbed where it matters. */
function withStubbedRects(run: () => void, rects: (element: Element) => DOMRect): void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stub(this: Element) {
    return rects(this);
  };
  try {
    run();
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}

/**
 * Runs `body` with a faked `window.innerWidth` and a real resize event, so the
 * viewport-following rules are exercised the way the browser drives them.
 */
function withViewportWidth(width: number, body: () => void): void {
  const original = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  window.dispatchEvent(new Event('resize'));
  try {
    body();
  } finally {
    Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
    window.dispatchEvent(new Event('resize'));
  }
}

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '';
  resetPickedColors();
  resetOverlaySession();
  resetGuides();
  overlay = createOverlay(callbacks());
});

afterEach(() => {
  overlay.destroy();
  document.querySelectorAll(HOST_TAG).forEach((node) => node.remove());
  delete (globalThis as { EyeDropper?: unknown }).EyeDropper;
});

describe('overlay host', () => {
  it('mounts one host on documentElement with an open shadow root', () => {
    const host = document.querySelector(HOST_TAG) as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.shadowRoot).not.toBeNull();
    expect(overlay.root.mode).toBe('open');
  });

  it('pins its own layer to the viewport and never eats page pointer events', () => {
    const host = document.querySelector(HOST_TAG) as HTMLElement;
    expect(host.style.position).toBe('fixed');
    expect(host.style.pointerEvents).toBe('none');
    expect(host.style.zIndex).toBe('2147483647');
  });

  it('resets inherited styles and declares the accent token', () => {
    const css = overlay.root.querySelector('style')?.textContent ?? '';
    expect(css).toContain('all: initial');
    expect(css).toContain('font: 12px/1.4 ui-sans-serif, system-ui, sans-serif');
    expect(css).toContain('color-scheme: light dark');
    // The accent is one token, and it is the one that carries white text on
    // the filled button, so it is tuned for 4.5:1 there (workstream V4).
    expect(css).toContain('--di-accent: oklch(0.55 0.19 255)');
    expect(css).toContain('--di-accent-foreground');
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('claims its own nodes and nothing else', () => {
    document.body.innerHTML = '<p id="page">Page</p>';
    const badge = overlay.root.getElementById('badge') as HTMLElement;
    expect(overlay.owns(badge)).toBe(true);
    expect(overlay.owns(overlay.host)).toBe(true);
    expect(overlay.owns(document.getElementById('page'))).toBe(false);
    expect(overlay.owns(null)).toBe(false);
  });

  it('shows the badge only while inspecting', () => {
    const badge = overlay.root.getElementById('badge') as HTMLElement;
    expect(badge.hidden).toBe(true);
    overlay.setMode('active');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toContain('Inspecting');
    overlay.setMode('paused');
    expect(badge.textContent).toContain('Paused');
    expect(badge.textContent).toContain('Resume inspecting');
  });

  it('offers an outlines toggle on the badge that reports its own state', () => {
    let toggles = 0;
    overlay.destroy();
    overlay = createOverlay({ ...callbacks(), onToggleOutlines: () => (toggles += 1) });
    overlay.setMode('active');

    const button = overlay.root.getElementById('badge-outlines') as HTMLButtonElement;
    expect(button.textContent).toBe('Outlines');
    expect(button.getAttribute('aria-label')).toBe('Toggle layout outlines');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    button.click();
    expect(toggles).toBe(1);

    overlay.setOutlines('tag');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    overlay.setOutlines('off');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('hides and shows every overlay node for screenshots', () => {
    overlay.setVisible(false);
    expect(overlay.host.style.display).toBe('none');
    overlay.setVisible(true);
    expect(overlay.host.style.display).toBe('');
  });

  it('caps simultaneous highlights at 20', () => {
    const parts: string[] = [];
    for (let i = 0; i < 30; i += 1) parts.push(`<p id="p${i}">Item ${i}</p>`);
    document.body.innerHTML = parts.join('');
    const elements = Array.from(document.querySelectorAll('p'));

    // jsdom reports zero sized rects, so geometry is stubbed for this check.
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, toJSON: () => ({}) }) as DOMRect;
    try {
      overlay.highlight(elements);
      expect(overlay.root.querySelectorAll('.outline')).toHaveLength(20);
      overlay.clearHighlight();
      expect(overlay.root.querySelectorAll('.outline')).toHaveLength(0);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it('removes itself on destroy', () => {
    overlay.destroy();
    expect(document.querySelector(HOST_TAG)).toBeNull();
  });
});

describe('pinned panel', () => {
  it('renders page text as text, never as markup', () => {
    document.body.innerHTML = '<button>&lt;img src=x onerror=alert(1)&gt;</button>';
    const element = document.querySelector('button') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    const panel = overlay.root.getElementById('panel') as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.querySelectorAll('*').length).toBeGreaterThan(0);
    // The label samples the text and truncates it; what it shows is text.
    expect(panel.textContent).toContain('<img src=x');
    // Nothing page-derived is ever parsed as markup. The head's title tooltip
    // carries the same label as an attribute value, which is a string and not
    // markup, so the check is that no element came out of the payload rather
    // than that the serialized HTML never contains the characters.
    const title = panel.querySelector('.panel-title') as HTMLElement;
    expect(title.title).toBe(title.textContent);
    expect(title.childElementCount).toBe(0);
  });

  it('shows the typography reading with px and rem', () => {
    document.body.innerHTML = '<p id="copy" style="font-size: 32px">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    const text = (overlay.root.getElementById('panel')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('32px');
    expect(text).toContain('2rem');
    // One Copy control per section head, with the three exporters in its menu.
    expect(text).toContain('Copy');
    expect(text).toContain('Tailwind');
  });

  it('closes the save form first, and reports whether a menu was open', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    expect(overlay.hasOpenMenu()).toBe(false);
    expect(overlay.closeMenu()).toBe(false);

    const toggle = Array.from(overlay.root.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save reference',
    ) as HTMLButtonElement;
    toggle.click();
    expect(overlay.hasOpenMenu()).toBe(true);
    expect(overlay.closeMenu()).toBe(true);
    expect(overlay.hasOpenMenu()).toBe(false);
  });

  it('says when the pinned element has left the page', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);
    element.remove();
    overlay.markPinnedMissing();

    expect(overlay.root.getElementById('panel')?.textContent).toContain(
      'Element is no longer on the page.',
    );
  });

  it('hides the panel when nothing is pinned', () => {
    overlay.setMode('active');
    overlay.setPinned(null, null);
    expect((overlay.root.getElementById('panel') as HTMLElement).hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tier 1 features: layout overlay, measurement, eyedropper

function fakeStyle(values: Record<string, string>): CSSStyleDeclaration {
  return {
    ...values,
    getPropertyValue: (name: string) => values[name] ?? '',
  } as unknown as CSSStyleDeclaration;
}

/** Replaces the computed style of one element while `run` executes. */
function withStubbedStyle(target: Element, values: Record<string, string>, run: () => void): void {
  const original = window.getComputedStyle;
  window.getComputedStyle = ((element: Element, pseudo?: string | null) =>
    element === target
      ? fakeStyle(values)
      : original.call(window, element, pseudo ?? undefined)) as typeof window.getComputedStyle;
  try {
    run();
  } finally {
    window.getComputedStyle = original;
  }
}

describe('layout overlay', () => {
  it('keeps its own layer under the box bands, and the measure layer above them', () => {
    const children = Array.from(overlay.root.children);
    const layout = overlay.root.getElementById('layout-layer') as HTMLElement;
    const measure = overlay.root.getElementById('measure-layer') as HTMLElement;
    const boxLayer = (overlay.root.getElementById('band-margin') as HTMLElement)
      .parentElement as HTMLElement;

    expect(layout).not.toBeNull();
    expect(measure).not.toBeNull();
    expect(children.indexOf(layout)).toBeLessThan(children.indexOf(boxLayer));
    expect(children.indexOf(measure)).toBeGreaterThan(children.indexOf(boxLayer));
  });

  it('draws grid track lines and labels, and clears them on unpin', () => {
    document.body.innerHTML = '<div id="grid"><i id="c1"></i><i id="c2"></i></div>';
    const grid = document.getElementById('grid') as Element;
    const snapshot = buildSnapshot(grid, { deep: false });
    const layer = overlay.root.getElementById('layout-layer') as HTMLElement;

    withStubbedRects(
      () => {
        withStubbedStyle(
          grid,
          {
            display: 'grid',
            gridTemplateColumns: '100px 100px',
            gridTemplateRows: '50px',
            columnGap: '20px',
            rowGap: '0px',
          },
          () => {
            overlay.setMode('active');
            overlay.setPinned(snapshot, grid);
          },
        );
      },
      () => domRect(0, 0, 220, 50),
    );

    const labels = Array.from(layer.querySelectorAll('.track-label')).map(
      (node) => node.textContent,
    );
    expect(labels).toContain('100px');
    expect(labels).toContain('50px');
    expect(layer.querySelectorAll('.grid-line').length).toBeGreaterThan(0);
    expect(layer.querySelectorAll('.tint-band').length).toBe(1);

    overlay.setPinned(null, null);
    expect(layer.childElementCount).toBe(0);
  });

  it('says so when the grid template cannot be read as px', () => {
    document.body.innerHTML = '<div id="grid"><i id="c1"></i></div>';
    const grid = document.getElementById('grid') as Element;
    const snapshot = buildSnapshot(grid, { deep: false });

    withStubbedRects(
      () => {
        withStubbedStyle(
          grid,
          {
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gridTemplateRows: 'none',
            columnGap: '0px',
            rowGap: '0px',
          },
          () => {
            overlay.setMode('active');
            overlay.setPinned(snapshot, grid);
          },
        );
      },
      () => domRect(0, 0, 220, 50),
    );

    const layer = overlay.root.getElementById('layout-layer') as HTMLElement;
    expect(layer.childElementCount).toBe(0);
    expect(overlay.root.getElementById('panel')?.textContent).toContain(
      'Grid overlay unavailable for this template',
    );
  });

  it('offers a layout overlay toggle in the panel header, on by default', () => {
    document.body.innerHTML = '<div id="grid"><i id="c1"></i><i id="c2"></i></div>';
    const grid = document.getElementById('grid') as Element;
    const snapshot = buildSnapshot(grid, { deep: false });
    const layer = overlay.root.getElementById('layout-layer') as HTMLElement;

    withStubbedRects(
      () => {
        withStubbedStyle(
          grid,
          {
            display: 'grid',
            gridTemplateColumns: '100px 100px',
            gridTemplateRows: '50px',
            columnGap: '20px',
            rowGap: '0px',
          },
          () => {
            overlay.setMode('active');
            overlay.setPinned(snapshot, grid);

            const toggle = overlay.root.getElementById('panel-layout-overlay') as HTMLButtonElement;
            expect(toggle.getAttribute('aria-pressed')).toBe('true');
            expect(layer.childElementCount).toBeGreaterThan(0);

            toggle.click();
            expect(toggle.getAttribute('aria-pressed')).toBe('false');
            expect(layer.childElementCount).toBe(0);

            toggle.click();
            expect(layer.childElementCount).toBeGreaterThan(0);
          },
        );
      },
      () => domRect(0, 0, 220, 50),
    );
  });
});

describe('measurement', () => {
  function pinAndMeasure(run: (pinned: Element, other: Element) => void): void {
    document.body.innerHTML = '<p id="a">Pinned</p><p id="b">Other</p>';
    const pinned = document.getElementById('a') as Element;
    const other = document.getElementById('b') as Element;
    const snapshot = buildSnapshot(pinned, { deep: false });

    withStubbedRects(
      () => {
        overlay.setMode('active');
        overlay.setPinned(snapshot, pinned);
        run(pinned, other);
      },
      (element) =>
        element === other ? domRect(124, 0, 100, 50) : domRect(0, 0, 100, 50),
    );
  }

  it('draws guides with px labels and a measure block, then clears them', () => {
    pinAndMeasure((_pinned, other) => {
      const layer = overlay.root.getElementById('measure-layer') as HTMLElement;
      expect(layer.childElementCount).toBe(0);

      overlay.setMeasure(other);
      expect(layer.querySelectorAll('.measure-outline')).toHaveLength(1);
      const labels = Array.from(layer.querySelectorAll('.measure-label')).map(
        (node) => node.textContent,
      );
      expect(labels).toContain('24px');
      expect(labels).toContain('0px');

      const block = overlay.root.querySelector('.measure-block') as HTMLElement;
      expect(block.hidden).toBe(false);
      const text = (block.textContent ?? '').replace(/\s+/g, ' ');
      expect(text).toContain('Measure');
      expect(text).toContain('Gap x');
      expect(text).toContain('24px');
      expect(text).toContain('separated');

      overlay.setMeasure(null);
      expect(layer.childElementCount).toBe(0);
      expect((overlay.root.querySelector('.measure-block') as HTMLElement).hidden).toBe(true);
    });
  });

  it('reports a locked measurement until it is cleared', () => {
    pinAndMeasure((_pinned, other) => {
      expect(overlay.measureLocked()).toBe(false);
      overlay.setMeasure(other);
      expect(overlay.measureLocked()).toBe(false);

      overlay.setMeasure(other, { locked: true });
      expect(overlay.measureLocked()).toBe(true);
      expect((overlay.root.querySelector('.measure-block') as HTMLElement).textContent).toContain(
        'Measure (locked)',
      );

      overlay.setMeasure(null);
      expect(overlay.measureLocked()).toBe(false);
    });
  });

  it('keeps a lock through a retarget and lets it go only when asked (F1)', () => {
    pinAndMeasure((_pinned, other) => {
      overlay.setMeasure(other, { locked: true });
      expect(overlay.measureLocked()).toBe(true);

      // A hover frame that lands after the lock says nothing about locking, so
      // it must leave the lock alone rather than silently dropping it.
      overlay.setMeasure(other);
      expect(overlay.measureLocked()).toBe(true);
      expect((overlay.root.querySelector('.measure-block') as HTMLElement).textContent).toContain(
        'Measure (locked)',
      );

      overlay.setMeasure(other, { locked: false });
      expect(overlay.measureLocked()).toBe(false);
      expect(
        (overlay.root.querySelector('.measure-block') as HTMLElement).textContent,
      ).not.toContain('locked');
    });
  });

  it('empties the measure title when the block hides (UX note 2)', () => {
    pinAndMeasure((_pinned, other) => {
      overlay.setMeasure(other, { locked: true });
      const title = overlay.root.querySelector('.measure-head span') as HTMLElement;
      expect(title.textContent).toBe('Measure (locked)');

      overlay.setMeasure(null, { locked: false });
      expect((overlay.root.querySelector('.measure-block') as HTMLElement).hidden).toBe(true);
      expect((overlay.root.querySelector('.measure-head span') as HTMLElement).textContent).toBe('');
    });
  });

  it('draws nothing for the pinned element measured against itself', () => {
    pinAndMeasure((pinned) => {
      overlay.setMeasure(pinned);
      expect((overlay.root.getElementById('measure-layer') as HTMLElement).childElementCount).toBe(
        0,
      );
    });
  });

  it('clears the measurement when the pin goes away', () => {
    pinAndMeasure((_pinned, other) => {
      overlay.setMeasure(other, { locked: true });
      overlay.setPinned(null, null);
      expect((overlay.root.getElementById('measure-layer') as HTMLElement).childElementCount).toBe(
        0,
      );
      expect(overlay.measureLocked()).toBe(false);
    });
  });
});

describe('eyedropper controls', () => {
  function installPicker(): void {
    (globalThis as { EyeDropper?: unknown }).EyeDropper = class {
      open(): Promise<{ sRGBHex: string }> {
        return Promise.resolve({ sRGBHex: '#3874cb' });
      }
    };
  }

  it('shows no picker controls when the browser has none', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    expect(overlay.root.getElementById('badge-pick')).toBeNull();
    const picks = Array.from(overlay.root.querySelectorAll('button')).filter(
      (node) => node.textContent === 'Pick',
    );
    expect(picks).toHaveLength(0);
  });

  it('offers a badge button and a Pick action on every color row when it does', () => {
    installPicker();
    overlay.destroy();
    overlay = createOverlay(callbacks());

    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    const badgePick = overlay.root.getElementById('badge-pick') as HTMLButtonElement;
    expect(badgePick.textContent).toBe('Pick color');
    expect(badgePick.getAttribute('aria-label')).toBe('Pick a color from the page');

    const picks = Array.from(overlay.root.querySelectorAll('button')).filter(
      (node) => node.textContent === 'Pick',
    );
    expect(picks.length).toBeGreaterThan(0);
  });

  it('shows the picked pixel with its conversions and its evidence label', async () => {
    installPicker();
    overlay.destroy();
    overlay = createOverlay(callbacks());

    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    (overlay.root.getElementById('badge-pick') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    const panel = overlay.root.getElementById('panel') as HTMLElement;
    const text = (panel.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Picked color');
    expect(text).toContain('#3874cb');
    expect(text).toContain('oklch(');
    expect(text).toContain('Observed (picked pixel)');
    // The overlay host is back after the pick.
    expect(overlay.host.style.display).toBe('');
  });

  it('offers a picked background for a contrast reading it could not derive', async () => {
    installPicker();
    overlay.destroy();
    overlay = createOverlay(callbacks());

    document.body.innerHTML = '<p id="copy" style="color: rgb(0, 0, 0)">Hello</p>';
    const element = document.getElementById('copy') as Element;
    const snapshot = buildSnapshot(element, { deep: false });
    expect(snapshot.typography?.contrast.status).toBe('unavailable');

    overlay.setMode('active');
    overlay.setPinned(snapshot, element);

    const pickBackground = Array.from(overlay.root.querySelectorAll('button')).find(
      (node) => node.textContent === 'Pick background',
    ) as HTMLButtonElement;
    expect(pickBackground).not.toBeUndefined();

    pickBackground.click();
    await Promise.resolve();
    await Promise.resolve();

    const text = (overlay.root.getElementById('panel')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('(against picked pixel, user-supplied)');
    // The reading itself is untouched: it is still unavailable.
    expect(snapshot.typography?.contrast.status).toBe('unavailable');
    expect(snapshot.typography?.contrast.ratio).toBeNull();
  });
});

describe('chooseCardCorner', () => {
  const card = { width: 340, height: 400 };
  const viewport = { width: 1200, height: 900 };

  it('picks the corner that covers the least of a full width band', () => {
    // A hero band across the top: the bottom corners are clear of it.
    expect(chooseCardCorner({ x: 0, y: 0, width: 1200, height: 260 }, card, viewport)).toBe(
      'bottom-right',
    );
    // The same band at the bottom sends the panel up.
    expect(chooseCardCorner({ x: 0, y: 640, width: 1200, height: 260 }, card, viewport)).toBe(
      'top-right',
    );
  });

  it('prefers the right when two corners overlap the rect equally', () => {
    // A centred band overlaps all four corners by the same area.
    expect(chooseCardCorner({ x: 0, y: 0, width: 1200, height: 900 }, card, viewport)).toBe(
      'top-right',
    );
  });

  it('avoids a rect that leans to one side', () => {
    const corner = chooseCardCorner({ x: 700, y: 0, width: 500, height: 900 }, card, viewport);
    expect(corner.endsWith('left')).toBe(true);
  });
});

describe('chooseWidePlacement (UX note 7)', () => {
  const card = { width: 340, height: 400 };
  const viewport = { width: 1200, height: 900 };

  it('puts the panel below a wide heading band near the top', () => {
    // A hero heading: 1200 wide, 120 tall, at the top of the viewport.
    const placed = chooseWidePlacement({ x: 0, y: 40, width: 1200, height: 120 }, card, viewport);
    expect(placed).not.toBeNull();
    // Below the band, not beside it and not over it.
    expect(placed?.y).toBe(170);
    expect(placed?.x).toBe(8);
  });

  it('puts the panel above the band when below has less room', () => {
    const placed = chooseWidePlacement({ x: 0, y: 640, width: 1200, height: 200 }, card, viewport);
    expect(placed).not.toBeNull();
    expect((placed?.y ?? 0) + card.height).toBeLessThanOrEqual(640);
  });

  it('refuses a band with no room on either side, so the corner rule runs', () => {
    expect(chooseWidePlacement({ x: 0, y: 0, width: 1200, height: 880 }, card, viewport)).toBeNull();
  });

  it('refuses a rect that is wide but not tall, which the panel can sit beside', () => {
    expect(chooseWidePlacement({ x: 0, y: 40, width: 1200, height: 40 }, card, viewport)).toBeNull();
  });

  it('refuses a rect that is not wide at all', () => {
    expect(chooseWidePlacement({ x: 0, y: 40, width: 300, height: 400 }, card, viewport)).toBeNull();
  });

  it('keeps the panel inside the viewport when the band starts off to the right', () => {
    const placed = chooseWidePlacement({ x: 940, y: 40, width: 800, height: 120 }, card, viewport);
    expect(placed?.x).toBe(viewport.width - card.width - 8);
  });
});

describe('isElementRendered', () => {
  it('is false for a detached element', () => {
    const detached = document.createElement('div');
    expect(isElementRendered(detached)).toBe(false);
  });

  it('is false when the element has no client rects', () => {
    document.body.innerHTML = '<p id="hidden">Hidden</p>';
    const element = document.getElementById('hidden') as Element;
    element.getClientRects = () => [] as unknown as DOMRectList;
    expect(isElementRendered(element)).toBe(false);
  });

  it('is false when checkVisibility says so, and true when it agrees', () => {
    document.body.innerHTML = '<p id="shown">Shown</p>';
    const element = document.getElementById('shown') as Element;
    element.getClientRects = () => [domRect(0, 0, 10, 10)] as unknown as DOMRectList;
    (element as Element & { checkVisibility: () => boolean }).checkVisibility = () => false;
    expect(isElementRendered(element)).toBe(false);
    (element as Element & { checkVisibility: () => boolean }).checkVisibility = () => true;
    expect(isElementRendered(element)).toBe(true);
  });
});

describe('a pinned element that stops rendering', () => {
  function pinParagraph(): Element {
    document.body.innerHTML = '<p id="copy" style="font-size: 32px">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);
    return element;
  }

  it('says so in the panel, dims the readings, and clears the bands', () => {
    pinParagraph();
    overlay.setPinnedHidden(true);

    const panel = overlay.root.getElementById('panel') as HTMLElement;
    const text = (panel.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Element is not rendered right now');
    // The last readings are still there to read.
    expect(text).toContain('32px');
    expect(panel.dataset.hiddenElement).toBe('true');
    expect((overlay.root.getElementById('band-content') as HTMLElement).style.display).toBe('none');
  });

  it('recovers on its own when the element renders again', () => {
    pinParagraph();
    overlay.setPinnedHidden(true);
    overlay.setPinnedHidden(false);

    const panel = overlay.root.getElementById('panel') as HTMLElement;
    expect((panel.textContent ?? '')).not.toContain('Element is not rendered right now');
    expect(panel.dataset.hiddenElement).toBe('false');
  });
});

describe('panel affordances', () => {
  it('shows the ArrowUp tip once per session', () => {
    document.body.innerHTML = '<p id="a">One</p><p id="b">Two</p>';
    const first = document.getElementById('a') as Element;
    const second = document.getElementById('b') as Element;
    overlay.setMode('active');

    overlay.setPinned(buildSnapshot(first, { deep: false }), first);
    expect(overlay.root.getElementById('panel')?.textContent).toContain(
      'Tip: ArrowUp selects the parent',
    );

    overlay.setPinned(buildSnapshot(second, { deep: false }), second);
    expect(overlay.root.getElementById('panel')?.textContent).not.toContain(
      'Tip: ArrowUp selects the parent',
    );
  });

  it('collapses the badge to its dot and back', () => {
    overlay.setMode('active');
    const badge = overlay.root.getElementById('badge') as HTMLElement;
    const collapse = overlay.root.getElementById('badge-collapse') as HTMLButtonElement;

    expect(badge.dataset.collapsed).toBe('false');
    expect(collapse.getAttribute('aria-label')).toBe('Collapse the Design Inspector badge');
    expect(collapse.querySelector('.dot')).not.toBeNull();

    collapse.click();
    expect(badge.dataset.collapsed).toBe('true');
    expect(collapse.getAttribute('aria-label')).toBe('Expand the Design Inspector badge');

    collapse.click();
    expect(badge.dataset.collapsed).toBe('false');
  });

  it('starts collapsed on a phone width viewport and expands from the dot (F6)', () => {
    const width = window.innerWidth;
    try {
      Object.defineProperty(window, 'innerWidth', {
        value: BADGE_COLLAPSE_WIDTH - 90,
        configurable: true,
      });
      const narrow = createOverlay(callbacks());
      try {
        narrow.setMode('active');
        const badge = narrow.root.getElementById('badge') as HTMLElement;
        const collapse = narrow.root.getElementById('badge-collapse') as HTMLButtonElement;
        expect(badge.dataset.collapsed).toBe('true');
        expect(collapse.getAttribute('aria-label')).toBe('Expand the Design Inspector badge');
        collapse.click();
        expect(badge.dataset.collapsed).toBe('false');
      } finally {
        narrow.destroy();
      }
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    }
  });

  it('collapses and expands as the viewport crosses the threshold (Z1)', () => {
    overlay.setMode('active');
    const badge = overlay.root.getElementById('badge') as HTMLElement;
    const collapse = overlay.root.getElementById('badge-collapse') as HTMLButtonElement;
    expect(badge.dataset.collapsed).toBe('false');

    withViewportWidth(BADGE_COLLAPSE_WIDTH - 90, () => {
      expect(badge.dataset.collapsed).toBe('true');
      expect(collapse.getAttribute('aria-expanded')).toBe('false');

      withViewportWidth(BADGE_COLLAPSE_WIDTH + 400, () => {
        expect(badge.dataset.collapsed).toBe('false');
        expect(collapse.getAttribute('aria-expanded')).toBe('true');
      });
    });
  });

  it('keeps an explicit collapse through a widening viewport (Z1)', () => {
    withViewportWidth(BADGE_COLLAPSE_WIDTH + 400, () => {
      overlay.setMode('active');
      const badge = overlay.root.getElementById('badge') as HTMLElement;
      const collapse = overlay.root.getElementById('badge-collapse') as HTMLButtonElement;

      collapse.click();
      expect(badge.dataset.collapsed).toBe('true');

      // A resize at any width leaves the user's own choice where it was.
      withViewportWidth(BADGE_COLLAPSE_WIDTH - 90, () => {
        expect(badge.dataset.collapsed).toBe('true');
      });
      withViewportWidth(BADGE_COLLAPSE_WIDTH + 800, () => {
        expect(badge.dataset.collapsed).toBe('true');
      });
    });
  });

  it('keeps an explicit expand through a narrowing viewport (Z1)', () => {
    withViewportWidth(BADGE_COLLAPSE_WIDTH - 90, () => {
      const narrow = createOverlay(callbacks());
      try {
        narrow.setMode('active');
        const badge = narrow.root.getElementById('badge') as HTMLElement;
        const collapse = narrow.root.getElementById('badge-collapse') as HTMLButtonElement;
        expect(badge.dataset.collapsed).toBe('true');

        collapse.click();
        expect(badge.dataset.collapsed).toBe('false');

        // Still narrow, and still the width it was already too small for.
        withViewportWidth(BADGE_COLLAPSE_WIDTH - 120, () => {
          expect(badge.dataset.collapsed).toBe('false');
        });
      } finally {
        narrow.destroy();
      }
    });
  });

  it('stops following the viewport once the overlay is destroyed (Z1)', () => {
    const gone = createOverlay(callbacks());
    gone.setMode('active');
    const badge = gone.root.getElementById('badge') as HTMLElement;
    expect(badge.dataset.collapsed).toBe('false');
    gone.destroy();

    withViewportWidth(BADGE_COLLAPSE_WIDTH - 90, () => {
      expect(badge.dataset.collapsed).toBe('false');
    });
  });

  it('caps the badge to the viewport and lets its row wrap (F6)', () => {
    const css = overlay.root.querySelector('style')?.textContent ?? '';
    expect(css).toContain('max-width: calc(100vw - 16px)');
    expect(css).toContain('flex-wrap: wrap');
  });

  it('hides the Escape hint with the rest of the row when collapsed (Z2)', () => {
    const css = overlay.root.querySelector('style')?.textContent ?? '';
    expect(css).toContain('#badge[data-collapsed="true"] #badge-escape');
  });

  it('drags the panel by its header and keeps that position', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    const panel = overlay.root.getElementById('panel') as HTMLElement;
    const head = panel.querySelector('.panel-head') as HTMLElement;
    head.setPointerCapture = () => undefined;
    head.releasePointerCapture = () => undefined;

    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'clientX', { value: 100 });
    Object.defineProperty(down, 'clientY', { value: 100 });
    head.dispatchEvent(down);

    const move = new MouseEvent('pointermove', { bubbles: true, cancelable: true });
    Object.defineProperty(move, 'clientX', { value: 160 });
    Object.defineProperty(move, 'clientY', { value: 180 });
    head.dispatchEvent(move);

    // The panel follows the pointer by the distance it moved.
    expect(panel.style.left).toBe('60px');
    expect(panel.style.top).toBe('80px');

    head.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    // A re-read repositions the panel, and the dragged place is kept.
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);
    expect(panel.style.left).toBe('60px');
    expect(panel.style.top).toBe('80px');
  });
});

describe('point-to-edge guides (competitive Tier 2 item 3)', () => {
  /** jsdom has no hit testing, so the sampler is driven from a rect map. */
  function stackFor(boxes: { element: Element; rect: DOMRect }[]): void {
    document.elementsFromPoint = ((x: number, y: number) => {
      const hits = boxes
        .filter(
          (box) =>
            x >= box.rect.x &&
            x < box.rect.x + box.rect.width &&
            y >= box.rect.y &&
            y < box.rect.y + box.rect.height,
        )
        .map((box) => box.element)
        .reverse();
      return [...hits, document.body, document.documentElement];
    }) as typeof document.elementsFromPoint;
  }

  const originalStack = document.elementsFromPoint;

  afterEach(() => {
    document.elementsFromPoint = originalStack;
  });

  it('draws four labelled guides and a pointer dot from the probe point', () => {
    document.body.innerHTML = '<div id="page"><div id="card">Card</div></div>';
    const page = document.getElementById('page') as Element;
    const card = document.getElementById('card') as Element;
    stackFor([
      { element: page, rect: domRect(0, 0, 1200, 900) },
      { element: card, rect: domRect(100, 200, 300, 160) },
    ]);

    overlay.setMode('active');
    overlay.setEdges({ x: 250, y: 280 });

    const layer = overlay.root.getElementById('edge-layer') as HTMLElement;
    expect(layer.querySelectorAll('.edge-guide')).toHaveLength(4);
    expect(layer.querySelectorAll('.edge-dot')).toHaveLength(1);
    const labels = Array.from(layer.querySelectorAll('.edge-guide-label')).map(
      (node) => node.textContent ?? '',
    );
    expect(labels).toHaveLength(4);
    expect(labels.every((label) => /^>?\d+(\.\d+)?px$/.test(label))).toBe(true);
  });

  it('names its method and reports an unreached edge as a lower bound', () => {
    document.body.innerHTML = '<div id="page">Page</div>';
    const page = document.getElementById('page') as Element;
    stackFor([{ element: page, rect: domRect(0, 0, 1200, 900) }]);

    overlay.setMode('active');
    overlay.setEdges({ x: 20, y: 30 });

    const card = overlay.root.getElementById('edge-card') as HTMLElement;
    expect(card.hidden).toBe(false);
    const text = (card.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Nearest element edges, geometric');
    expect(text).toContain('more than');
  });

  it('holds a locked reading and reports it as locked', () => {
    document.body.innerHTML = '<div id="page">Page</div>';
    const page = document.getElementById('page') as Element;
    stackFor([{ element: page, rect: domRect(0, 0, 1200, 900) }]);

    overlay.setMode('active');
    expect(overlay.edgesLocked()).toBe(false);
    overlay.setEdges({ x: 100, y: 100 }, { locked: true });
    expect(overlay.edgesLocked()).toBe(true);
    expect((overlay.root.getElementById('edge-card')?.textContent ?? '')).toContain('locked');

    overlay.setEdges(null);
    expect(overlay.edgesLocked()).toBe(false);
    expect((overlay.root.getElementById('edge-card') as HTMLElement).hidden).toBe(true);
    expect(overlay.root.getElementById('edge-layer')?.children).toHaveLength(0);
  });

  it('puts the reading in the panel rather than a floating card when one is pinned', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    stackFor([{ element, rect: domRect(0, 0, 400, 100) }]);

    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);
    overlay.setEdges({ x: 50, y: 50 });

    const block = overlay.root.getElementById('edge-block') as HTMLElement;
    expect(block.hidden).toBe(false);
    expect((block.textContent ?? '')).toContain('Nearest element edges, geometric');
    expect((overlay.root.getElementById('edge-card') as HTMLElement).hidden).toBe(true);
  });
});

describe('rulers and guides', () => {
  /** Clicks a ruler to drop a guide at a viewport coordinate. */
  function dropGuideAt(axis: 'x' | 'y', position: number): void {
    const ruler = overlay.root.getElementById(axis === 'x' ? 'ruler-top' : 'ruler-left');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(click, 'clientX', { value: axis === 'x' ? position : 8 });
    Object.defineProperty(click, 'clientY', { value: axis === 'x' ? 8 : position });
    (ruler as HTMLElement).dispatchEvent(click);
  }

  /**
   * One press on the guide currently in the layer, as the capture-based drag
   * would deliver it. The node is re-queried because ending a drag repaints.
   */
  function pressGuide(): void {
    const layer = overlay.root.getElementById('guide-layer') as HTMLElement;
    const guide = layer.querySelector('.page-guide') as HTMLElement | null;
    if (!guide) return;
    guide.setPointerCapture = () => undefined;
    guide.releasePointerCapture = () => undefined;
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    guide.dispatchEvent(down);
    guide.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  }

  it('is off until the badge toggle asks for it', () => {
    overlay.setMode('active');
    const layer = overlay.root.getElementById('ruler-layer') as HTMLElement;
    const toggle = overlay.root.getElementById('badge-rulers') as HTMLButtonElement;
    expect(layer.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(overlay.rulersOn()).toBe(false);
  });

  it('draws ticks with labels on both rulers when it is on', () => {
    overlay.setMode('active');
    overlay.setRulers(true);

    const layer = overlay.root.getElementById('ruler-layer') as HTMLElement;
    expect(layer.hidden).toBe(false);
    expect((overlay.root.getElementById('badge-rulers') as HTMLElement).getAttribute('aria-pressed')).toBe('true');
    const top = overlay.root.getElementById('ruler-top') as HTMLElement;
    const left = overlay.root.getElementById('ruler-left') as HTMLElement;
    expect(top.querySelectorAll('.tick').length).toBeGreaterThan(0);
    expect(left.querySelectorAll('.tick').length).toBeGreaterThan(0);
    const labels = Array.from(top.querySelectorAll('.tick-label')).map((n) => n.textContent);
    expect(labels).toContain('0');
    expect(labels.every((label) => Number(label) % 100 === 0)).toBe(true);
  });

  it('drops a guide where a ruler is clicked, and says how to remove it', () => {
    overlay.setMode('active');
    overlay.setRulers(true);

    const guides = overlay.root.getElementById('guide-layer') as HTMLElement;
    dropGuideAt('x', 240);

    const guide = guides.querySelector('.page-guide') as HTMLElement;
    expect(guide).not.toBeNull();
    expect(guide.dataset.axis).toBe('x');
    expect(guide.style.left).toBe('240px');
    expect(guide.getAttribute('aria-label')).toContain('240px');
    expect(guide.getAttribute('aria-label')).toContain('double-click or press Delete to remove');
    // Delete has to have somewhere to be pressed.
    expect(guide.tabIndex).toBe(0);

    guide.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(guides.querySelectorAll('.page-guide')).toHaveLength(0);
  });

  it('removes a guide on a second pointerdown inside the double-click window', () => {
    overlay.setMode('active');
    overlay.setRulers(true);
    const guides = overlay.root.getElementById('guide-layer') as HTMLElement;
    dropGuideAt('x', 240);

    // The layer captures the pointer for dragging, so the browser never
    // delivers a dblclick and the two presses have to be counted here.
    pressGuide();
    expect(guides.querySelectorAll('.page-guide')).toHaveLength(1);
    pressGuide();
    expect(guides.querySelectorAll('.page-guide')).toHaveLength(0);
  });

  it('keeps a guide when the two presses are too far apart', () => {
    vi.useFakeTimers();
    try {
      overlay.setMode('active');
      overlay.setRulers(true);
      const guides = overlay.root.getElementById('guide-layer') as HTMLElement;
      dropGuideAt('x', 240);

      pressGuide();
      vi.advanceTimersByTime(GUIDE_DOUBLE_MS + 50);
      pressGuide();
      expect(guides.querySelectorAll('.page-guide')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a guide from its own control and from the Delete key', () => {
    overlay.setMode('active');
    overlay.setRulers(true);
    const guides = overlay.root.getElementById('guide-layer') as HTMLElement;

    dropGuideAt('x', 240);
    const first = guides.querySelector('.page-guide') as HTMLElement;
    const control = first.querySelector('[data-role="guide-remove"]') as HTMLButtonElement;
    expect(control).not.toBeNull();
    expect(control.getAttribute('aria-label')).toContain('Remove the guide');
    control.setPointerCapture = () => undefined;
    control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(guides.querySelectorAll('.page-guide')).toHaveLength(0);

    dropGuideAt('y', 120);
    const second = guides.querySelector('.page-guide') as HTMLElement;
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(guides.querySelectorAll('.page-guide')).toHaveLength(0);

    dropGuideAt('y', 160);
    const third = guides.querySelector('.page-guide') as HTMLElement;
    third.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(guides.querySelectorAll('.page-guide')).toHaveLength(0);
  });

  it('drags a guide without rebuilding the node under the pointer', () => {
    overlay.setMode('active');
    overlay.setRulers(true);

    const left = overlay.root.getElementById('ruler-left') as HTMLElement;
    const guides = overlay.root.getElementById('guide-layer') as HTMLElement;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(click, 'clientY', { value: 120 });
    left.dispatchEvent(click);

    const guide = guides.querySelector('.page-guide') as HTMLElement;
    guide.setPointerCapture = () => undefined;
    guide.releasePointerCapture = () => undefined;
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'pointerId', { value: 1 });
    guide.dispatchEvent(down);

    const move = new MouseEvent('pointermove', { bubbles: true, cancelable: true });
    Object.defineProperty(move, 'clientY', { value: 300 });
    guides.dispatchEvent(move);

    expect(guide.isConnected).toBe(true);
    expect(guide.style.top).toBe('300px');

    guides.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect((guides.querySelector('.page-guide') as HTMLElement).style.top).toBe('300px');
  });

  it('marks the hovered element edges on both rulers', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setRulers(true);

    withStubbedRects(
      () => {
        overlay.setHover(buildSnapshot(element, { deep: false }), element);
      },
      () => domRect(40, 80, 120, 30),
    );

    const top = overlay.root.getElementById('ruler-top') as HTMLElement;
    const left = overlay.root.getElementById('ruler-left') as HTMLElement;
    expect(top.querySelectorAll('.ruler-mark')).toHaveLength(2);
    expect(left.querySelectorAll('.ruler-mark')).toHaveLength(2);
  });
});

describe('closest-standard Tailwind (PRD EXP-02 mode 2)', () => {
  it('offers the button beside Tailwind in every category section menu', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    const labels = Array.from(overlay.root.querySelectorAll('.copy-menu button')).map(
      (node) => node.textContent,
    );
    expect(labels).toContain('CSS');
    expect(labels).toContain('Tailwind');
    expect(labels).toContain('Closest standard');
    // The head itself carries one control, so it stays on one line.
    const heads = Array.from(overlay.root.querySelectorAll('.section-head'));
    expect(heads.every((head) => head.querySelectorAll('button').length <= 1)).toBe(true);
  });

  it('reports "Copy unavailable" while the adapter is missing, and never throws', () => {
    overlay.destroy();
    overlay = createOverlay({
      ...callbacks(),
      tailwindClosestFor: () => {
        throw new Error('toTailwindClosest not implemented');
      },
    });
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    const button = Array.from(overlay.root.querySelectorAll('button')).find(
      (node) => node.textContent === 'Closest standard',
    ) as HTMLButtonElement;
    expect(() => button.click()).not.toThrow();
    expect(button.textContent).toBe('Copy unavailable');
  });

  it('copies what the adapter produced when it is there', async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } },
    });
    overlay.destroy();
    overlay = createOverlay({ ...callbacks(), tailwindClosestFor: () => 'text-lg font-semibold' });
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    const button = Array.from(overlay.root.querySelectorAll('button')).find(
      (node) => node.textContent === 'Closest standard',
    ) as HTMLButtonElement;
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(copied).toContain('text-lg font-semibold');
  });
});

describe('breadcrumb length (V3)', () => {
  it('collapses the middle of a deep chain behind a count that expands', () => {
    document.body.innerHTML =
      '<div id="a1"><div id="a2"><div id="a3"><div id="a4"><div id="a5">' +
      '<p id="leaf">Deep</p></div></div></div></div></div>';
    const leaf = document.getElementById('leaf') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(leaf, { deep: false }), leaf);

    const crumbs = overlay.root.querySelector('.crumbs') as HTMLElement;
    const more = crumbs.querySelector('.crumb-more') as HTMLButtonElement;
    expect(more).not.toBeNull();
    const collapsed = crumbs.querySelectorAll('button.crumb').length;
    expect(more.textContent).toMatch(/^\+\d+$/);

    more.click();
    expect(crumbs.querySelector('.crumb-more')).toBeNull();
    expect(crumbs.querySelectorAll('button.crumb').length).toBeGreaterThan(collapsed);
    // The pinned element keeps its own chip at the end either way.
    expect(crumbs.querySelector('.crumb-current')?.textContent).toContain('p#leaf');
  });
});

describe('semantic parent breadcrumb', () => {
  it('shows the promoted wrapper as a trailing child chip that selects it', () => {
    let selectedChild = 0;
    overlay.destroy();
    overlay = createOverlay({ ...callbacks(), onSelectChild: () => (selectedChild += 1) });

    document.body.innerHTML = '<h2 id="head"><span id="text">Wrapped</span></h2>';
    const head = document.getElementById('head') as Element;
    const span = document.getElementById('text') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(head, { deep: false }), head, { child: span });

    const crumb = overlay.root.querySelector('[data-role="child-crumb"]') as HTMLButtonElement;
    expect(crumb).not.toBeNull();
    expect(crumb.textContent).toContain('span');
    crumb.click();
    expect(selectedChild).toBe(1);
  });

  it('shows no child chip for an ordinary selection', () => {
    document.body.innerHTML = '<h2 id="head">Plain</h2>';
    const head = document.getElementById('head') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(head, { deep: false }), head, { child: null });
    expect(overlay.root.querySelector('[data-role="child-crumb"]')).toBeNull();
  });

  it('reflects the preference on the badge toggle', () => {
    overlay.setMode('active');
    const toggle = overlay.root.getElementById('badge-semantic') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    overlay.setSemanticParents(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('escape stack hint (Z2)', () => {
  function hint(): string {
    return (overlay.root.getElementById('badge-escape') as HTMLElement).textContent ?? '';
  }

  it('orders the stack: form, edge lock, measure lock, pin, exit', () => {
    const base = { menuOpen: false, edgesLocked: false, measureLocked: false, pinned: false };
    expect(nextEscapeStep(base)).toBe('exit');
    expect(nextEscapeStep({ ...base, pinned: true })).toBe('unpin');
    expect(nextEscapeStep({ ...base, pinned: true, measureLocked: true })).toBe('measure');
    expect(
      nextEscapeStep({ ...base, pinned: true, measureLocked: true, edgesLocked: true }),
    ).toBe('edges');
    expect(
      nextEscapeStep({ menuOpen: true, edgesLocked: true, measureLocked: true, pinned: true }),
    ).toBe('menu');
  });

  it('gives every step its own label', () => {
    expect(escapeHintFor({ menuOpen: false, edgesLocked: false, measureLocked: false, pinned: false }))
      .toBe('Esc: exit');
    expect(new Set(Object.values(ESCAPE_HINTS)).size).toBe(5);
    Object.values(ESCAPE_HINTS).forEach((label) => expect(label.startsWith('Esc: ')).toBe(true));
  });

  it('says exit while inspecting with nothing held', () => {
    overlay.setMode('active');
    expect(hint()).toBe('Esc: exit');
  });

  it('says unpin once an element is pinned, and exit again after unpinning', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');

    overlay.setPinned(buildSnapshot(element, { deep: false }), element);
    expect(hint()).toBe('Esc: unpin');

    overlay.setPinned(null, null);
    expect(hint()).toBe('Esc: exit');
  });

  it('says release measure lock while a measurement is locked', () => {
    document.body.innerHTML = '<p id="one">One</p><p id="two">Two</p>';
    const one = document.getElementById('one') as Element;
    const two = document.getElementById('two') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(one, { deep: false }), one);

    // An unlocked hover measurement is not something Escape has to release.
    overlay.setMeasure(two);
    expect(hint()).toBe('Esc: unpin');

    overlay.setMeasure(two, { locked: true });
    expect(hint()).toBe('Esc: release measure lock');

    overlay.setMeasure(null, { locked: false });
    expect(hint()).toBe('Esc: unpin');
  });

  it('says release edge lock, which the measurement lock does not outrank', () => {
    document.body.innerHTML = '<p id="one">One</p><p id="two">Two</p>';
    const one = document.getElementById('one') as Element;
    const two = document.getElementById('two') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(one, { deep: false }), one);
    overlay.setMeasure(two, { locked: true });

    overlay.setEdges({ x: 40, y: 40 }, { locked: true });
    expect(hint()).toBe('Esc: release edge lock');

    overlay.setEdges(null);
    expect(hint()).toBe('Esc: release measure lock');
  });

  it('says close form while the save form is open, and closes with the menu', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    const toggle = overlay.root.querySelector(
      'button[aria-label="Save reference"]',
    ) as HTMLButtonElement;
    toggle.click();
    expect(hint()).toBe('Esc: close form');

    expect(overlay.closeMenu()).toBe(true);
    expect(hint()).toBe('Esc: unpin');
  });

  it('follows a paused inspector and clears nothing until the mode goes off', () => {
    document.body.innerHTML = '<p id="copy">Hello</p>';
    const element = document.getElementById('copy') as Element;
    overlay.setMode('active');
    overlay.setPinned(buildSnapshot(element, { deep: false }), element);

    overlay.setMode('paused');
    expect(hint()).toBe('Esc: unpin');

    overlay.setMode('off');
    expect(hint()).toBe('Esc: exit');
  });

  it('lists the whole order in the panel tip, after the ArrowUp tip has been shown', () => {
    document.body.innerHTML = '<p id="one">One</p><p id="two">Two</p><p id="three">Three</p>';
    const one = document.getElementById('one') as Element;
    const two = document.getElementById('two') as Element;
    const three = document.getElementById('three') as Element;
    overlay.setMode('active');

    overlay.setPinned(buildSnapshot(one, { deep: false }), one);
    const panel = overlay.root.getElementById('panel') as HTMLElement;
    expect(panel.textContent).toContain('Tip: ArrowUp selects the parent');
    expect(panel.textContent).not.toContain(ESCAPE_ORDER_TIP);

    // A live re-read of the same element keeps the tip it was given.
    overlay.setPinned(buildSnapshot(one, { deep: false }), one);
    expect(panel.textContent).toContain('Tip: ArrowUp selects the parent');

    overlay.setPinned(buildSnapshot(two, { deep: false }), two);
    expect(panel.textContent).not.toContain('Tip: ArrowUp selects the parent');
    expect(panel.textContent).toContain(ESCAPE_ORDER_TIP);

    overlay.setPinned(buildSnapshot(three, { deep: false }), three);
    expect(panel.textContent).not.toContain(ESCAPE_ORDER_TIP);
    expect(panel.querySelector('.tip')).toBeNull();
  });

  it('names every release in the order the panel tip states', () => {
    expect(ESCAPE_ORDER_TIP).toContain('save form');
    expect(ESCAPE_ORDER_TIP).toContain('edge lock');
    expect(ESCAPE_ORDER_TIP).toContain('measurement lock');
    expect(ESCAPE_ORDER_TIP).toContain('the pin');
    expect(ESCAPE_ORDER_TIP).toContain('exits');
  });
});

// ---------------------------------------------------------------------------
// Font identity in the pinned panel (workstream FONT, PRD TYP-01)

/**
 * A pinned reading of a heading whose CSS calls the family by a nickname and
 * whose file sits on a CDN: the superpower.com case the panel was failing at.
 */
function pinAliasedFont(overrides: Partial<TypographyReading> = {}): {
  snapshot: ElementSnapshot;
  element: Element;
} {
  document.body.innerHTML = '<h1 id="hero">Your health, handled</h1>';
  const element = document.getElementById('hero') as Element;
  const snapshot = buildSnapshot(element, { deep: false });
  const typography = snapshot.typography as TypographyReading;
  Object.assign(typography, {
    familyStack: ['Nb international pro webfont', 'sans-serif'],
    familyReading: 'Nb international pro webfont',
    familyConfidence: 'matched',
    renderCheck: 'rendered',
    weight: 500,
    style: 'normal',
    source: {
      kind: 'self-hosted',
      url: 'https://cdn.prod.website-files.com/6650/nb-int-pro-b7f3a91c2d.woff2',
      format: 'woff2',
      subset: null,
    },
    ...overrides,
  } satisfies Partial<TypographyReading>);
  return { snapshot, element };
}

const NB_IDENTITY: FontIdentity = {
  family: 'NB International Pro',
  subfamily: 'Medium',
  fullName: 'NB International Pro Medium',
  postscriptName: 'NBInternationalPro-Medium',
  designer: 'Stefan Gandl',
  manufacturer: 'Neubau Berlin',
  version: '1.004',
  license: 'Licensed for web use only. Redistribution is not permitted.',
  licenseUrl: 'https://example.invalid/eula',
  axes: [{ tag: 'wght', name: 'Weight', min: 100, max: 900, default: 400 }],
  container: 'woff2',
  fileSize: 49152,
  evidence: 'name-table',
  url: 'https://cdn.prod.website-files.com/6650/nb-int-pro-b7f3a91c2d.woff2',
};

describe('pinned panel: font identity', () => {
  function panelText(): string {
    return (overlay.root.getElementById('panel')?.textContent ?? '').replace(/\s+/g, ' ');
  }

  function findButton(label: string): HTMLButtonElement | undefined {
    return Array.from(overlay.root.querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;
  }

  it('shows the source as one quiet line and never prints the raw URL', () => {
    const { snapshot, element } = pinAliasedFont();
    overlay.setMode('active');
    overlay.setPinned(snapshot, element);

    const text = panelText();
    expect(text).toContain('Self-hosted on cdn.prod.website-files.com · woff2');
    expect(text).not.toContain('nb-int-pro-b7f3a91c2d.woff2');
    expect(findButton('Identify font file')).not.toBeUndefined();
    expect(findButton('Download')).not.toBeUndefined();
    // The address is behind the button, never printed in the row.
    expect(findButton('Copy URL')).not.toBeUndefined();
  });

  it('carries the confidence as a badge that explains its own evidence', () => {
    const { snapshot, element } = pinAliasedFont();
    overlay.setMode('active');
    overlay.setPinned(snapshot, element);

    const badge = Array.from(overlay.root.querySelectorAll('.chip')).find(
      (node) => node.textContent === 'matched',
    ) as HTMLElement | undefined;
    expect(badge).not.toBeUndefined();
    expect(badge?.title).toContain('Not proof');
  });

  it('replaces the alias with the typeface name once the file has been read', async () => {
    overlay.destroy();
    overlay = createOverlay({
      ...callbacks(),
      onIdentifyFont: () => Promise.resolve(NB_IDENTITY),
    });

    const { snapshot, element } = pinAliasedFont();
    overlay.setMode('active');
    overlay.setPinned(snapshot, element);
    expect(panelText()).toContain('Nb international pro webfont');

    const identify = findButton('Identify font file') as HTMLButtonElement;
    identify.click();
    await Promise.resolve();
    await Promise.resolve();

    const text = panelText();
    expect(text).toContain('NB International Pro');
    // The site's own nickname is kept, labelled as what it is.
    expect(text).toContain('Declared as');
    expect(text).toContain('Medium · 500');
    expect(text).toContain('by Stefan Gandl for Neubau Berlin');
    expect(text).toContain('Version 1.004');
    expect(text).toContain('wght 100 to 900');
    expect(text).toContain('48 KB');
    // The offer is gone once it has been taken.
    expect(findButton('Identify font file')).toBeUndefined();

    // The reading now carries the identity, so an export taken after this
    // press names the typeface rather than the alias.
    expect(snapshot.typography?.identity?.family).toBe('NB International Pro');
  });

  it('reports a refusal beside the button and lets the reader try again', async () => {
    overlay.destroy();
    overlay = createOverlay({
      ...callbacks(),
      onIdentifyFont: () => Promise.resolve('The font host refused the request (403).'),
    });

    const { snapshot, element } = pinAliasedFont();
    overlay.setMode('active');
    overlay.setPinned(snapshot, element);
    (findButton('Identify font file') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(panelText()).toContain('The font host refused the request (403).');
    const retry = findButton('Identify font file');
    expect(retry?.disabled).toBe(false);
  });

  it('offers a provider link instead of a download for a Google Fonts family', () => {
    const { snapshot, element } = pinAliasedFont({
      familyStack: ['Inter', 'sans-serif'],
      familyReading: 'Inter',
      source: {
        kind: 'google',
        url: 'https://fonts.gstatic.com/s/inter/v13/abc.woff2',
        format: 'woff2',
        subset: null,
      },
    });
    overlay.setMode('active');
    overlay.setPinned(snapshot, element);

    const link = Array.from(overlay.root.querySelectorAll('a.quiet')).find((node) =>
      node.textContent?.includes('Google Fonts'),
    ) as HTMLAnchorElement | undefined;
    expect(link?.href).toBe('https://fonts.google.com/specimen/Inter');
    expect(link?.rel).toContain('noreferrer');
  });
});
