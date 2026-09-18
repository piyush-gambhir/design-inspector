import { describe, expect, it } from 'vitest';
import { toCss } from '@/lib/exports';
import { cardSnapshot, gridSnapshot, headingSnapshot } from './fixtures/snapshots';

describe('toCss header and selector', () => {
  it('labels the output as computed styles at the captured viewport', () => {
    expect(toCss(headingSnapshot, 'typography').split('\n')[0]).toBe(
      '/* Design Inspector: computed styles for h1 "Build faster" at 1440x900, root 16px. Not authored CSS; responsive rules and interaction states not included. */',
    );
  });

  it('sanitizes the label into a usable class selector', () => {
    expect(toCss(headingSnapshot, 'typography')).toContain('.h1-build-faster {');
    expect(toCss(cardSnapshot, 'typography')).toContain('.div-card {');
    expect(toCss(gridSnapshot, 'typography')).toContain('.section-features {');
  });
});

describe('toCss typography set', () => {
  const css = toCss(headingSnapshot, 'typography');

  it('emits only the typography property set', () => {
    expect(properties(css)).toEqual([
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-transform',
      'text-decoration',
      'color',
    ]);
  });

  it('quotes family names with spaces and keeps the fallback stack', () => {
    expect(css).toContain('font-family: "Inter Display", Inter, system-ui, sans-serif;');
  });

  it('keeps a lossy color raw and labels it as an approximation', () => {
    expect(css).toContain('color: oklch(0.18 0.01 250); /* sRGB approximation */');
  });

  it('omits font-style, font-variant, and letter-spacing when they carry nothing', () => {
    const plain = toCss(
      {
        ...headingSnapshot,
        typography: {
          ...headingSnapshot.typography!,
          letterSpacingPx: 0,
          lineHeightRaw: 'normal',
          lineHeightPx: null,
        },
      },
      'typography',
    );
    expect(plain).not.toContain('letter-spacing');
    expect(plain).not.toContain('font-style');
    expect(plain).not.toContain('font-variant');
    expect(plain).toContain('line-height: normal;');
  });

  it('emits nothing for an element without text', () => {
    expect(toCss(cardSnapshot, 'typography')).toBe(
      `${toCss(cardSnapshot, 'typography').split('\n')[0]}\n.div-card {\n}\n`,
    );
  });
});

describe('toCss surfaces set', () => {
  const css = toCss(cardSnapshot, 'surfaces');

  it('collapses four equal borders into the shorthand', () => {
    expect(css).toContain('border: 1px solid rgba(0, 0, 0, 0.08);');
    expect(css).not.toContain('border-top-width');
  });

  it('keeps unequal radii as four values and drops an all-zero radius', () => {
    expect(css).toContain('border-radius: 16px 16px 4px 16px;');
    expect(toCss(headingSnapshot, 'surfaces')).not.toContain('border-radius');
  });

  it('joins shadow entries and keeps the filters', () => {
    expect(css).toContain(
      'box-shadow: rgba(0, 0, 0, 0.06) 0px 1px 2px 0px, rgba(0, 0, 0, 0.08) 0px 12px 32px -8px;',
    );
    expect(css).toContain('filter: saturate(1.1);');
    expect(css).toContain('backdrop-filter: blur(12px);');
    expect(css).toContain('opacity: 0.96;');
  });

  it('omits a fully transparent background with no layers, and none-valued filters', () => {
    const plain = toCss(headingSnapshot, 'surfaces');
    expect(plain).not.toContain('background-color');
    expect(plain).not.toContain('filter');
    expect(plain).not.toContain('opacity');
  });

  it('lists only the visible border sides', () => {
    const css2 = toCss(gridSnapshot, 'surfaces');
    expect(properties(css2)).toEqual([
      'background-color',
      'border-top-width',
      'border-top-style',
      'border-top-color',
    ]);
  });
});

describe('toCss layout set', () => {
  const css = toCss(gridSnapshot, 'layout');

  it('collapses padding and margin, including negatives', () => {
    expect(css).toContain('padding: 96px 24px;');
    expect(css).toContain('margin: -8px 0;');
  });

  it('formats numbers with at most three decimals and no trailing zeros', () => {
    expect(css).toContain('height: 612.333px;');
    expect(css).toContain('width: 1200px;');
    expect(toCss(cardSnapshot, 'layout')).toContain('height: 244.5px;');
  });

  it('emits grid properties and item placement for a grid container', () => {
    expect(css).toContain('grid-template-columns: 368px 368px 368px;');
    expect(css).toContain('grid-column: span 2 / auto;');
    expect(css).toContain('row-gap: 32px;');
    expect(css).toContain('column-gap: 48px;');
    expect(css).not.toContain('flex-direction');
  });

  it('emits flex properties for a flex container', () => {
    const flexCss = toCss(cardSnapshot, 'layout');
    expect(flexCss).toContain('flex-direction: column;');
    expect(flexCss).toContain('justify-content: space-between;');
    expect(flexCss).toContain('position: relative;');
    expect(flexCss).toContain('top: 0px;');
    expect(flexCss).toContain('z-index: 2;');
    expect(flexCss).not.toContain('grid-template-columns');
  });

  it('omits static position, auto insets, auto z-index, and zero minimums', () => {
    expect(css).not.toContain('position:');
    expect(css).not.toContain('z-index');
    expect(css).not.toContain('top:');
    expect(css).not.toContain('min-height');
    expect(css).toContain('min-width: 320px;');
  });

  it('shows authored expressions as trailing comments', () => {
    expect(css).toContain('max-width: 1200px; /* authored: max-width: clamp(320px, 90vw, 1200px) */');
    expect(css).toContain('/* authored: font-size: clamp(1rem, 2vw, 1.25rem) */');
  });
});

describe('toCss all', () => {
  it('concatenates typography, surfaces, and layout in order without duplicates', () => {
    const all = properties(toCss(cardSnapshot, 'all'));
    expect(all.indexOf('background-color')).toBeLessThan(all.indexOf('display'));
    expect(new Set(all).size).toBe(all.length);
  });

  it('starts with typography when the element has text', () => {
    expect(properties(toCss(headingSnapshot, 'all'))[0]).toBe('font-family');
  });
});

function properties(css: string): string[] {
  return css
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith(';') || line.includes('; /*'))
    .map((line) => line.slice(0, line.indexOf(':')));
}
