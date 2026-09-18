// Nearest semantic element on click (tester UX note).
//
// Real pages wrap heading and label text in inline elements: `h1 > span` on
// Wikipedia, `h1 > em` on Stripe, `h1 > span > span` on Linear. Clicking the
// words then selects the wrapper, whose readings are correct and useless: the
// family, size and colour are inherited, and the thing the user pointed at was
// the heading.
//
// The first version of this rule compared the two boxes and promoted only when
// they matched within 2px. That never fired on a real heading: a wrapper is an
// inline box around the glyphs, and a block heading's box is as wide as its
// container, so the right edges disagree by however much the last line falls
// short (tester finding F3).
//
// The rule is about layout roles instead, and it is still deliberately narrow,
// because promoting the wrong click is worse than not promoting it:
//
//   1. the clicked element is an inline text wrapper: one of a short list of
//      tags (an `<a>` only counts when it has no href: a link is a real
//      target), or anything whose computed display is `inline`,
//   2. walking up through inline boxes reaches an ancestor that is not inline,
//      and that ancestor's tag is one whose identity a designer would ask
//      about, and
//   3. that ancestor holds no other block-level child, so promoting the click
//      cannot skip over a sibling the user could have pointed at instead.
//
// The wrapper is never lost: ArrowDown reaches it, and the panel's breadcrumb
// shows it as a child of the promoted element.
//
// Pure except for the injected `display`, so the rule is unit testable.

/** Inline wrappers that carry no meaning of their own. */
export const INLINE_WRAPPERS: readonly string[] = [
  'span',
  'em',
  'strong',
  'b',
  'i',
  'a',
  'mark',
  'small',
  'code',
  'sub',
  'sup',
];

/** Parents worth being promoted to. */
export const SEMANTIC_PARENTS: readonly string[] = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'button',
  'a',
  'label',
  'blockquote',
  'figcaption',
  'dt',
  'dd',
  'summary',
  'legend',
  'th',
  'td',
];

/** A chain of wrappers longer than this is a page we do not understand. */
export const MAX_WRAPPER_DEPTH = 8;

/** Reads one element's computed `display`. Injected so the rule is testable. */
export type DisplayOf = (element: Element) => string;

function defaultDisplay(element: Element): string {
  try {
    return getComputedStyle(element).display;
  } catch {
    return '';
  }
}

/**
 * True when the box is an inline box, which is what a text wrapper paints. A
 * missing or unreadable display is not treated as inline: an unknown box is
 * left alone rather than walked through.
 */
export function isInlineDisplay(display: string): boolean {
  return display === 'inline';
}

/**
 * True when a display makes the element a block-level sibling, which is the
 * kind of thing a promotion must not skip over. `inline-*` boxes, `contents`
 * and `none` are not: they either sit in the text flow or paint nothing.
 */
export function isBlockLevelDisplay(display: string): boolean {
  if (display === '' || display === 'none' || display === 'contents') return false;
  if (display === 'inline' || display.startsWith('inline-')) return false;
  return true;
}

/** True when the element is an inline wrapper with nothing of its own to say. */
export function isInlineWrapper(element: Element, display: DisplayOf = defaultDisplay): boolean {
  const tag = element.tagName.toLowerCase();
  // A link is a destination, which is exactly the kind of thing a designer is
  // asking about, so it is never treated as a transparent wrapper.
  if (tag === 'a' && element.hasAttribute('href')) return false;
  if (INLINE_WRAPPERS.includes(tag)) return true;
  // An element worth being promoted to is never a transparent wrapper, however
  // it is laid out: a `<label>` is inline, and its identity is the answer.
  if (SEMANTIC_PARENTS.includes(tag)) return false;
  try {
    return isInlineDisplay(display(element));
  } catch {
    return false;
  }
}

/**
 * True when `candidate` holds a block-level child other than the one the walk
 * came up through. A heading whose only child is its text wrapper promotes; a
 * list item holding a block of its own does not, because the click could have
 * been about that block.
 */
export function hasOtherBlockChildren(
  candidate: Element,
  onPath: Element,
  display: DisplayOf = defaultDisplay,
): boolean {
  for (const child of Array.from(candidate.children)) {
    if (child === onPath) continue;
    if (isBlockLevelDisplay(display(child))) return true;
  }
  return false;
}

/**
 * The semantic parent to select instead of `element`, or null when the click
 * should stand as it is.
 */
export function semanticParentOf(
  element: Element,
  display: DisplayOf = defaultDisplay,
): Element | null {
  try {
    if (!isInlineWrapper(element, display)) return null;

    let current: Element = element;
    for (let depth = 0; depth < MAX_WRAPPER_DEPTH; depth += 1) {
      const parent = current.parentElement;
      if (!parent) return null;
      // Still inside the text flow: keep climbing, however deep the nesting.
      if (isInlineDisplay(display(parent))) {
        current = parent;
        continue;
      }
      // The first box that is not inline is the one the words are painted in.
      if (!SEMANTIC_PARENTS.includes(parent.tagName.toLowerCase())) return null;
      if (hasOtherBlockChildren(parent, current, display)) return null;
      return parent;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Heading inside a full-tile link (tester UX note 6)
//
// The second shape the same complaint takes. A card on a marketing page is one
// `<a>` wrapped around the whole tile, so clicking its heading selects a link
// the size of the screen and the readings are the tile's, not the heading's.
// The promotion above cannot help: the click landed on the link itself, which
// is a destination and never a transparent wrapper.
//
// The rule is narrow on purpose, because selecting a descendant of what was
// clicked is a bigger liberty than selecting an ancestor:
//
//   1. the clicked element is an `a[href]` or a `button`,
//   2. its box covers more than 40 percent of the viewport, which is what makes
//      it a tile rather than a link, and
//   3. the click point lies inside exactly one descendant heading's box, so
//      there is no question which heading was meant.
//
// The link is not lost: it is the heading's ancestor, so the breadcrumb keeps
// it one click away as the parent.

/** A link whose box covers more of the viewport than this reads as a tile. */
export const TILE_AREA_RATIO = 0.4;

const HEADINGS = 'h1, h2, h3, h4, h5, h6';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reads one element's box. Injected so the rule is testable without layout. */
export type BoxOf = (element: Element) => Box;

function defaultBox(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function defaultViewport(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function containsPoint(box: Box, point: { x: number; y: number }): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** Where the click landed and what it landed in, for the tile rule. */
export interface ClickContext {
  /** The click point in viewport coordinates. Without one the rule is off. */
  point?: { x: number; y: number } | null;
  viewport?: { width: number; height: number };
  boxOf?: BoxOf;
}

/**
 * The descendant heading a click on a full-tile link was really about, or null
 * when the click should stand as it is.
 */
export function headingInsideTile(element: Element, context: ClickContext = {}): Element | null {
  const point = context.point;
  if (!point) return null;

  try {
    const tag = element.tagName.toLowerCase();
    const isTile = tag === 'button' || (tag === 'a' && element.hasAttribute('href'));
    if (!isTile) return null;

    const viewport = context.viewport ?? defaultViewport();
    const viewportArea = viewport.width * viewport.height;
    if (viewportArea <= 0) return null;

    const boxOf = context.boxOf ?? defaultBox;
    const box = boxOf(element);
    if (box.width * box.height <= viewportArea * TILE_AREA_RATIO) return null;

    let match: Element | null = null;
    for (const heading of Array.from(element.querySelectorAll(HEADINGS))) {
      const rect = boxOf(heading);
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (!containsPoint(rect, point)) continue;
      // Two headings under one point is an ambiguity, and guessing which one
      // was meant is worse than leaving the click where the user put it.
      if (match) return null;
      match = heading;
    }
    return match;
  } catch {
    return null;
  }
}

/**
 * What to actually select for a click, given the preference. Returns the target
 * and the element the click really landed on when the two differ.
 */
export function resolveSelection(
  element: Element,
  preferSemanticParents: boolean,
  display: DisplayOf = defaultDisplay,
  context: ClickContext = {},
): { target: Element; wrapper: Element | null } {
  if (!preferSemanticParents) return { target: element, wrapper: null };
  // The tile rule looks down rather than up, and the link it steps past stays
  // in the breadcrumb as the heading's parent, so there is no wrapper chip.
  const heading = headingInsideTile(element, context);
  if (heading) return { target: heading, wrapper: null };
  const parent = semanticParentOf(element, display);
  if (!parent) return { target: element, wrapper: null };
  return { target: parent, wrapper: element };
}
