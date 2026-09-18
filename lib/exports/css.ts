// Computed CSS export (PRD EXP-01). The output is honest about what it is:
// computed values at one viewport, not authored CSS, with no responsive rules
// and no interaction states.
import type { ColorValue, ElementSnapshot, Sides } from '@/lib/contracts';
import { collapseWhitespace, fontStack, isZeroLength, num, px, quoteFamily } from './format';

export type StyleCategory = 'typography' | 'surfaces' | 'layout' | 'all';

interface Declaration {
  property: string;
  value: string;
  comment?: string;
}

export function toCss(snapshot: ElementSnapshot, category: StyleCategory): string {
  const { declarations, orphanExpressions } = attachSourceExpressions(
    declarationsFor(snapshot, category),
    snapshot,
    category,
  );

  const lines: string[] = [headerComment(snapshot), `.${cssSelector(snapshot.element.label)} {`];
  for (const declaration of declarations) {
    const comment = declaration.comment ? ` /* ${declaration.comment} */` : '';
    lines.push(`  ${declaration.property}: ${declaration.value};${comment}`);
  }
  for (const authored of orphanExpressions) {
    lines.push(`  /* authored: ${authored} */`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function headerComment(snapshot: ElementSnapshot): string {
  const { viewport, rootFontSize } = snapshot.source;
  return `/* Design Inspector: computed styles for ${snapshot.element.label} at ${num(viewport.width)}x${num(viewport.height)}, root ${num(rootFontSize)}px. Not authored CSS; responsive rules and interaction states not included. */`;
}

/**
 * The label with every character outside `[a-z0-9_-]` replaced by a dash.
 * Runs of dashes collapse and the ends are trimmed so the result is a usable
 * class selector rather than something like `.h1--build-faster-`.
 */
function cssSelector(label: string): string {
  const sanitized = label
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized === '' ? 'element' : sanitized;
}

function declarationsFor(
  snapshot: ElementSnapshot,
  category: StyleCategory,
): Declaration[] {
  switch (category) {
    case 'typography':
      return typographyDeclarations(snapshot);
    case 'surfaces':
      return surfaceDeclarations(snapshot);
    case 'layout':
      return layoutDeclarations(snapshot);
    case 'all':
      return dedupe([
        ...typographyDeclarations(snapshot),
        ...surfaceDeclarations(snapshot),
        ...layoutDeclarations(snapshot),
      ]);
  }
}

// ---------------------------------------------------------------------------

function typographyDeclarations(snapshot: ElementSnapshot): Declaration[] {
  const typography = snapshot.typography;
  if (!typography) return [];

  const declarations: Declaration[] = [];
  const stack =
    typography.familyStack.length > 0
      ? fontStack(typography.familyStack)
      : quoteFamily(typography.familyReading);

  declarations.push({ property: 'font-family', value: stack });
  declarations.push({ property: 'font-size', value: px(typography.sizePx) });
  declarations.push({ property: 'font-weight', value: String(typography.weight) });
  if (typography.style !== 'normal') {
    declarations.push({ property: 'font-style', value: typography.style });
  }
  declarations.push({ property: 'line-height', value: lineHeightValue(typography.lineHeightRaw, typography.lineHeightPx) });
  if (typography.letterSpacingPx !== 0) {
    declarations.push({ property: 'letter-spacing', value: px(typography.letterSpacingPx) });
  }
  declarations.push({ property: 'text-transform', value: typography.textTransform });
  declarations.push({ property: 'text-decoration', value: typography.textDecoration });
  if (typography.fontVariant !== 'normal' && typography.fontVariant !== 'none') {
    declarations.push({ property: 'font-variant', value: typography.fontVariant });
  }
  declarations.push({ property: 'color', ...colorForCss(typography.color) });
  if (typography.variationSettings !== null) {
    declarations.push({
      property: 'font-variation-settings',
      value: typography.variationSettings,
    });
  }

  return declarations;
}

function lineHeightValue(raw: string, resolved: number | null): string {
  if (raw === 'normal') return 'normal';
  return resolved !== null ? px(resolved) : raw;
}

function surfaceDeclarations(snapshot: ElementSnapshot): Declaration[] {
  const surfaces = snapshot.surfaces;
  const declarations: Declaration[] = [];

  const hasLayers = surfaces.backgroundLayers.length > 0;
  if (!(surfaces.backgroundColor.alpha === 0 && !hasLayers)) {
    declarations.push({ property: 'background-color', ...colorForCss(surfaces.backgroundColor) });
  }
  if (hasLayers) {
    declarations.push({
      property: 'background-image',
      value: surfaces.backgroundLayers.map((layer) => collapseWhitespace(layer)).join(', '),
    });
  }

  declarations.push(...borderDeclarations(snapshot));

  const radius = radiusValue(snapshot);
  if (radius !== null) declarations.push({ property: 'border-radius', value: radius });

  const boxShadow = surfaces.boxShadow.map((entry) => collapseWhitespace(entry)).filter(usable);
  if (boxShadow.length > 0) {
    declarations.push({ property: 'box-shadow', value: boxShadow.join(', ') });
  }
  const textShadow = surfaces.textShadow.map((entry) => collapseWhitespace(entry)).filter(usable);
  if (textShadow.length > 0) {
    declarations.push({ property: 'text-shadow', value: textShadow.join(', ') });
  }

  if (surfaces.opacity !== 1) {
    declarations.push({ property: 'opacity', value: num(surfaces.opacity) });
  }
  if (usable(surfaces.filter)) {
    declarations.push({ property: 'filter', value: collapseWhitespace(surfaces.filter) });
  }
  if (usable(surfaces.backdropFilter)) {
    declarations.push({
      property: 'backdrop-filter',
      value: collapseWhitespace(surfaces.backdropFilter),
    });
  }
  if (surfaces.fill) declarations.push({ property: 'fill', ...colorForCss(surfaces.fill) });
  if (surfaces.stroke) declarations.push({ property: 'stroke', ...colorForCss(surfaces.stroke) });

  return declarations;
}

/** Visible sides only: a width above zero and a style that paints. */
function borderDeclarations(snapshot: ElementSnapshot): Declaration[] {
  const { borderWidth, borderStyle, borderColor } = snapshot.surfaces;
  const sides: (keyof Sides<number>)[] = ['top', 'right', 'bottom', 'left'];
  const visible = sides.filter(
    (side) => borderWidth[side] > 0 && usable(borderStyle[side]) && borderStyle[side] !== 'hidden',
  );
  if (visible.length === 0) return [];

  const serialized = sides.map(
    (side) =>
      `${px(borderWidth[side])} ${borderStyle[side]} ${colorForCss(borderColor[side]).value}`,
  );
  const first = serialized[0] ?? '';
  if (visible.length === 4 && serialized.every((entry) => entry === first)) {
    const lossy = sides.some((side) => borderColor[side].lossy);
    return [{ property: 'border', value: first, ...(lossy ? { comment: 'sRGB approximation' } : {}) }];
  }

  const declarations: Declaration[] = [];
  for (const side of visible) {
    declarations.push({ property: `border-${side}-width`, value: px(borderWidth[side]) });
    declarations.push({ property: `border-${side}-style`, value: borderStyle[side] });
    declarations.push({ property: `border-${side}-color`, ...colorForCss(borderColor[side]) });
  }
  return declarations;
}

function radiusValue(snapshot: ElementSnapshot): string | null {
  const radius = snapshot.surfaces.radius;
  const corners = [radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft].map(
    (corner) => collapseWhitespace(corner),
  );
  if (corners.every((corner) => isZeroLength(corner))) return null;
  const first = corners[0] ?? '';
  return corners.every((corner) => corner === first) ? first : corners.join(' ');
}

function layoutDeclarations(snapshot: ElementSnapshot): Declaration[] {
  const layout = snapshot.layout;
  const declarations: Declaration[] = [
    { property: 'display', value: layout.display },
    { property: 'box-sizing', value: layout.boxSizing },
    { property: 'width', value: px(layout.layoutSize.width) },
    { property: 'height', value: px(layout.layoutSize.height) },
    { property: 'padding', value: sidesShorthand(layout.padding) },
    { property: 'margin', value: sidesShorthand(layout.margin) },
  ];

  if (isRealConstraint(layout.minWidth, true)) {
    declarations.push({ property: 'min-width', value: layout.minWidth });
  }
  if (isRealConstraint(layout.maxWidth, false)) {
    declarations.push({ property: 'max-width', value: layout.maxWidth });
  }
  if (isRealConstraint(layout.minHeight, true)) {
    declarations.push({ property: 'min-height', value: layout.minHeight });
  }
  if (isRealConstraint(layout.maxHeight, false)) {
    declarations.push({ property: 'max-height', value: layout.maxHeight });
  }

  const flex = layout.flex;
  if (flex && layout.display.includes('flex')) {
    declarations.push({ property: 'flex-direction', value: flex.direction });
    declarations.push({ property: 'flex-wrap', value: flex.wrap });
    declarations.push({ property: 'justify-content', value: flex.justifyContent });
    declarations.push({ property: 'align-items', value: flex.alignItems });
    declarations.push({ property: 'align-content', value: flex.alignContent });
  }

  const grid = layout.grid;
  if (grid && layout.display.includes('grid')) {
    declarations.push({ property: 'grid-template-columns', value: grid.templateColumns });
    declarations.push({ property: 'grid-template-rows', value: grid.templateRows });
    declarations.push({ property: 'grid-auto-flow', value: grid.autoFlow });
    if (grid.itemPlacement) {
      declarations.push({ property: 'grid-column', value: grid.itemPlacement.column });
      declarations.push({ property: 'grid-row', value: grid.itemPlacement.row });
    }
  }

  if (layout.position !== 'static') {
    declarations.push({ property: 'position', value: layout.position });
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const inset = layout.inset[side];
    if (inset !== 'auto' && usable(inset)) {
      declarations.push({ property: side, value: inset });
    }
  }
  if (layout.zIndex !== 'auto' && usable(layout.zIndex)) {
    declarations.push({ property: 'z-index', value: layout.zIndex });
  }

  const gaps = gapOf(snapshot);
  if (gaps) {
    if (gaps.row !== 0) declarations.push({ property: 'row-gap', value: px(gaps.row) });
    if (gaps.column !== 0) declarations.push({ property: 'column-gap', value: px(gaps.column) });
  }

  return declarations;
}

export function gapOf(snapshot: ElementSnapshot): { row: number; column: number } | null {
  const { flex, grid, display } = snapshot.layout;
  if (grid && display.includes('grid')) return { row: grid.rowGap, column: grid.columnGap };
  if (flex && display.includes('flex')) return { row: flex.rowGap, column: flex.columnGap };
  return null;
}

/** Mins drop `none` and zero, maxes drop `none`. */
function isRealConstraint(value: string, isMin: boolean): boolean {
  if (!usable(value)) return false;
  if (isMin && isZeroLength(value)) return false;
  return true;
}

export function sidesShorthand(sides: Sides<number>): string {
  const top = num(sides.top);
  const right = num(sides.right);
  const bottom = num(sides.bottom);
  const left = num(sides.left);
  const unit = (value: string): string => (value === '0' ? '0' : `${value}px`);

  if (top === right && right === bottom && bottom === left) return unit(top);
  if (top === bottom && right === left) return `${unit(top)} ${unit(right)}`;
  if (right === left) return `${unit(top)} ${unit(right)} ${unit(bottom)}`;
  return `${unit(top)} ${unit(right)} ${unit(bottom)} ${unit(left)}`;
}

/**
 * Colors are emitted raw so the copied value matches what the page declares.
 * A raw form that cannot be pasted into a stylesheet falls back to hex, and a
 * conversion that lost information is labelled rather than silently trusted.
 */
function colorForCss(color: ColorValue): { value: string; comment?: string } {
  if (color.lossy) return { value: color.raw, comment: 'sRGB approximation' };
  if (!isCopyFriendly(color.raw) && color.hex) return { value: color.hex };
  return { value: color.raw };
}

function isCopyFriendly(raw: string): boolean {
  return !/^(?:color|color-mix|lab|lch|device-cmyk)\(/i.test(raw.trim());
}

function usable(value: string): boolean {
  const trimmed = collapseWhitespace(value);
  return trimmed !== '' && trimmed.toLowerCase() !== 'none';
}

function dedupe(declarations: Declaration[]): Declaration[] {
  const seen = new Set<string>();
  const result: Declaration[] = [];
  for (const declaration of declarations) {
    if (seen.has(declaration.property)) continue;
    seen.add(declaration.property);
    result.push(declaration);
  }
  return result;
}

/**
 * Authored expressions are shown as trailing comments on the property they
 * belong to. An expression for a property this category does not emit is kept
 * as a standalone comment so nothing is lost.
 */
function attachSourceExpressions(
  declarations: Declaration[],
  snapshot: ElementSnapshot,
  category: StyleCategory,
): { declarations: Declaration[]; orphanExpressions: string[] } {
  const expressions = snapshot.layout.sourceExpressions;
  const keys = Object.keys(expressions).sort();
  if (keys.length === 0) return { declarations, orphanExpressions: [] };

  const result = declarations.map((declaration) => ({ ...declaration }));
  const orphanExpressions: string[] = [];

  for (const key of keys) {
    const authored = expressions[key];
    if (authored === undefined) continue;
    const target = result.find((declaration) => declaration.property === key);
    if (target) {
      const note = `authored: ${key}: ${authored}`;
      target.comment = target.comment ? `${target.comment}; ${note}` : note;
    } else if (category === 'layout' || category === 'all') {
      orphanExpressions.push(`${key}: ${authored}`);
    }
  }

  return { declarations: result, orphanExpressions };
}
