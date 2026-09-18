// Builds an ElementSnapshot from a live Element (PRD sections 8 to 11).
//
// Two depths exist on purpose. Hover needs geometry and basic typography
// inside a frame budget (PRD 19.1), so it asks for a shallow reading. Pinning
// asks for a deep reading, which adds contrast composition, @font-face
// lookups, authored source expressions, and asset serialization.

import { readVideoAssets } from './assets';
import type {
  AssetCandidate,
  AssetReading,
  ColorValue,
  Corners,
  ElementSnapshot,
  FlexReading,
  GridReading,
  LayoutReading,
  Rect,
  Sides,
  SourceContext,
  SurfaceReading,
  TypographyReading,
} from '../contracts';
import { SCHEMA_VERSION } from '../contracts';
import { parseColor } from '../readings/color';
import { computeContrast } from '../readings/contrast';
import {
  identifyFamily,
  readDocumentFonts,
  renderCheck,
  splitFontFamilyStack,
  type DocumentFontsResult,
} from '../readings/fonts';
import {
  collectAncestors,
  describeElement,
  hasOwnText,
  labelOf,
  type AncestorEntry,
} from '../readings/locator';
import {
  extractUrls,
  isDeclared,
  isViewportDependentLength,
  parsePx,
  pxToRem,
  splitCssList,
  splitTopLevel,
} from '../readings/units';
import { serializeInlineSvg } from './svg-export';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EXPRESSION_PATTERN = /(?:clamp|var|calc|min|max)\(/;
const MAX_RULES_SCANNED = 4000;

export interface SnapshotOptions {
  /** Deep readings add contrast, font faces, source expressions, and assets. */
  deep?: boolean;
  /** Reuse a font-face reading instead of walking stylesheets again. */
  fonts?: DocumentFontsResult;
  source?: SourceContext;
  /**
   * Build the ancestor chain. It costs a `getBoundingClientRect` per ancestor
   * and a descriptor for each, which is the most expensive part of a snapshot
   * on a deeply nested page. Only the pinned panel's breadcrumb reads it, and
   * the hover card does not, so the hover path switches it off (PERF 3).
   * Defaults to true, so every existing caller is unchanged.
   */
  ancestors?: boolean;
}

export function newId(): string {
  const api = globalThis.crypto as { randomUUID?(): string } | undefined;
  if (api?.randomUUID) return api.randomUUID();
  return `di-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function rootFontSizeOf(doc: Document = document): number {
  try {
    const size = parsePx(getComputedStyle(doc.documentElement).fontSize);
    return size > 0 ? size : 16;
  } catch {
    return 16;
  }
}

/** How far a computed root may sit from a whole pixel before it reads as fluid. */
const INTEGER_TOLERANCE_PX = 0.01;

/**
 * Rules walked looking for a root font-size, which is its own budget rather
 * than the per-element one.
 *
 * A real page puts its root rule wherever its build ordered it: on
 * superpower.com the `html { font-size: calc(...) }` that makes the whole page
 * fluid is rule 17,626 of 17,820, so a 4,000 rule budget read the page as
 * having a fixed root and every px reading in the panel silently claimed to be
 * stable. The walk is a selector test per rule and it runs once per document,
 * not once per reading, so it can afford to finish.
 */
const MAX_ROOT_RULES_SCANNED = 60000;

/**
 * The authored values are a property of the document's stylesheets, not of the
 * viewport, so they are read once and kept until the sheet list changes. The
 * source context is rebuilt on every resize, and rewalking a 17,000 rule page
 * on each of those would be a frame budget spent on an answer that cannot have
 * changed.
 */
let authoredRootCache: {
  doc: Document;
  sheets: number;
  values: string[];
  readAt: number;
} | null = null;

/** How long a cached walk is trusted. A page can swap a stylesheet for one with
 *  the same sheet count, so the cache also ages out. */
const AUTHORED_ROOT_TTL_MS = 2000;

export function resetRootFontSizeCache(): void {
  authoredRootCache = null;
}

/** True for a selector that styles the root element itself. */
function selectsRoot(selectorText: string): boolean {
  return splitTopLevel(selectorText, ',').some((part) => {
    const trimmed = part.trim().toLowerCase();
    return (
      trimmed === 'html' ||
      trimmed === ':root' ||
      trimmed === 'html:root' ||
      trimmed === ':root:root'
    );
  });
}

/**
 * Every authored root font-size the document declares, in source order: the
 * inline style first, then each `html` or `:root` rule in the same-origin
 * stylesheets. A cross-origin sheet throws on `cssRules` and is skipped, so an
 * unreadable page returns an empty list rather than a guess (PRD LAY-01's rule
 * applied to the root: authored values are reported, never reconstructed).
 *
 * All of them are collected rather than only the winner, because a real page
 * declares the root several times: superpower.com ships
 * `html { font-size: calc(0.747899rem + 0.210084vw) }` and a plain
 * `html { font-size: 1rem }` in a later sheet, and it is the first that
 * explains why its px readings move.
 */
export function readAuthoredRootFontSizes(doc: Document = document): string[] {
  const out: string[] = [];
  const element = doc.documentElement as HTMLElement | null;
  const inline = element?.style?.fontSize?.trim();
  if (inline) out.push(inline);

  let sheets: StyleSheet[];
  try {
    sheets = Array.from(doc.styleSheets);
  } catch {
    return out;
  }

  const cached = authoredRootCache;
  if (
    cached &&
    cached.doc === doc &&
    cached.sheets === sheets.length &&
    Date.now() - cached.readAt < AUTHORED_ROOT_TTL_MS
  ) {
    return inline ? [inline, ...cached.values.filter((value) => value !== inline)] : cached.values;
  }

  let examined = 0;

  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (examined > MAX_ROOT_RULES_SCANNED) return;
      examined += 1;

      const styleRule = rule as CSSStyleRule;
      if (styleRule.selectorText && styleRule.style && selectsRoot(styleRule.selectorText)) {
        const value = styleRule.style.getPropertyValue('font-size');
        if (value && value.trim()) out.push(value.trim());
      }

      const grouping = (rule as CSSGroupingRule).cssRules;
      if (grouping && grouping.length > 0) visit(grouping);
    }
  };

  for (const sheet of sheets) {
    let rules: CSSRuleList | null = null;
    try {
      rules = (sheet as CSSStyleSheet).cssRules;
    } catch {
      continue;
    }
    if (rules) visit(rules);
  }

  authoredRootCache = { doc, sheets: sheets.length, values: out, readAt: Date.now() };
  return out;
}

/**
 * The authored value worth showing: the declaration that explains the movement
 * when there is one, otherwise the last one the cascade would have seen.
 */
export function chooseAuthoredRootFontSize(values: string[]): string | null {
  const fluid = values.find((value) => isViewportDependentLength(value));
  if (fluid) return fluid;
  return values.length > 0 ? (values[values.length - 1] as string) : null;
}

/** The authored root font-size, or null when no rule could be read. */
export function readAuthoredRootFontSize(doc: Document = document): string | null {
  return chooseAuthoredRootFontSize(readAuthoredRootFontSizes(doc));
}

/**
 * True when the root font size moves with the viewport, so every px reading on
 * the page is a reading at this width and only the rem value is stable.
 *
 * Any viewport-dependent root declaration settles it, even when another rule
 * wins at this particular width: the claim is that px readings change with the
 * window, and a rule that only applies at some widths still makes that true.
 * Failing that, a computed root that is not a whole pixel is the tell: 14.99px
 * is not a value anyone types, so something viewport-dependent produced it,
 * whether or not the stylesheet that says so could be read.
 */
export function isFluidRootFontSize(
  authored: string | string[] | null,
  computed: number,
): boolean {
  const values = authored === null ? [] : Array.isArray(authored) ? authored : [authored];
  const readable = values.filter((value) => value.trim().length > 0);
  if (readable.some((value) => isViewportDependentLength(value))) return true;
  if (!Number.isFinite(computed) || computed <= 0) return false;
  return Math.abs(computed - Math.round(computed)) > INTEGER_TOLERANCE_PX;
}

export function readSourceContext(doc: Document = document): SourceContext {
  const view = doc.defaultView ?? window;
  const rootFontSize = rootFontSizeOf(doc);
  const authoredValues = readAuthoredRootFontSizes(doc);
  const rootFontSizeAuthored = chooseAuthoredRootFontSize(authoredValues);
  return {
    url: doc.location?.href ?? '',
    title: doc.title,
    capturedAt: new Date().toISOString(),
    viewport: {
      width: view.innerWidth,
      height: view.innerHeight,
      devicePixelRatio: view.devicePixelRatio,
    },
    rootFontSize,
    rootFontSizeAuthored,
    rootFontSizeFluid: isFluidRootFontSize(authoredValues, rootFontSize),
    scrollX: view.scrollX,
    scrollY: view.scrollY,
  };
}

export function toRect(rect: DOMRect): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function sides<T>(read: (side: 'Top' | 'Right' | 'Bottom' | 'Left') => T): Sides<T> {
  return { top: read('Top'), right: read('Right'), bottom: read('Bottom'), left: read('Left') };
}

export function pxSides(
  style: CSSStyleDeclaration,
  property: 'padding' | 'margin' | 'border',
): Sides<number> {
  return sides((side) =>
    parsePx(
      style.getPropertyValue(
        property === 'border'
          ? `border-${side.toLowerCase()}-width`
          : `${property}-${side.toLowerCase()}`,
      ),
    ),
  );
}

export function colorSides(style: CSSStyleDeclaration): Sides<ColorValue> {
  return sides((side) => parseColor(style.getPropertyValue(`border-${side.toLowerCase()}-color`)));
}

export function styleSides(style: CSSStyleDeclaration): Sides<string> {
  return sides((side) => style.getPropertyValue(`border-${side.toLowerCase()}-style`) || 'none');
}

export function radiusCorners(style: CSSStyleDeclaration): Corners<string> {
  return {
    topLeft: style.borderTopLeftRadius || '0px',
    topRight: style.borderTopRightRadius || '0px',
    bottomRight: style.borderBottomRightRadius || '0px',
    bottomLeft: style.borderBottomLeftRadius || '0px',
  };
}

export function isSvgElement(element: Element): boolean {
  return element.namespaceURI === SVG_NS;
}

/** Computed weight as a number. Some engines serialize keywords. */
export function computedWeight(style: CSSStyleDeclaration): number {
  const raw = (style.fontWeight ?? '').trim().toLowerCase();
  if (raw === 'normal') return 400;
  if (raw === 'bold') return 700;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 400;
}

/**
 * True when the element renders text of its own. Ancestors of text are
 * excluded so a section is not reported as a text element (PRD SUM-02).
 */
export function rendersOwnText(element: Element): boolean {
  if (hasOwnText(element)) return true;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    const input = element as HTMLInputElement;
    const type = (input.type ?? 'text').toLowerCase();
    if (type === 'hidden') return false;
    return !!(input.value || input.placeholder);
  }
  if (tag === 'textarea') {
    const area = element as HTMLTextAreaElement;
    return !!(area.value || area.placeholder);
  }
  if (tag === 'button' || tag === 'option' || tag === 'select') {
    return (element.textContent ?? '').trim().length > 0;
  }
  return false;
}

/** How many text nodes the element inspector walks before giving up. */
const MAX_TEXT_NODES_WALKED = 200;

const NON_RENDERING_TEXT_PARENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'title',
  'head',
]);

function rendersTextNode(parent: Element): boolean {
  if (NON_RENDERING_TEXT_PARENTS.has(parent.tagName.toLowerCase())) return false;
  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(parent);
  } catch {
    // Unreadable styles are not evidence of invisibility.
    return true;
  }
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  return true;
}

/**
 * The first visible, non-whitespace text node the element renders, its own or
 * a descendant's. Wikipedia's `h1#firstHeading` keeps its text in a span, and
 * the user who selected the h1 still wants a typography reading (PRD INS-04).
 *
 * This is deliberately not the SUM-02 inventory rule: the summary scan still
 * counts only elements with text of their own.
 */
export function firstRenderedTextNode(element: Element): Text | null {
  const doc = element.ownerDocument;
  if (!doc || typeof doc.createTreeWalker !== 'function') return null;

  let walker: TreeWalker;
  try {
    walker = doc.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
  } catch {
    return null;
  }

  let walked = 0;
  let node = walker.nextNode();
  while (node && walked < MAX_TEXT_NODES_WALKED) {
    walked += 1;
    if ((node.nodeValue ?? '').trim().length > 0) {
      const parent = node.parentElement;
      if (parent && rendersTextNode(parent)) return node as Text;
    }
    node = walker.nextNode();
  }
  return null;
}

export function isTransformed(element: Element): boolean {
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 200) {
    let style: CSSStyleDeclaration;
    try {
      style = getComputedStyle(current);
    } catch {
      return false;
    }
    if (
      isDeclared(style.transform) ||
      isDeclared(style.getPropertyValue('rotate')) ||
      isDeclared(style.getPropertyValue('scale')) ||
      isDeclared(style.getPropertyValue('translate'))
    ) {
      return true;
    }
    current = current.parentElement;
    depth += 1;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Typography

export function readTypography(
  element: Element,
  style: CSSStyleDeclaration,
  rootFontSize: number,
  options: { deep: boolean; fonts: DocumentFontsResult | null },
): TypographyReading {
  const stack = splitFontFamilyStack(style.fontFamily);
  const weight = computedWeight(style);
  const fonts = options.fonts;
  const identification = identifyFamily(stack, weight, fonts?.faces ?? [], {
    pageOrigin: element.ownerDocument?.location?.origin,
    providerUrls: fonts?.providerUrls ?? [],
  });

  const sizePx = parsePx(style.fontSize);
  const lineHeightRaw = (style.lineHeight || 'normal').trim();
  const lineHeightPx = lineHeightRaw === 'normal' ? null : parsePx(lineHeightRaw);
  const letterSpacingRaw = (style.letterSpacing || 'normal').trim();
  const letterSpacingPx = letterSpacingRaw === 'normal' ? 0 : parsePx(letterSpacingRaw);
  const color = parseColor(style.color);

  const variation = (style.fontVariationSettings ?? '').trim();
  const fontStyle = (style.fontStyle || 'normal').trim();

  // The rendering check is the only evidence that settles which family painted
  // the characters (PRD TYP-02), and it costs a canvas measurement, so it runs
  // on a pinned reading and never on hover (PRD 19.1). A family that rendered
  // and also has a loaded face (or is a system family) is the one case where
  // `verified` is honest; everything else keeps the confidence it arrived with.
  const doc = element.ownerDocument;
  const check =
    options.deep && doc && identification.familyReading !== 'Unknown'
      ? renderCheck(identification.familyReading, weight, fontStyle, doc)
      : null;
  const confidence =
    check === 'rendered' && identification.familyConfidence === 'matched'
      ? 'verified'
      : identification.familyConfidence;

  return {
    familyStack: stack,
    familyReading: identification.familyReading,
    familyConfidence: confidence,
    source: identification.source,
    renderCheck: check,
    weight,
    style: fontStyle,
    variationSettings: variation && variation !== 'normal' ? variation : null,
    sizePx,
    sizeRem: pxToRem(sizePx, rootFontSize),
    lineHeightRaw,
    lineHeightPx,
    lineHeightRatio: lineHeightPx !== null && sizePx > 0 ? lineHeightPx / sizePx : null,
    letterSpacingRaw,
    letterSpacingPx,
    letterSpacingEm: sizePx > 0 ? letterSpacingPx / sizePx : null,
    textTransform: (style.textTransform || 'none').trim(),
    textDecoration: (style.textDecorationLine || style.textDecoration || 'none').trim(),
    fontVariant: (style.fontVariant || style.fontVariantCaps || 'normal').trim(),
    color,
    contrast: options.deep
      ? computeContrast(element, color)
      : {
          ratio: null,
          status: 'unavailable',
          foreground: color.hex,
          background: null,
          reason: 'Contrast is calculated when you pin the element.',
        },
  };
}

// ---------------------------------------------------------------------------
// Surfaces

function readOpacity(style: CSSStyleDeclaration): number {
  const value = Number.parseFloat(style.opacity ?? '');
  return Number.isFinite(value) ? value : 1;
}

export function readSurfaces(element: Element, style: CSSStyleDeclaration): SurfaceReading {
  const svg = isSvgElement(element);
  const fillRaw = svg ? (style.fill ?? '').trim() : '';
  const strokeRaw = svg ? (style.stroke ?? '').trim() : '';

  return {
    backgroundColor: parseColor(style.backgroundColor),
    backgroundLayers: splitCssList(style.backgroundImage),
    borderColor: colorSides(style),
    borderWidth: pxSides(style, 'border'),
    borderStyle: styleSides(style),
    radius: radiusCorners(style),
    boxShadow: splitCssList(style.boxShadow),
    textShadow: splitCssList(style.textShadow),
    opacity: readOpacity(style),
    filter: (style.filter || 'none').trim(),
    backdropFilter: (
      style.backdropFilter ||
      style.getPropertyValue('-webkit-backdrop-filter') ||
      'none'
    ).trim(),
    fill: fillRaw && fillRaw !== 'none' ? parseColor(fillRaw) : null,
    stroke: strokeRaw && strokeRaw !== 'none' ? parseColor(strokeRaw) : null,
  };
}

// ---------------------------------------------------------------------------
// Layout

function readFlex(style: CSSStyleDeclaration): FlexReading {
  return {
    direction: style.flexDirection || 'row',
    wrap: style.flexWrap || 'nowrap',
    justifyContent: style.justifyContent || 'normal',
    alignItems: style.alignItems || 'normal',
    alignContent: style.alignContent || 'normal',
    rowGap: parsePx(style.rowGap),
    columnGap: parsePx(style.columnGap),
  };
}

function readGrid(style: CSSStyleDeclaration, isItem: boolean, itemStyle: CSSStyleDeclaration): GridReading {
  return {
    templateColumns: style.gridTemplateColumns || 'none',
    templateRows: style.gridTemplateRows || 'none',
    autoFlow: style.gridAutoFlow || 'row',
    rowGap: parsePx(style.rowGap),
    columnGap: parsePx(style.columnGap),
    itemPlacement: isItem
      ? {
          column: itemStyle.gridColumn || itemStyle.gridColumnStart || 'auto',
          row: itemStyle.gridRow || itemStyle.gridRowStart || 'auto',
        }
      : null,
  };
}

/**
 * Authored expressions from same-origin stylesheets. Only reported when the
 * declaration is actually readable, never reconstructed from computed px
 * (PRD LAY-01).
 */
export function findSourceExpressions(element: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const doc = element.ownerDocument;
  if (!doc) return out;

  let sheets: StyleSheet[];
  try {
    sheets = Array.from(doc.styleSheets);
  } catch {
    return out;
  }

  let examined = 0;

  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (examined > MAX_RULES_SCANNED) return;
      examined += 1;

      // CSSStyleRule also exposes cssRules now that CSS nesting exists, so the
      // declarations are read first and nested rules are visited after.
      const styleRule = rule as CSSStyleRule;
      if (styleRule.selectorText && styleRule.style) {
        let matches = false;
        try {
          matches = element.matches(styleRule.selectorText);
        } catch {
          matches = false;
        }
        if (matches) {
          for (let i = 0; i < styleRule.style.length; i += 1) {
            const property = styleRule.style.item(i);
            if (!property) continue;
            const value = styleRule.style.getPropertyValue(property);
            if (value && EXPRESSION_PATTERN.test(value)) out[property] = value.trim();
          }
        }
      }

      const grouping = (rule as CSSGroupingRule).cssRules;
      if (grouping && grouping.length > 0) visit(grouping);
    }
  };

  for (const sheet of sheets) {
    let rules: CSSRuleList | null = null;
    try {
      rules = (sheet as CSSStyleSheet).cssRules;
    } catch {
      continue;
    }
    if (rules) visit(rules);
  }

  return out;
}

export function readLayout(
  element: Element,
  style: CSSStyleDeclaration,
  options: { deep: boolean },
): LayoutReading {
  const rect = element.getBoundingClientRect();
  const html = element as HTMLElement;
  const hasOffsets = typeof html.offsetWidth === 'number' && typeof html.offsetHeight === 'number';
  const display = style.display || 'inline';

  let parentStyle: CSSStyleDeclaration | null = null;
  try {
    parentStyle = element.parentElement ? getComputedStyle(element.parentElement) : null;
  } catch {
    parentStyle = null;
  }
  const parentDisplay = parentStyle?.display ?? '';
  const isGridItem = parentDisplay.includes('grid');
  const isGridContainer = display.includes('grid');

  return {
    display,
    boxSizing: style.boxSizing || 'content-box',
    layoutSize: hasOffsets
      ? { width: html.offsetWidth, height: html.offsetHeight }
      : { width: rect.width, height: rect.height },
    visualRect: toRect(rect),
    transformed: isTransformed(element),
    padding: pxSides(style, 'padding'),
    margin: pxSides(style, 'margin'),
    border: pxSides(style, 'border'),
    minWidth: style.minWidth || 'auto',
    maxWidth: style.maxWidth || 'none',
    minHeight: style.minHeight || 'auto',
    maxHeight: style.maxHeight || 'none',
    flex: display.includes('flex') ? readFlex(style) : null,
    grid: isGridContainer || isGridItem ? readGrid(style, isGridItem, style) : null,
    position: style.position || 'static',
    inset: {
      top: style.top || 'auto',
      right: style.right || 'auto',
      bottom: style.bottom || 'auto',
      left: style.left || 'auto',
    },
    zIndex: style.zIndex || 'auto',
    sourceExpressions: options.deep ? findSourceExpressions(element) : {},
  };
}

// ---------------------------------------------------------------------------
// Assets

export function parseSrcset(srcset: string | null, baseUrl: string): AssetCandidate[] {
  if (!srcset) return [];
  return srcset
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const parts = entry.split(/\s+/);
      const url = parts[0] ?? '';
      const descriptor = parts.length > 1 ? (parts.slice(1).join(' ') || null) : null;
      return { url: resolveUrl(url, baseUrl), descriptor };
    })
    .filter((candidate) => candidate.url.length > 0);
}

export function resolveUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function imageAsset(
  img: HTMLImageElement,
  kind: 'img' | 'picture',
  baseUrl: string,
): AssetReading {
  const limitations: string[] = [];
  const rect = img.getBoundingClientRect();
  const candidates: AssetCandidate[] = [];

  const source = img.closest('picture');
  if (source) {
    source.querySelectorAll('source[srcset]').forEach((node) => {
      candidates.push(...parseSrcset(node.getAttribute('srcset'), baseUrl));
    });
  }
  candidates.push(...parseSrcset(img.getAttribute('srcset'), baseUrl));
  const src = img.getAttribute('src');
  if (src) candidates.push({ url: resolveUrl(src, baseUrl), descriptor: null });

  const current = img.currentSrc || (src ? resolveUrl(src, baseUrl) : '');
  if (!current) limitations.push('Not loaded yet, so no source was selected by the browser.');
  if (img.naturalWidth === 0 && img.naturalHeight === 0) {
    limitations.push('Intrinsic size is unknown until the image loads.');
  }

  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const key = `${candidate.url}|${candidate.descriptor ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    kind,
    url: current || null,
    candidates: unique,
    renderedWidth: rect.width,
    renderedHeight: rect.height,
    intrinsicWidth: img.naturalWidth || null,
    intrinsicHeight: img.naturalHeight || null,
    fileSize: null,
    mimeType: null,
    svgMarkup: null,
    alt: img.getAttribute('alt'),
    limitations,
  };
}

export function readAssets(
  element: Element,
  style: CSSStyleDeclaration,
  options: { deep: boolean },
): AssetReading[] {
  const out: AssetReading[] = [];
  const doc = element.ownerDocument;
  const baseUrl = doc?.baseURI ?? '';
  const tag = element.tagName.toLowerCase();

  if (tag === 'img') {
    const img = element as HTMLImageElement;
    out.push(imageAsset(img, img.closest('picture') ? 'picture' : 'img', baseUrl));
  } else if (tag === 'picture') {
    const img = element.querySelector('img');
    if (img) out.push(imageAsset(img as HTMLImageElement, 'picture', baseUrl));
  } else if (tag === 'video') {
    // Direct files only; streamed sources come back with url null (PRD AST-01).
    out.push(...readVideoAssets(element));
  } else if (tag === 'svg' && isSvgElement(element)) {
    const rect = element.getBoundingClientRect();
    const exported = options.deep
      ? serializeInlineSvg(element as SVGElement)
      : { markup: null as string | null, limitations: [] as string[] };
    const viewBox = element.getAttribute('viewBox');
    const box = viewBox ? viewBox.trim().split(/\s+/).map(Number) : null;
    out.push({
      kind: 'svg-inline',
      url: null,
      candidates: [],
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      intrinsicWidth: box && box.length === 4 && Number.isFinite(box[2]) ? (box[2] as number) : null,
      intrinsicHeight: box && box.length === 4 && Number.isFinite(box[3]) ? (box[3] as number) : null,
      fileSize: null,
      // No fetching happens in the content script, so size and type stay
      // unknown; `kind` already says this is SVG.
      mimeType: null,
      svgMarkup: exported.markup,
      alt: element.getAttribute('aria-label'),
      limitations: exported.limitations,
    });
  }

  const rect = element.getBoundingClientRect();
  for (const layer of splitCssList(style.backgroundImage)) {
    for (const url of extractUrls(layer)) {
      out.push({
        kind: 'css-background',
        url: resolveUrl(url, baseUrl),
        candidates: [],
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        intrinsicWidth: null,
        intrinsicHeight: null,
        fileSize: null,
        mimeType: null,
        svgMarkup: null,
        alt: null,
        limitations: ['Intrinsic size and file size are not read for background images.'],
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Snapshot

/**
 * The ancestors worth showing: wrappers whose box matches their only child are
 * dropped from the breadcrumb, while ArrowUp still walks every DOM level
 * (PRD INS-04).
 */
export function ancestorChain(element: Element): AncestorEntry[] {
  const measure = (target: Element): Rect => toRect(target.getBoundingClientRect());
  return collectAncestors(element, measure).filter((entry) => !entry.redundant);
}

export function buildSnapshot(element: Element, options: SnapshotOptions = {}): ElementSnapshot {
  const deep = options.deep ?? true;
  const limitations: string[] = [];
  const source = options.source ?? readSourceContext(element.ownerDocument ?? document);

  let style: CSSStyleDeclaration;
  try {
    style = getComputedStyle(element);
  } catch {
    style = {} as CSSStyleDeclaration;
    limitations.push('Computed styles could not be read for this element.');
  }

  let fonts: DocumentFontsResult | null = options.fonts ?? null;
  if (deep && !fonts) {
    fonts = readDocumentFonts(element.ownerDocument ?? document);
  }
  if (fonts) limitations.push(...fonts.limitations);

  const ancestors = (options.ancestors ?? true) ? ancestorChain(element) : [];

  const layout = readLayout(element, style, { deep });
  if (layout.transformed) {
    limitations.push(
      'A transform is applied, so the visual bounds are axis aligned bounds, not the layout box.',
    );
  }
  // The element inspector reads what the user selected, so a container whose
  // text sits in a child still gets typography. The computed style read is the
  // element's own, and a differently styled text child is disclosed below.
  const textNode = firstRenderedTextNode(element);
  const typography =
    rendersOwnText(element) || textNode
      ? readTypography(element, style, source.rootFontSize, { deep, fonts })
      : null;

  if (typography && textNode) {
    const textParent = textNode.parentElement;
    if (textParent && textParent !== element) {
      let childStyle: CSSStyleDeclaration | null = null;
      try {
        childStyle = getComputedStyle(textParent);
      } catch {
        childStyle = null;
      }
      if (
        childStyle &&
        (childStyle.fontFamily !== style.fontFamily || childStyle.fontSize !== style.fontSize)
      ) {
        limitations.push(
          `Text inside this element is styled by ${labelOf(textParent)}; readings show the container's inherited values.`,
        );
      }
    }
  }

  const snapshot: ElementSnapshot = {
    id: newId(),
    schemaVersion: SCHEMA_VERSION,
    source,
    element: describeElement(element),
    ancestors: ancestors.map((entry) => entry.descriptor),
    layout,
    typography,
    surfaces: readSurfaces(element, style),
    assets: readAssets(element, style, { deep }),
    limitations,
  };

  return snapshot;
}
