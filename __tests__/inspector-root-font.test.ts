// Fluid root font size detection (workstream V1).
//
// A page whose root font size is written in viewport units makes every px
// reading true at one window width only. The panel has to say so, which means
// the reading has to know, which is what these rules do.
import { afterEach, describe, expect, it } from 'vitest';

import {
  isFluidRootFontSize,
  readAuthoredRootFontSize,
  readSourceContext,
  resetRootFontSizeCache,
} from '../lib/inspector/readings';
import { formatRootFontSize, formatSizeLabel } from '../lib/ui/shared/format';

function styleSheet(css: string): HTMLStyleElement {
  const node = document.createElement('style');
  node.textContent = css;
  document.head.appendChild(node);
  return node;
}

afterEach(() => {
  document.head.querySelectorAll('style').forEach((node) => node.remove());
  document.documentElement.style.fontSize = '';
  // The walk is cached per document while the sheet list is unchanged, and
  // these fixtures swap sheets faster than any page would.
  resetRootFontSizeCache();
});

describe('readAuthoredRootFontSize', () => {
  // jsdom's CSS parser drops clamp(), so these fixtures use the viewport-unit
  // and calc() forms it keeps. The clamp() path is covered by the rule tests
  // below and end to end in Chrome against e2e/fixtures/inspector-fluid.html.
  it('prefers the inline style on the root element', () => {
    styleSheet(':root { font-size: 16px; }');
    document.documentElement.style.fontSize = 'calc(14px + 0.5vw)';
    expect(readAuthoredRootFontSize(document)).toBe('calc(14px + 0.5vw)');
  });

  it('reads an html rule from a same-origin stylesheet', () => {
    styleSheet('html { font-size: 62.5%; }');
    expect(readAuthoredRootFontSize(document)).toBe('62.5%');
  });

  it('reads a :root rule', () => {
    styleSheet(':root { color: red; font-size: 20px; }');
    expect(readAuthoredRootFontSize(document)).toBe('20px');
  });

  it('takes the last declaration when several rules style the root', () => {
    styleSheet('html { font-size: 16px; }');
    styleSheet(':root { font-size: 2vw; }');
    expect(readAuthoredRootFontSize(document)).toBe('2vw');
  });

  it('ignores rules that style something other than the root', () => {
    styleSheet('body { font-size: 18px; } .lead { font-size: 2rem; }');
    expect(readAuthoredRootFontSize(document)).toBeNull();
  });

  it('descends into a media query', () => {
    styleSheet('@media (min-width: 1px) { html { font-size: 2vw; } }');
    expect(readAuthoredRootFontSize(document)).toBe('2vw');
  });

  it('returns null when nothing declares a root size', () => {
    expect(readAuthoredRootFontSize(document)).toBeNull();
  });
});

describe('isFluidRootFontSize', () => {
  it('reads clamp() as fluid', () => {
    expect(isFluidRootFontSize('clamp(14px, 1vw, 18px)', 14.33)).toBe(true);
  });

  it('reads a viewport unit as fluid, including inside calc()', () => {
    expect(isFluidRootFontSize('1.2vw', 17.28)).toBe(true);
    expect(isFluidRootFontSize('calc(14px + 0.5vw)', 21.2)).toBe(true);
    expect(isFluidRootFontSize('calc(1rem + 2vmin)', 30)).toBe(true);
  });

  it('reads a fixed authored value as stable', () => {
    expect(isFluidRootFontSize('16px', 16)).toBe(false);
    expect(isFluidRootFontSize('1.25rem', 20)).toBe(false);
  });

  it('ignores percentages, whose parent is the browser default and not the viewport', () => {
    expect(isFluidRootFontSize('62.5%', 10)).toBe(false);
  });

  it('does not mistake a word containing a unit for a viewport unit', () => {
    expect(isFluidRootFontSize('var(--overview-size)', 16)).toBe(false);
  });

  it('falls back to the computed root when nothing is readable', () => {
    expect(isFluidRootFontSize(null, 14.33)).toBe(true);
    expect(isFluidRootFontSize(null, 16)).toBe(false);
    // Within the tolerance: a rounding artefact, not a fluid root.
    expect(isFluidRootFontSize(null, 16.004)).toBe(false);
    expect(isFluidRootFontSize('', 18.5)).toBe(true);
  });
});

describe('readSourceContext', () => {
  it('carries the authored root size and the fluid verdict', () => {
    styleSheet('html { font-size: calc(14px + 0.5vw); }');
    const source = readSourceContext(document);
    expect(source.rootFontSizeAuthored).toBe('calc(14px + 0.5vw)');
    expect(source.rootFontSizeFluid).toBe(true);
  });

  it('reports a plain root as stable', () => {
    styleSheet('html { font-size: 16px; }');
    const source = readSourceContext(document);
    expect(source.rootFontSizeAuthored).toBe('16px');
    expect(source.rootFontSizeFluid).toBe(false);
  });
});

describe('side panel size labels', () => {
  it('reads rem first on a fluid root', () => {
    expect(formatSizeLabel(16.12, 14.33, true)).toBe('1.125 rem · 16.12 px');
  });

  it('drops the rem for a whole px size on a plain root', () => {
    expect(formatSizeLabel(16, 16, false)).toBe('16 px');
  });

  it('reads px first with the rem equivalent otherwise', () => {
    expect(formatSizeLabel(16.12, 16, false)).toBe('16.12 px · 1.008 rem');
  });

  it('names the authored value in the Scope card', () => {
    expect(
      formatRootFontSize({
        rootFontSize: 14.33,
        rootFontSizeAuthored: 'clamp(14px, 1vw, 18px)',
        rootFontSizeFluid: true,
      }),
    ).toBe('14.33 px (fluid, from clamp(14px, 1vw, 18px))');
    expect(formatRootFontSize({ rootFontSize: 14.33, rootFontSizeFluid: true })).toBe(
      '14.33 px (fluid)',
    );
    expect(formatRootFontSize({ rootFontSize: 16 })).toBe('16 px');
  });
});
