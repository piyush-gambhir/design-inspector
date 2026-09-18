import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScanCancelled, startScan } from '../lib/inspector/scan';

// jsdom computes no layout, so visibility and geometry are stubbed. Every
// element with data-hidden="true" plays the part of a hidden element and every
// element with data-empty="true" the part of a zero sized one.
const originalCheckVisibility = (
  Element.prototype as unknown as { checkVisibility?: () => boolean }
).checkVisibility;
const originalRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  (Element.prototype as unknown as { checkVisibility: () => boolean }).checkVisibility =
    function checkVisibility(this: Element) {
      return this.getAttribute('data-hidden') !== 'true';
    };
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
    const empty = this.getAttribute('data-empty') === 'true';
    const size = empty ? 0 : 40;
    return {
      x: 0,
      y: 0,
      width: size,
      height: size,
      top: 0,
      left: 0,
      right: size,
      bottom: size,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

afterEach(() => {
  if (originalCheckVisibility) {
    (Element.prototype as unknown as { checkVisibility?: () => boolean }).checkVisibility =
      originalCheckVisibility;
  } else {
    delete (Element.prototype as unknown as { checkVisibility?: () => boolean }).checkVisibility;
  }
  Element.prototype.getBoundingClientRect = originalRect;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function fill(count: number): void {
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) parts.push(`<p id="p${i}">Item ${i}</p>`);
  document.body.innerHTML = parts.join('');
}

describe('startScan', () => {
  it('produces a summary with scope counts and coverage notes', async () => {
    document.body.innerHTML = `
      <section id="hero"><h1 id="t">Hi</h1></section>
      <nav id="mobile-nav" data-hidden="true"><a href="#a">Work</a></nav>
      <span id="collapsed" data-empty="true"></span>`;

    const summary = await startScan({ cap: 100 }).summary;
    expect(summary.scope.scannedElements).toBeGreaterThan(0);
    expect(summary.scope.capped).toBe(false);
    expect(summary.scope.cap).toBe(100);
    expect(summary.scope.durationMs).toBeGreaterThanOrEqual(0);
    expect(summary.scope.notes.join(' ')).toContain('Other breakpoints and unopened states');
    expect(summary.source.url).toBeTypeOf('string');
  });

  it('counts skipped elements by reason', async () => {
    document.body.innerHTML = `
      <p id="visible">Shown</p>
      <p id="gone" data-hidden="true">Hidden</p>
      <p id="flat" data-empty="true">Zero</p>`;

    const summary = await startScan({ cap: 100 }).summary;
    const byReason = new Map(summary.scope.skipped.map((entry) => [entry.reason, entry.count]));
    expect(byReason.get('hidden')).toBe(1);
    expect(byReason.get('zero-size')).toBe(1);
  });

  it('skips script, style, and template subtrees', async () => {
    document.body.innerHTML = `
      <p id="keep">Shown</p>
      <script>const a = 1;</script>
      <style>.a { color: red }</style>
      <template><p>never</p></template>`;

    const summary = await startScan({ cap: 100 }).summary;
    expect(summary.scope.eligibleElements).toBe(1);
  });

  it('stops at the cap and says so', async () => {
    fill(50);
    const summary = await startScan({ cap: 10 }).summary;
    expect(summary.scope.capped).toBe(true);
    expect(summary.scope.scannedElements).toBe(10);
    expect(summary.scope.notes.join(' ')).toContain('cap of 10');
  });

  it('reports progress after each chunk', async () => {
    fill(450);
    const progress: number[] = [];
    await startScan({ cap: 5000, onProgress: (scanned) => progress.push(scanned) }).summary;
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[progress.length - 1]).toBeGreaterThan(progress[0] as number);
  });

  it('descends into open shadow roots and counts them', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host') as HTMLElement;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p id="inside">Shadow text</p>';

    const summary = await startScan({ cap: 100 }).summary;
    expect(summary.scope.openShadowRoots).toBe(1);
    expect(summary.scope.eligibleElements).toBeGreaterThan(1);
  });

  it('counts frames whose document cannot be reached', async () => {
    document.body.innerHTML = '<iframe id="frame" src="https://example.com/"></iframe>';
    const frame = document.getElementById('frame') as HTMLIFrameElement;
    Object.defineProperty(frame, 'contentDocument', {
      get() {
        throw new Error('cross origin');
      },
    });

    const summary = await startScan({ cap: 100 }).summary;
    expect(summary.scope.inaccessibleFrames).toBe(1);
  });

  it('rejects with ScanCancelled when cancelled', async () => {
    fill(600);
    const run = startScan({ cap: 5000 });
    run.cancel();
    await expect(run.summary).rejects.toBeInstanceOf(ScanCancelled);
  });
});
