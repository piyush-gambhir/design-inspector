import { describe, expect, it } from 'vitest';
import { toTailwind } from '@/lib/exports';
import { cardSnapshot, gridSnapshot, headingSnapshot } from './fixtures/snapshots';

describe('toTailwind assumption', () => {
  it('states the version and refuses to claim the site\'s own classes', () => {
    expect(toTailwind(headingSnapshot, 'all').assumption).toBe(
      "Tailwind v4 arbitrary-value classes generated from computed styles at 1440x900. Not the site's original classes or theme.",
    );
  });
});

describe('toTailwind typography', () => {
  const output = toTailwind(headingSnapshot, 'typography');
  const classes = output.classes.split(' ');

  it('emits leading next to the text size so the default coupling cannot change it', () => {
    const textIndex = classes.findIndex((token) => token.startsWith('text-['));
    expect(classes[textIndex]).toBe('text-[72px]');
    expect(classes[textIndex + 1]).toBe('leading-[75.6px]');
  });

  it('emits leading-normal when the line height is normal', () => {
    const normal = toTailwind(
      {
        ...headingSnapshot,
        typography: { ...headingSnapshot.typography!, lineHeightRaw: 'normal', lineHeightPx: null },
      },
      'typography',
    );
    expect(normal.classes.split(' ')).toContain('leading-normal');
  });

  it('carries the first family as a class and the rest of the stack as CSS', () => {
    expect(classes).toContain('font-[Inter_Display]');
    expect(output.unsupportedCss).toContain(
      'font-family: "Inter Display", Inter, system-ui, sans-serif;',
    );
  });

  it('keeps the weight, tracking, and a lossy color in raw form', () => {
    expect(classes).toContain('font-[600]');
    expect(classes).toContain('tracking-[-1.44px]');
    expect(classes).toContain('text-[oklch(0.18_0.01_250)]');
  });

  it('omits tracking at zero', () => {
    const flat = toTailwind(
      {
        ...headingSnapshot,
        typography: { ...headingSnapshot.typography!, letterSpacingPx: 0 },
      },
      'typography',
    );
    expect(flat.classes).not.toContain('tracking-');
  });
});

describe('toTailwind surfaces', () => {
  const output = toTailwind(cardSnapshot, 'surfaces');
  const classes = output.classes.split(' ');

  it('keeps a translucent color raw rather than dropping its alpha', () => {
    expect(classes).toContain('bg-[rgba(255,_255,_255,_0.72)]');
    expect(classes).toContain('border-[rgba(0,_0,_0,_0.08)]');
    expect(classes).toContain('border-[1px]');
  });

  it('emits per-corner radii when the corners differ', () => {
    expect(classes).toContain('rounded-tl-[16px]');
    expect(classes).toContain('rounded-br-[4px]');
    expect(classes).not.toContain('rounded-[16px]');
  });

  it('replaces spaces in a shadow but keeps its commas', () => {
    expect(output.classes).toContain(
      'shadow-[rgba(0,_0,_0,_0.06)_0px_1px_2px_0px,_rgba(0,_0,_0,_0.08)_0px_12px_32px_-8px]',
    );
  });

  it('never leaves unsupported CSS empty when a filter is set', () => {
    expect(output.unsupportedCss).not.toBe('');
    expect(output.unsupportedCss).toContain('filter: saturate(1.1);');
    expect(output.unsupportedCss).toContain('backdrop-filter: blur(12px);');
  });

  it('moves gradients into unsupported CSS instead of dropping them', () => {
    expect(output.unsupportedCss).toContain(
      'background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.8) 0%, rgb(244, 244, 245) 100%);',
    );
  });

  it('reports mixed border sides as CSS', () => {
    const mixed = toTailwind(gridSnapshot, 'surfaces');
    expect(mixed.unsupportedCss).toContain('border-top: 1px solid rgb(228, 228, 231);');
    expect(mixed.classes).not.toContain('border-[');
  });
});

describe('toTailwind layout', () => {
  const output = toTailwind(gridSnapshot, 'layout');
  const classes = output.classes.split(' ');

  it('collapses padding and writes negative margins in arbitrary form', () => {
    expect(classes).toContain('py-[96px]');
    expect(classes).toContain('px-[24px]');
    expect(classes).toContain('my-[-8px]');
  });

  it('maps a grid container and reports its placement as CSS', () => {
    expect(classes).toContain('grid');
    expect(classes).toContain('grid-cols-[368px_368px_368px]');
    expect(classes).toContain('gap-x-[48px]');
    expect(classes).toContain('gap-y-[32px]');
    expect(output.unsupportedCss).toContain('grid-column: span 2 / auto;');
  });

  it('maps flex alignment tokens and position utilities', () => {
    const flex = toTailwind(cardSnapshot, 'layout').classes.split(' ');
    expect(flex).toContain('flex');
    expect(flex).toContain('flex-col');
    expect(flex).toContain('justify-between');
    expect(flex).toContain('items-start');
    expect(flex).toContain('relative');
    expect(flex).toContain('top-[0px]');
    expect(flex).toContain('z-[2]');
  });

  it('keeps box-sizing and a non-flex display as CSS', () => {
    const block = toTailwind(headingSnapshot, 'layout');
    expect(block.unsupportedCss).toContain('display: block;');
    expect(block.unsupportedCss).toContain('box-sizing: border-box;');
  });

  it('omits zero padding and zero minimums', () => {
    const block = toTailwind(headingSnapshot, 'layout').classes.split(' ');
    expect(block.some((token) => token.startsWith('p-') || token.startsWith('px-'))).toBe(false);
    expect(block.some((token) => token.startsWith('min-w-'))).toBe(false);
    expect(block).toContain('mb-[24px]');
  });
});

describe('toTailwind all', () => {
  it('never repeats a class', () => {
    const classes = toTailwind(cardSnapshot, 'all').classes.split(' ');
    expect(new Set(classes).size).toBe(classes.length);
  });

  it('never repeats an unsupported declaration', () => {
    const lines = toTailwind(cardSnapshot, 'all').unsupportedCss.split('\n');
    expect(new Set(lines).size).toBe(lines.length);
  });
});
