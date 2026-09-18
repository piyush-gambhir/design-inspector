import { describe, expect, it } from 'vitest';

import type { ElementSnapshot } from '@/lib/contracts';
import { toTailwind } from '@/lib/exports/tailwind';
import {
  nearestPaletteColor,
  parseShadowLayer,
  toTailwindClosest,
  withinTolerance,
} from '@/lib/exports/tailwind-closest';
import {
  BORDER_RADII,
  FONT_SIZES,
  LETTER_SPACINGS,
  LINE_HEIGHT_LENGTHS,
  OPACITIES,
  SPACING,
} from '@/lib/exports/tailwind-theme';
import { cardSnapshot, color, corners, gridSnapshot, headingSnapshot, sides } from './fixtures/snapshots';

/** The classes of one output, as a set, so order never matters in assertions. */
function classesOf(output: { classes: string }): string[] {
  return output.classes.split(' ').filter((entry) => entry !== '');
}

function deviationFor(
  output: ReturnType<typeof toTailwindClosest>,
  property: string,
): { property: string; observed: string; suggested: string; delta: string } | undefined {
  return output.deviations.find((entry) => entry.property === property);
}

function withTypography(overrides: Partial<NonNullable<ElementSnapshot['typography']>>): ElementSnapshot {
  const typography = headingSnapshot.typography as NonNullable<ElementSnapshot['typography']>;
  return { ...headingSnapshot, typography: { ...typography, ...overrides } };
}

function withSurfaces(overrides: Partial<ElementSnapshot['surfaces']>): ElementSnapshot {
  return { ...cardSnapshot, surfaces: { ...cardSnapshot.surfaces, ...overrides } };
}

const BLUE_500 = color('rgb(59, 130, 246)', {
  hex: '#3b82f6',
  rgb: 'rgb(59, 130, 246)',
  oklch: 'oklch(0.623 0.214 259.815 / 1)',
});

describe('theme data', () => {
  it('covers text-xs through text-9xl with their coupled line heights', () => {
    expect(FONT_SIZES[0]).toEqual({ suffix: 'xs', value: 12, lineHeightPx: 16 });
    expect(FONT_SIZES.at(-1)).toEqual({ suffix: '9xl', value: 128, lineHeightPx: 128 });
    expect(FONT_SIZES.every((step) => step.lineHeightPx >= step.value)).toBe(true);
  });

  it('spans the spacing scale from 0 to 96 in 0.25rem steps, plus px', () => {
    expect(SPACING[0]).toEqual({ suffix: '0', value: 0 });
    expect(SPACING).toContainEqual({ suffix: 'px', value: 1 });
    expect(SPACING).toContainEqual({ suffix: '0.5', value: 2 });
    expect(SPACING).toContainEqual({ suffix: '4', value: 16 });
    expect(SPACING.at(-1)).toEqual({ suffix: '96', value: 384 });
  });

  it('keeps the other scales at their v4 values', () => {
    expect(BORDER_RADII).toContainEqual({ suffix: 'lg', value: 8 });
    expect(BORDER_RADII).toContainEqual({ suffix: '2xl', value: 16 });
    expect(LINE_HEIGHT_LENGTHS[0]).toEqual({ suffix: '3', value: 12 });
    expect(LINE_HEIGHT_LENGTHS.at(-1)).toEqual({ suffix: '10', value: 40 });
    expect(LETTER_SPACINGS).toContainEqual({ suffix: 'tight', value: -0.025 });
    expect(OPACITIES).toContainEqual({ suffix: '95', value: 0.95 });
  });
});

describe('withinTolerance', () => {
  it('accepts a px value inside 12.5 percent', () => {
    expect(withinTolerance(100, 112, 'px')).toBe(true);
    expect(withinTolerance(100, 113, 'px')).toBe(false);
    expect(withinTolerance(100, 87.5, 'px')).toBe(true);
    expect(withinTolerance(100, 87, 'px')).toBe(false);
  });

  it('uses a flat 1px for px values under 8px', () => {
    expect(withinTolerance(3, 4, 'px')).toBe(true);
    expect(withinTolerance(3, 4.01, 'px')).toBe(false);
    // The flat rule never applies to a unitless scale such as opacity.
    expect(withinTolerance(0.96, 0.95, '')).toBe(true);
    expect(withinTolerance(2, 0, '')).toBe(false);
  });

  it('only accepts zero for an observed zero', () => {
    expect(withinTolerance(0, 0, 'px')).toBe(true);
    expect(withinTolerance(0, 1, 'px')).toBe(false);
  });
});

describe('toTailwindClosest: type scales', () => {
  it('names an exact font size without reporting a deviation', () => {
    const output = toTailwindClosest(headingSnapshot, 'typography');
    expect(classesOf(output)).toContain('text-7xl');
    expect(deviationFor(output, 'font-size')).toBeUndefined();
  });

  it('keeps an arbitrary size when no step is close enough', () => {
    const output = toTailwindClosest(withTypography({ sizePx: 42 }), 'typography');
    expect(classesOf(output)).toContain('text-[42px]');
    expect(deviationFor(output, 'font-size')?.delta).toBe(
      'nearest standard text-4xl is -6px, outside the threshold',
    );
  });

  it('accepts the nearest size at the edge of the threshold', () => {
    // 36px is text-4xl; 40px is 11.1 percent away, 41px is 12.2 percent away
    // from the step, which the rule measures against the observed value.
    const output = toTailwindClosest(withTypography({ sizePx: 40 }), 'typography');
    expect(classesOf(output)).toContain('text-4xl');
    expect(deviationFor(output, 'font-size')?.delta).toBe('-4px');
  });

  it('always emits a leading class next to the size class', () => {
    for (const snapshot of [headingSnapshot, withTypography({ lineHeightRaw: 'normal', lineHeightPx: null })]) {
      const classes = classesOf(toTailwindClosest(snapshot, 'typography'));
      expect(classes.some((entry) => entry.startsWith('text-'))).toBe(true);
      expect(classes.some((entry) => entry.startsWith('leading-'))).toBe(true);
    }
  });

  it('matches a numeric line height against the leading steps', () => {
    const output = toTailwindClosest(
      withTypography({ sizePx: 16, sizeRem: 1, lineHeightPx: 24, lineHeightRaw: '24px' }),
      'typography',
    );
    // 24px is both leading-6 and leading-normal; the named class reads better.
    expect(classesOf(output)).toContain('leading-normal');
    expect(deviationFor(output, 'line-height')).toBeUndefined();
  });

  it('names the nearest weight', () => {
    expect(classesOf(toTailwindClosest(headingSnapshot, 'typography'))).toContain('font-semibold');
    const variable = toTailwindClosest(withTypography({ weight: 450 }), 'typography');
    expect(classesOf(variable)).toContain('font-normal');
    expect(deviationFor(variable, 'font-weight')?.delta).toBe('-50');
  });

  it('keeps letter spacing arbitrary when no tracking step is near', () => {
    const output = toTailwindClosest(withTypography({ letterSpacingPx: 12 }), 'typography');
    expect(classesOf(output)).toContain('tracking-[12px]');
    expect(deviationFor(output, 'letter-spacing')?.delta).toContain('outside the threshold');
  });

  it('never invents a family utility for a page font', () => {
    const output = toTailwindClosest(headingSnapshot, 'typography');
    expect(classesOf(output)).toContain('font-[Inter_Display]');
    expect(deviationFor(output, 'font-family')?.delta).toContain('no utility for this family');
  });
});

describe('toTailwindClosest: spacing, radius, border and layout', () => {
  it('maps padding and gap onto the spacing scale', () => {
    const classes = classesOf(toTailwindClosest(cardSnapshot, 'layout'));
    expect(classes).toContain('p-6');
    expect(classes).toContain('gap-x-4');
    expect(classes).toContain('top-0');
  });

  it('keeps the sign on a negative margin', () => {
    expect(classesOf(toTailwindClosest(gridSnapshot, 'layout'))).toContain('-my-2');
  });

  it('maps radii per corner and recognises a pill', () => {
    const classes = classesOf(toTailwindClosest(cardSnapshot, 'surfaces'));
    expect(classes).toContain('rounded-tl-2xl');
    expect(classes).toContain('rounded-br-sm');

    const pill = withSurfaces({ radius: corners('9999px') });
    expect(classesOf(toTailwindClosest(pill, 'surfaces'))).toContain('rounded-full');
  });

  it('writes a 1px border as the bare border class', () => {
    expect(classesOf(toTailwindClosest(cardSnapshot, 'surfaces'))).toContain('border');
  });

  it('accepts a 3px border as border-2 under the small-value rule', () => {
    const snapshot = withSurfaces({
      borderWidth: sides(3),
      borderColor: sides(color('rgb(0, 0, 0)', { hex: '#000000' })),
    });
    const output = toTailwindClosest(snapshot, 'surfaces');
    expect(classesOf(output)).toContain('border-2');
    expect(deviationFor(output, 'border-width')?.delta).toBe('-1px');
  });

  it('maps opacity onto the 5 percent steps and leaves z-index alone', () => {
    const output = toTailwindClosest(cardSnapshot, 'all');
    expect(classesOf(output)).toContain('opacity-95');
    expect(deviationFor(output, 'opacity')?.delta).toBe('-0.01');
    expect(classesOf(output)).toContain('z-[2]');
    expect(deviationFor(output, 'z-index')?.delta).toContain('outside the threshold');
  });
});

describe('toTailwindClosest: colors', () => {
  it('names a palette color exactly and says nothing about it', () => {
    const output = toTailwindClosest(withTypography({ color: BLUE_500 }), 'typography');
    expect(classesOf(output)).toContain('text-blue-500');
    expect(deviationFor(output, 'color')).toBeUndefined();
  });

  it('names a near palette color and reports the oklch distance', () => {
    const near = color('rgb(60, 130, 246)', {
      hex: '#3c82f6',
      oklch: 'oklch(0.625 0.212 259.5 / 1)',
    });
    const output = toTailwindClosest(withTypography({ color: near }), 'typography');
    expect(classesOf(output)).toContain('text-blue-500');
    expect(deviationFor(output, 'color')?.delta).toMatch(/^oklch distance 0\.0/);
  });

  it('falls back to the arbitrary value when nothing is close', () => {
    const output = toTailwindClosest(headingSnapshot, 'typography');
    expect(classesOf(output)).toContain('text-[oklch(0.18_0.01_250)]');
    expect(deviationFor(output, 'color')?.delta).toContain('nearest palette color');
  });

  it('refuses to guess an opacity modifier for a translucent color', () => {
    const output = toTailwindClosest(cardSnapshot, 'surfaces');
    expect(classesOf(output)).toContain('bg-[rgba(255,_255,_255,_0.72)]');
    expect(deviationFor(output, 'background-color')?.delta).toContain('translucent');
  });

  it('finds the nearest palette entry for a known color', () => {
    expect(nearestPaletteColor(BLUE_500)?.color.name).toBe('blue-500');
    expect(nearestPaletteColor(BLUE_500)?.distance).toBe(0);
    expect(nearestPaletteColor(color('rgb(0, 0, 0)', { hex: '#000000', oklch: 'oklch(0 0 0 / 1)' }))
      ?.color.name).toBe('black');
  });
});

describe('toTailwindClosest: shadows', () => {
  it('parses a computed shadow layer', () => {
    expect(parseShadowLayer('rgba(0, 0, 0, 0.1) 0px 4px 6px -1px')).toEqual({
      offsetX: 0,
      offsetY: 4,
      blur: 6,
      spread: -1,
      alpha: 0.1,
      inset: false,
    });
  });

  it('names a stock shadow when both layers line up', () => {
    const snapshot = withSurfaces({
      boxShadow: ['rgba(0, 0, 0, 0.1) 0px 4px 6px -1px', 'rgba(0, 0, 0, 0.1) 0px 2px 4px -2px'],
    });
    const output = toTailwindClosest(snapshot, 'surfaces');
    expect(classesOf(output)).toContain('shadow-md');
    expect(deviationFor(output, 'box-shadow')).toBeUndefined();
  });

  it('keeps a page shadow verbatim when no stock shadow matches', () => {
    const output = toTailwindClosest(cardSnapshot, 'surfaces');
    expect(classesOf(output).some((entry) => entry.startsWith('shadow-['))).toBe(true);
    expect(deviationFor(output, 'box-shadow')?.delta).toContain('no default shadow matches');
  });
});

describe('toTailwindClosest: contract with the faithful mode', () => {
  it('drops nothing: every faithful class has a counterpart', () => {
    for (const snapshot of [headingSnapshot, cardSnapshot, gridSnapshot]) {
      const faithful = classesOf(toTailwind(snapshot, 'all'));
      const closest = classesOf(toTailwindClosest(snapshot, 'all'));
      expect(closest.length, snapshot.id).toBe(faithful.length);
      const prefix = (entry: string): string => entry.replace(/-\[.*\]$/, '').replace(/^-/, '');
      for (const entry of faithful) {
        expect(
          closest.some((candidate) => prefix(candidate).startsWith(prefix(entry).split('-')[0] as string)),
          `${snapshot.id}: ${entry}`,
        ).toBe(true);
      }
    }
  });

  it('passes the unsupported CSS through untouched', () => {
    for (const snapshot of [headingSnapshot, cardSnapshot, gridSnapshot]) {
      expect(toTailwindClosest(snapshot, 'all').unsupportedCss).toBe(
        toTailwind(snapshot, 'all').unsupportedCss,
      );
    }
  });

  it('never invents a responsive or state prefix', () => {
    for (const snapshot of [headingSnapshot, cardSnapshot, gridSnapshot]) {
      for (const entry of classesOf(toTailwindClosest(snapshot, 'all'))) {
        expect(entry.includes(':'), entry).toBe(false);
      }
    }
  });

  it('states the theme and the threshold it used', () => {
    const { assumption } = toTailwindClosest(headingSnapshot, 'all');
    expect(assumption).toContain('Tailwind v4 default theme');
    expect(assumption).toContain('12.5 percent');
    expect(assumption).toContain('oklch distance of 0.02');
    expect(assumption).toContain('No responsive prefixes');
  });

  it('respects the category the caller asked for', () => {
    const typography = classesOf(toTailwindClosest(cardSnapshot, 'typography'));
    expect(typography).toEqual([]);
    const layout = classesOf(toTailwindClosest(cardSnapshot, 'layout'));
    expect(layout.some((entry) => entry.startsWith('rounded'))).toBe(false);
  });
});

describe('toTailwindClosest: no em dashes', () => {
  it('writes none anywhere in its output', () => {
    for (const snapshot of [headingSnapshot, cardSnapshot, gridSnapshot]) {
      const output = toTailwindClosest(snapshot, 'all');
      const text = [output.classes, output.assumption, JSON.stringify(output.deviations)].join(' ');
      expect(text.includes(String.fromCodePoint(0x2014))).toBe(false);
    }
  });
});
