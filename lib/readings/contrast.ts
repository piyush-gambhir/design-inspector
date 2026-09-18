// Contrast reading (PRD SUR-03). The math is pure; the background resolution
// walks ancestors and takes its style reader as a parameter so it can be
// tested without a real layout engine.
//
// V1 only answers for text over a determinable solid background, including
// composition of translucent ancestors. Anything that makes the effective
// background undecidable (image, gradient, blend, filter, opacity, mask)
// returns `unavailable` with the specific reason, never an invented ratio.

import type { ColorValue, ContrastReading } from '../contracts';
import { parseRgba, rgbToHex, type Rgb, type Rgba } from './color';

export const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** WCAG 2.x relative luminance from 0..255 sRGB channels. */
export function relativeLuminance(color: Rgb): number {
  const channel = (value: number): number => {
    const c = Math.min(1, Math.max(0, value / 255));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 2.x contrast ratio. Order of arguments does not matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Source-over composition of a translucent color onto an opaque one. */
export function compositeOver(source: Rgba, backdrop: Rgb): Rgb {
  const alpha = Math.min(1, Math.max(0, source.a));
  return {
    r: source.r * alpha + backdrop.r * (1 - alpha),
    g: source.g * alpha + backdrop.g * (1 - alpha),
    b: source.b * alpha + backdrop.b * (1 - alpha),
  };
}

export type StyleReader = (element: Element) => CSSStyleDeclaration;

export interface BackgroundResolution {
  /** Composited opaque background, or null when undecidable. */
  color: Rgb | null;
  /** The ancestor that supplied the opaque base, or null for the canvas. */
  baseElement: Element | null;
  /** Set when the background could not be decided. */
  blocker: string | null;
  notes: string[];
}

function declared(value: string | null | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase();
  return text !== '' && text !== 'none' && text !== 'normal';
}

function describe(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute('id');
  return id ? `${tag}#${id}` : tag;
}

/**
 * Walks from `element` outward compositing background colors until an opaque
 * one is reached, or the document canvas (treated as white, and noted).
 */
export function resolveBackground(element: Element, getStyle: StyleReader): BackgroundResolution {
  const notes: string[] = [];
  const layers: Rgba[] = [];
  let base: Rgb | null = null;
  let baseElement: Element | null = null;
  let current: Element | null = element;

  while (current) {
    let style: CSSStyleDeclaration;
    try {
      style = getStyle(current);
    } catch {
      return {
        color: null,
        baseElement: null,
        blocker: `Styles of ${describe(current)} could not be read.`,
        notes,
      };
    }

    const where = describe(current);

    if (declared(style.backgroundImage)) {
      return {
        color: null,
        baseElement: null,
        blocker: `${where} paints a gradient or image background.`,
        notes,
      };
    }
    if (declared(style.maskImage) || declared(style.getPropertyValue('-webkit-mask-image'))) {
      return { color: null, baseElement: null, blocker: `${where} is masked.`, notes };
    }
    const blend = (style.mixBlendMode ?? '').trim().toLowerCase();
    if (blend && blend !== 'normal') {
      return {
        color: null,
        baseElement: null,
        blocker: `${where} uses mix-blend-mode: ${blend}.`,
        notes,
      };
    }
    if (declared(style.filter)) {
      return { color: null, baseElement: null, blocker: `${where} applies a filter.`, notes };
    }
    if (declared(style.backdropFilter) || declared(style.getPropertyValue('-webkit-backdrop-filter'))) {
      return {
        color: null,
        baseElement: null,
        blocker: `${where} applies a backdrop-filter.`,
        notes,
      };
    }

    const opacity = Number.parseFloat(style.opacity ?? '1');
    if (Number.isFinite(opacity) && opacity < 1) {
      return {
        color: null,
        baseElement: null,
        blocker: `${where} is partly transparent (opacity ${opacity}).`,
        notes,
      };
    }

    const background = parseRgba(style.backgroundColor ?? '');
    if (background && background.a > 0) {
      if (background.a >= 1) {
        base = { r: background.r, g: background.g, b: background.b };
        baseElement = current;
        break;
      }
      layers.push(background);
    }

    const parent: Element | null = current.parentElement;
    if (!parent) break;
    current = parent;
  }

  if (!base) {
    base = WHITE;
    notes.push('No opaque background was found, so the page canvas was treated as white.');
  }

  // layers[0] is the innermost. Composite outermost first so the nearest
  // background ends up on top.
  let composited: Rgb = base;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    composited = compositeOver(layers[i] as Rgba, composited);
  }

  return { color: composited, baseElement, blocker: null, notes };
}

const PAINTED_TAGS = new Set(['img', 'video', 'canvas', 'svg', 'picture', 'iframe', 'object', 'embed']);
const PAINTED_SELECTOR = Array.from(PAINTED_TAGS).join(',');

function coveringMedia(wrapper: Element, x: number, y: number): Element | null {
  let candidates: Element[];
  try {
    candidates = Array.from(wrapper.querySelectorAll(PAINTED_SELECTOR)).slice(0, 20);
  } catch {
    return null;
  }
  for (const media of candidates) {
    const rect = media.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return media;
    }
  }
  return null;
}
const HOST_TAG = 'design-inspector-host';

/**
 * Ancestors are not the whole story: a hero video or an absolutely positioned
 * image can sit behind text without being one of its ancestors (superpower.com
 * paints white text over a video that is a sibling). Samples the stack of
 * elements under the text's center and reports the first non-ancestor that
 * paints something before the opaque base is reached.
 */
export function paintedBehind(
  element: Element,
  baseElement: Element | null,
  getStyle: StyleReader,
  doc: Document = element.ownerDocument,
): string | null {
  if (typeof doc.elementsFromPoint !== 'function') return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const view = doc.defaultView;
  const maxX = view?.innerWidth ?? Number.POSITIVE_INFINITY;
  const maxY = view?.innerHeight ?? Number.POSITIVE_INFINITY;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > maxX || y > maxY) return null;

  let stack: Element[];
  try {
    stack = doc.elementsFromPoint(x, y);
  } catch {
    return null;
  }
  for (const candidate of stack) {
    if (candidate === baseElement) return null;
    if (candidate === element || element.contains(candidate) || candidate.contains(element)) continue;
    const tag = candidate.tagName.toLowerCase();
    if (tag === HOST_TAG || candidate.closest(HOST_TAG)) continue;
    if (PAINTED_TAGS.has(tag)) return `${describe(candidate)} is painted behind this text and is not one of its ancestors.`;
    // Media with pointer-events: none never shows up in the hit-test stack, but
    // its wrapper does. Look inside the wrapper for media covering the point.
    const media = coveringMedia(candidate, x, y);
    if (media) return `${describe(media)} is painted behind this text and is not one of its ancestors.`;
    let style: CSSStyleDeclaration;
    try {
      style = getStyle(candidate);
    } catch {
      continue;
    }
    if (declared(style.backgroundImage)) {
      return `${describe(candidate)} paints an image behind this text and is not one of its ancestors.`;
    }
    const background = parseRgba(style.backgroundColor ?? '');
    if (background && background.a > 0) {
      return `${describe(candidate)} paints a background behind this text and is not one of its ancestors.`;
    }
  }
  return null;
}

export interface PickedContrast {
  /** WCAG 2.x ratio between the text color and the picked pixel. */
  ratio: number;
  /** The two colors used, after alpha composition. */
  foreground: string;
  background: string;
}

/**
 * Contrast against a pixel the user picked with the eyedropper (PRD SUR-03's
 * future case, competitive Tier 2 item 3).
 *
 * The picked pixel is what the screen already shows, so it is the backdrop:
 * the text color is composited over it with its own alpha before the ratio is
 * taken, exactly as `computeContrast` does for a derived background. A picked
 * value carrying alpha cannot happen with the native picker, which always
 * reports an opaque `sRGBHex`; if one arrives anyway it is composited over
 * white rather than treated as opaque.
 *
 * Returns null when either color cannot be parsed. This is panel state and not
 * a reading: the caller labels it as user supplied and leaves the snapshot's
 * own `contrast` field untouched.
 */
export function contrastAgainstPicked(
  text: ColorValue,
  picked: ColorValue,
): PickedContrast | null {
  const textRgba = parseRgba(text.raw);
  const pickedRgba = parseRgba(picked.raw);
  if (!textRgba || !pickedRgba) return null;

  const background: Rgb =
    pickedRgba.a < 1
      ? compositeOver(pickedRgba, WHITE)
      : { r: pickedRgba.r, g: pickedRgba.g, b: pickedRgba.b };
  const foreground = textRgba.a < 1 ? compositeOver(textRgba, background) : textRgba;

  return {
    ratio: Math.round(contrastRatio(foreground, background) * 100) / 100,
    foreground: rgbToHex(foreground),
    background: rgbToHex(background),
  };
}

const UNAVAILABLE = 'Contrast unavailable for this background.';

/**
 * Builds the contrast reading for text on `element`. `foreground` is the
 * element's own computed text color.
 */
export function computeContrast(
  element: Element,
  foreground: ColorValue,
  getStyle: StyleReader = (target) => getComputedStyle(target),
): ContrastReading {
  const text = parseRgba(foreground.raw);
  if (!text) {
    return {
      ratio: null,
      status: 'unavailable',
      foreground: null,
      background: null,
      reason: `${UNAVAILABLE} The text color could not be read.`,
    };
  }

  const resolved = resolveBackground(element, getStyle);
  if (!resolved.color) {
    return {
      ratio: null,
      status: 'unavailable',
      foreground: foreground.hex,
      background: null,
      reason: `${UNAVAILABLE} ${resolved.blocker ?? ''}`.trim(),
    };
  }

  const behind = paintedBehind(element, resolved.baseElement, getStyle);
  if (behind) {
    return {
      ratio: null,
      status: 'unavailable',
      foreground: foreground.hex,
      background: null,
      reason: `${UNAVAILABLE} ${behind}`,
    };
  }

  const background = resolved.color;
  const textOnBackground = text.a < 1 ? compositeOver(text, background) : text;
  const ratio = Math.round(contrastRatio(textOnBackground, background) * 100) / 100;

  const reading: ContrastReading = {
    ratio,
    status: 'derived',
    foreground: rgbToHex(textOnBackground),
    background: rgbToHex(background),
  };
  if (resolved.notes.length > 0) reading.reason = resolved.notes.join(' ');
  return reading;
}
