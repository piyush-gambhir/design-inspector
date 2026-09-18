// Layout outlines, Pesticide style: one injected stylesheet that draws a thin
// line around every element so the page's layout skeleton reads at a glance.
//
// Why `outline` and never `border`: an outline is painted outside the box and
// takes part in no layout calculation, so turning outlines on cannot move a
// single pixel of the page. `outline-offset: -1px` pulls each line just inside
// its own box, so neighbouring lines sit side by side instead of doubling up.
//
// Why `!important` on every declaration: `outline: none` in a focus reset is
// close to universal, and a page rule with any class in it would otherwise
// outrank a bare tag selector like `div`.
//
// Shadow-root contents are not outlined. A stylesheet in the document does not
// cross a shadow boundary, and we never inject into a page's shadow roots.

import type { OutlineMode } from '../messages';
import { HOST_TAG } from './overlay';

/** Marks our stylesheet and records the coloring it was generated for. */
export const OUTLINE_STYLE_ATTRIBUTE = 'data-design-inspector-outlines';

const OUTLINE_STYLE_SELECTOR = `style[${OUTLINE_STYLE_ATTRIBUTE}]`;

/** Our own overlay must never be outlined by the sheet it installed. */
export const HOST_EXCLUSION_RULE = `${HOST_TAG}, ${HOST_TAG} * { outline: none !important; }`;

interface TagGroup {
  /** Used only by tests and the comment trail; never shown to the user. */
  name: string;
  color: string;
  tags: readonly string[];
}

/**
 * Eight hues, spread around the wheel at a middling lightness and moderate
 * chroma so every one of them stays legible on a white page and on a black
 * one. Quiet on purpose: 1px lines, no fills, no per-element labels.
 */
export const TAG_GROUPS: readonly TagGroup[] = [
  {
    name: 'sectioning',
    color: 'oklch(0.62 0.16 255)',
    tags: ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer'],
  },
  { name: 'containers', color: 'oklch(0.64 0.13 175)', tags: ['div'] },
  {
    name: 'text blocks',
    color: 'oklch(0.63 0.17 330)',
    tags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'],
  },
  {
    name: 'inline text',
    color: 'oklch(0.64 0.15 140)',
    tags: ['span', 'a', 'strong', 'em', 'small', 'code'],
  },
  {
    name: 'lists',
    color: 'oklch(0.66 0.14 90)',
    tags: ['ul', 'ol', 'li', 'dl', 'dt', 'dd'],
  },
  {
    name: 'media',
    color: 'oklch(0.65 0.17 40)',
    tags: ['img', 'picture', 'svg', 'video', 'canvas', 'iframe'],
  },
  {
    name: 'forms',
    color: 'oklch(0.61 0.17 295)',
    tags: ['form', 'input', 'button', 'select', 'textarea', 'label'],
  },
  {
    name: 'tables',
    color: 'oklch(0.62 0.16 15)',
    tags: ['table', 'thead', 'tbody', 'tr', 'td', 'th'],
  },
];

/** Depth levels that get their own hue. Level 0 is `body > *`. */
export const DEPTH_LEVELS = 8;

/**
 * Eight hues evenly spread around the wheel (every 45 degrees), listed so that
 * consecutive levels jump across it rather than walking it: 180, 90, 180, 45,
 * 180, 90, 180. Going round in order put blue beside pink beside purple, which
 * is the case the depth coloring exists to tell apart.
 */
export const DEPTH_HUES = [255, 75, 165, 345, 30, 210, 120, 300];

/** Lightness and chroma stay fixed, so only the hue distinguishes a level. */
const DEPTH_LIGHTNESS = 0.62;
const DEPTH_CHROMA = 0.17;

export function depthColor(level: number): string {
  const hue = DEPTH_HUES[level] ?? DEPTH_HUES[0];
  return `oklch(${DEPTH_LIGHTNESS} ${DEPTH_CHROMA} ${hue})`;
}

/**
 * Coloring by nesting level cannot be a fixed list of tag selectors, and we
 * refuse to write a `data-*` attribute onto page elements to carry the depth
 * (mutating the page under inspection is out of bounds). Structural selectors
 * do the same job read-only.
 *
 * The last level keeps its hue for everything deeper instead of cycling: a
 * static sheet cannot repeat a ramp forever, and one shared hue for the deep
 * tail is quieter than a ninth colour.
 */
export function depthSelector(level: number): string {
  const chain = `body${' > *'.repeat(level + 1)}`;
  return level === DEPTH_LEVELS - 1 ? `${chain}, ${chain} *` : chain;
}

function outlineRule(selector: string, color: string): string {
  return `${selector} { outline: 1px solid ${color} !important; outline-offset: -1px !important; }`;
}

function tagRules(): string[] {
  return TAG_GROUPS.map(group => outlineRule(group.tags.join(', '), group.color));
}

function depthRules(): string[] {
  return Array.from({ length: DEPTH_LEVELS }, (_unused, level) =>
    outlineRule(depthSelector(level), depthColor(level)),
  );
}

/** The full sheet for a coloring: one rule per group or level, host last. */
export function outlineCss(mode: 'tag' | 'depth'): string {
  const rules = mode === 'tag' ? tagRules() : depthRules();
  // The exclusion goes last so it wins the tie against equally specific rules.
  return [...rules, HOST_EXCLUSION_RULE].join('\n');
}

/**
 * Insert or replace the single outline stylesheet. `off` removes it. Safe to
 * call repeatedly with the same mode: the element is reused, never duplicated.
 */
export function applyOutlines(mode: OutlineMode): OutlineMode {
  const existing = document.querySelector<HTMLStyleElement>(OUTLINE_STYLE_SELECTOR);
  if (mode === 'off') {
    existing?.remove();
    return 'off';
  }

  const parent = document.head ?? document.documentElement;
  if (!parent) return 'off';

  const style = existing ?? document.createElement('style');
  style.setAttribute(OUTLINE_STYLE_ATTRIBUTE, mode);
  const css = outlineCss(mode);
  if (style.textContent !== css) style.textContent = css;
  // Last child of head, so a page sheet loaded earlier cannot outrank ours on
  // document order. Re-appending an element already in place is a no-op.
  if (parent.lastElementChild !== style) parent.appendChild(style);
  return mode;
}

/** The coloring currently installed, read back from the document. */
export function currentOutlineMode(): OutlineMode {
  const style = document.querySelector(OUTLINE_STYLE_SELECTOR);
  const value = style?.getAttribute(OUTLINE_STYLE_ATTRIBUTE);
  return value === 'tag' || value === 'depth' ? value : 'off';
}
