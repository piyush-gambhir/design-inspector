































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


export const MAX_WRAPPER_DEPTH = 8;


export type DisplayOf = (element: Element) => string;

function defaultDisplay(element: Element): string {
  try {
    return getComputedStyle(element).display;
  } catch {
    return '';
  }
}






export function isInlineDisplay(display: string): boolean {
  return display === 'inline';
}






export function isBlockLevelDisplay(display: string): boolean {
  if (display === '' || display === 'none' || display === 'contents') return false;
  if (display === 'inline' || display.startsWith('inline-')) return false;
  return true;
}


export function isInlineWrapper(element: Element, display: DisplayOf = defaultDisplay): boolean {
  const tag = element.tagName.toLowerCase();


  if (tag === 'a' && element.hasAttribute('href')) return false;
  if (INLINE_WRAPPERS.includes(tag)) return true;


  if (SEMANTIC_PARENTS.includes(tag)) return false;
  try {
    return isInlineDisplay(display(element));
  } catch {
    return false;
  }
}







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

      if (isInlineDisplay(display(parent))) {
        current = parent;
        continue;
      }

      if (!SEMANTIC_PARENTS.includes(parent.tagName.toLowerCase())) return null;
      if (hasOtherBlockChildren(parent, current, display)) return null;
      return parent;
    }
    return null;
  } catch {
    return null;
  }
}























export const TILE_AREA_RATIO = 0.4;

const HEADINGS = 'h1, h2, h3, h4, h5, h6';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}


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


export interface ClickContext {

  point?: { x: number; y: number } | null;
  viewport?: { width: number; height: number };
  boxOf?: BoxOf;
}





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


      if (match) return null;
      match = heading;
    }
    return match;
  } catch {
    return null;
  }
}





export function resolveSelection(
  element: Element,
  preferSemanticParents: boolean,
  display: DisplayOf = defaultDisplay,
  context: ClickContext = {},
): { target: Element; wrapper: Element | null } {
  if (!preferSemanticParents) return { target: element, wrapper: null };


  const heading = headingInsideTile(element, context);
  if (heading) return { target: heading, wrapper: null };
  const parent = semanticParentOf(element, display);
  if (!parent) return { target: element, wrapper: null };
  return { target: parent, wrapper: element };
}
