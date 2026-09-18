// Tailwind export, faithful mode only (PRD EXP-02 mode 1).
//
// This never claims to recover the site's original classes or theme. Every
// class carries the observed value as an arbitrary value, and anything Tailwind
// cannot express is handed back as plain CSS instead of being dropped.
import type { ColorValue, ElementSnapshot, Sides } from '@/lib/contracts';
import type { StyleCategory } from './css';
import { gapOf } from './css';
import { collapseWhitespace, fontStack, isZeroLength, num } from './format';

export interface TailwindOutput {
  /** Space-separated classes using arbitrary values (faithful mode). */
  classes: string;
  /** Properties that could not be expressed as classes, as CSS declarations. */
  unsupportedCss: string;
  /** e.g. 'Tailwind v4 arbitrary values; not the site's original classes.' */
  assumption: string;
}

export function toTailwind(snapshot: ElementSnapshot, category: StyleCategory): TailwindOutput {
  const classes: string[] = [];
  const unsupported: string[] = [];

  if (category === 'typography' || category === 'all') {
    typographyClasses(snapshot, classes, unsupported);
  }
  if (category === 'surfaces' || category === 'all') {
    surfaceClasses(snapshot, classes, unsupported);
  }
  if (category === 'layout' || category === 'all') {
    layoutClasses(snapshot, classes, unsupported);
  }

  const { viewport } = snapshot.source;
  return {
    classes: dedupe(classes).join(' '),
    unsupportedCss: dedupe(unsupported).join('\n'),
    assumption: `Tailwind v4 arbitrary-value classes generated from computed styles at ${num(viewport.width)}x${num(viewport.height)}. Not the site's original classes or theme.`,
  };
}

// ---------------------------------------------------------------------------

function typographyClasses(
  snapshot: ElementSnapshot,
  classes: string[],
  unsupported: string[],
): void {
  const typography = snapshot.typography;
  if (!typography) return;

  const first = typography.familyStack[0] ?? typography.familyReading;
  classes.push(`font-[${arb(first)}]`);
  if (typography.familyStack.length > 1) {
    // A class cannot carry a fallback stack cleanly, so the full stack stays
    // as CSS next to the class.
    unsupported.push(`font-family: ${fontStack(typography.familyStack)};`);
  }

  classes.push(`text-[${num(typography.sizePx)}px]`);
  // Tailwind couples a default line-height to every text size, so the observed
  // line height is always emitted next to it.
  classes.push(
    typography.lineHeightRaw === 'normal' || typography.lineHeightPx === null
      ? 'leading-normal'
      : `leading-[${num(typography.lineHeightPx)}px]`,
  );
  if (typography.letterSpacingPx !== 0) {
    classes.push(`tracking-[${num(typography.letterSpacingPx)}px]`);
  }
  classes.push(`font-[${typography.weight}]`);
  if (typography.style !== 'normal') {
    if (typography.style === 'italic') classes.push('italic');
    else unsupported.push(`font-style: ${typography.style};`);
  }

  const transform = typography.textTransform;
  if (transform === 'uppercase' || transform === 'lowercase' || transform === 'capitalize') {
    classes.push(transform);
  } else if (usable(transform)) {
    unsupported.push(`text-transform: ${transform};`);
  }

  const decoration = typography.textDecoration;
  if (usable(decoration)) {
    let mapped = false;
    if (decoration.includes('underline')) {
      classes.push('underline');
      mapped = true;
    }
    if (decoration.includes('line-through')) {
      classes.push('line-through');
      mapped = true;
    }
    if (!mapped) unsupported.push(`text-decoration: ${decoration};`);
  }

  classes.push(`text-[${colorArb(typography.color)}]`);

  if (typography.fontVariant !== 'normal' && typography.fontVariant !== 'none') {
    unsupported.push(`font-variant: ${typography.fontVariant};`);
  }
  if (typography.variationSettings !== null) {
    unsupported.push(`font-variation-settings: ${typography.variationSettings};`);
  }
}

function surfaceClasses(
  snapshot: ElementSnapshot,
  classes: string[],
  unsupported: string[],
): void {
  const surfaces = snapshot.surfaces;

  if (!(surfaces.backgroundColor.alpha === 0 && surfaces.backgroundLayers.length === 0)) {
    classes.push(`bg-[${colorArb(surfaces.backgroundColor)}]`);
  }
  if (surfaces.backgroundLayers.length > 0) {
    // Gradients and multi-layer backgrounds are not expressible faithfully as
    // arbitrary classes, so they stay as CSS.
    unsupported.push(
      `background-image: ${surfaces.backgroundLayers.map((layer) => collapseWhitespace(layer)).join(', ')};`,
    );
  }

  const radius = surfaces.radius;
  const corners = [radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft].map(
    (corner) => collapseWhitespace(corner),
  );
  if (!corners.every((corner) => isZeroLength(corner))) {
    const first = corners[0] ?? '';
    if (corners.every((corner) => corner === first)) {
      classes.push(`rounded-[${arb(first)}]`);
    } else {
      classes.push(`rounded-tl-[${arb(corners[0] ?? '0')}]`);
      classes.push(`rounded-tr-[${arb(corners[1] ?? '0')}]`);
      classes.push(`rounded-br-[${arb(corners[2] ?? '0')}]`);
      classes.push(`rounded-bl-[${arb(corners[3] ?? '0')}]`);
    }
  }

  const shadows = surfaces.boxShadow.map((entry) => collapseWhitespace(entry)).filter(usable);
  if (shadows.length > 0) {
    classes.push(`shadow-[${shadows.join(', ').replace(/ /g, '_')}]`);
  }
  const textShadows = surfaces.textShadow.map((entry) => collapseWhitespace(entry)).filter(usable);
  if (textShadows.length > 0) {
    unsupported.push(`text-shadow: ${textShadows.join(', ')};`);
  }

  if (surfaces.opacity !== 1) classes.push(`opacity-[${num(surfaces.opacity)}]`);

  addBorderClasses(snapshot, classes, unsupported);

  if (usable(surfaces.filter)) unsupported.push(`filter: ${collapseWhitespace(surfaces.filter)};`);
  if (usable(surfaces.backdropFilter)) {
    unsupported.push(`backdrop-filter: ${collapseWhitespace(surfaces.backdropFilter)};`);
  }
  if (surfaces.fill) unsupported.push(`fill: ${surfaces.fill.raw};`);
  if (surfaces.stroke) unsupported.push(`stroke: ${surfaces.stroke.raw};`);
}

function addBorderClasses(
  snapshot: ElementSnapshot,
  classes: string[],
  unsupported: string[],
): void {
  const { borderWidth, borderStyle, borderColor } = snapshot.surfaces;
  const sides: (keyof Sides<number>)[] = ['top', 'right', 'bottom', 'left'];
  const visible = sides.filter(
    (side) => borderWidth[side] > 0 && usable(borderStyle[side]) && borderStyle[side] !== 'hidden',
  );
  if (visible.length === 0) return;

  const uniformWidth = sides.every((side) => borderWidth[side] === borderWidth.top);
  const uniformColor = sides.every((side) => borderColor[side].raw === borderColor.top.raw);

  if (visible.length === 4 && uniformWidth && uniformColor) {
    classes.push(`border-[${num(borderWidth.top)}px]`);
    classes.push(`border-[${colorArb(borderColor.top)}]`);
    if (borderStyle.top !== 'solid') unsupported.push(`border-style: ${borderStyle.top};`);
    return;
  }

  // Mixed borders would need one class per side and per property, which stops
  // being readable, so the exact sides are reported as CSS.
  for (const side of visible) {
    unsupported.push(`border-${side}: ${num(borderWidth[side])}px ${borderStyle[side]} ${borderColor[side].raw};`);
  }
}

function layoutClasses(
  snapshot: ElementSnapshot,
  classes: string[],
  unsupported: string[],
): void {
  const layout = snapshot.layout;
  const isFlex = layout.display.includes('flex');
  const isGrid = layout.display.includes('grid');

  if (isFlex) classes.push('flex');
  else if (isGrid) classes.push('grid');
  else unsupported.push(`display: ${layout.display};`);

  unsupported.push(`box-sizing: ${layout.boxSizing};`);

  classes.push(`w-[${num(layout.layoutSize.width)}px]`);
  classes.push(`h-[${num(layout.layoutSize.height)}px]`);
  classes.push(...spacingClasses('p', layout.padding));
  classes.push(...spacingClasses('m', layout.margin));

  if (isRealConstraint(layout.minWidth, true)) classes.push(`min-w-[${arb(layout.minWidth)}]`);
  if (isRealConstraint(layout.maxWidth, false)) classes.push(`max-w-[${arb(layout.maxWidth)}]`);
  if (isRealConstraint(layout.minHeight, true)) classes.push(`min-h-[${arb(layout.minHeight)}]`);
  if (isRealConstraint(layout.maxHeight, false)) classes.push(`max-h-[${arb(layout.maxHeight)}]`);

  const flex = layout.flex;
  if (flex && isFlex) {
    if (flex.direction === 'column') classes.push('flex-col');
    else if (flex.direction === 'row-reverse') classes.push('flex-row-reverse');
    else if (flex.direction === 'column-reverse') classes.push('flex-col-reverse');
    else classes.push('flex-row');
    if (flex.wrap === 'wrap') classes.push('flex-wrap');
    else if (flex.wrap === 'wrap-reverse') classes.push('flex-wrap-reverse');
    classes.push(`justify-${alignmentToken(flex.justifyContent)}`);
    classes.push(`items-${alignmentToken(flex.alignItems)}`);
    if (flex.alignContent !== 'normal') {
      classes.push(`content-${alignmentToken(flex.alignContent)}`);
    }
  }

  const grid = layout.grid;
  if (grid && isGrid) {
    classes.push(`grid-cols-[${arb(grid.templateColumns)}]`);
    classes.push(`grid-rows-[${arb(grid.templateRows)}]`);
    if (grid.autoFlow !== 'row') unsupported.push(`grid-auto-flow: ${grid.autoFlow};`);
    if (grid.itemPlacement) {
      unsupported.push(`grid-column: ${grid.itemPlacement.column};`);
      unsupported.push(`grid-row: ${grid.itemPlacement.row};`);
    }
  }

  const gaps = gapOf(snapshot);
  if (gaps) {
    if (gaps.column !== 0) classes.push(`gap-x-[${num(gaps.column)}px]`);
    if (gaps.row !== 0) classes.push(`gap-y-[${num(gaps.row)}px]`);
  }

  if (POSITIONS.has(layout.position)) {
    classes.push(layout.position);
  } else if (layout.position !== 'static') {
    unsupported.push(`position: ${layout.position};`);
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const inset = layout.inset[side];
    if (inset !== 'auto' && usable(inset)) classes.push(`${side}-[${arb(inset)}]`);
  }
  if (layout.zIndex !== 'auto' && usable(layout.zIndex)) {
    classes.push(`z-[${arb(layout.zIndex)}]`);
  }
}

const POSITIONS = new Set(['absolute', 'relative', 'fixed', 'sticky']);

/** Padding and margin with `px-`/`py-` collapsing. Negatives keep their sign. */
function spacingClasses(prefix: 'p' | 'm', sides: Sides<number>): string[] {
  const { top, right, bottom, left } = sides;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return [];

  const value = (side: number): string => `[${num(side)}px]`;
  if (top === right && right === bottom && bottom === left) return [`${prefix}-${value(top)}`];

  const out: string[] = [];
  if (top === bottom) {
    if (top !== 0) out.push(`${prefix}y-${value(top)}`);
  } else {
    if (top !== 0) out.push(`${prefix}t-${value(top)}`);
    if (bottom !== 0) out.push(`${prefix}b-${value(bottom)}`);
  }
  if (right === left) {
    if (right !== 0) out.push(`${prefix}x-${value(right)}`);
  } else {
    if (right !== 0) out.push(`${prefix}r-${value(right)}`);
    if (left !== 0) out.push(`${prefix}l-${value(left)}`);
  }
  return out;
}

function alignmentToken(value: string): string {
  switch (value) {
    case 'flex-start':
    case 'start':
      return 'start';
    case 'flex-end':
    case 'end':
      return 'end';
    case 'space-between':
      return 'between';
    case 'space-around':
      return 'around';
    case 'space-evenly':
      return 'evenly';
    case 'normal':
      return 'normal';
    default:
      return value;
  }
}

function isRealConstraint(value: string, isMin: boolean): boolean {
  if (!usable(value)) return false;
  if (isMin && isZeroLength(value)) return false;
  return true;
}

/** Arbitrary-value text: whitespace collapsed, then spaces replaced by underscores. */
function arb(value: string): string {
  return collapseWhitespace(value).replace(/ /g, '_');
}

/**
 * Hex is the shortest faithful form, but only when it carries the whole value:
 * a translucent or lossy color keeps its raw serialization instead.
 */
function colorArb(color: ColorValue): string {
  if (color.hex && !color.lossy && color.alpha >= 1) return color.hex;
  return arb(color.raw);
}

function usable(value: string): boolean {
  const trimmed = collapseWhitespace(value);
  return trimmed !== '' && trimmed.toLowerCase() !== 'none';
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
