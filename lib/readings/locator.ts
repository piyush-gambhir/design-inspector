// Element identity: readable labels, roles, and best-effort CSS locators
// (PRD INS-04, SUM-06).
//
// The locator is context, not a promise of rediscovery. Generated class names
// are never used as the user-facing label, because they change between builds
// (PRD INS-04).

import type { ElementDescriptor } from '../contracts';

const EXTENSION_HOST_TAG = 'design-inspector-host';

/** Implied roles we are willing to state. Landmarks plus unambiguous widgets. */
const IMPLIED_ROLES: Record<string, string> = {
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  form: 'form',
  search: 'search',
  article: 'article',
  button: 'button',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  img: 'img',
  dialog: 'dialog',
  figure: 'figure',
  select: 'combobox',
  textarea: 'textbox',
};

/** Emotion, styled-components, CSS modules, and friends announce themselves. */
const FRAMEWORK_PREFIX = /^(sc|css|jsx|svelte|emotion|chakra|mui|_)[-_]/i;

/**
 * True when one alphanumeric run reads as a hash rather than a word: letters
 * mixed with digits, a long digit string, or case salad that is neither
 * camelCase nor PascalCase (`cVAQDa`, `MwJdiW`).
 */
function looksHashed(run: string): boolean {
  if (run.length < 5) return false;
  const hasDigit = /[0-9]/.test(run);
  const hasLetter = /[A-Za-z]/.test(run);
  if (hasDigit && !hasLetter) return run.length >= 6;
  if (hasDigit && hasLetter) return true;
  const mixedCase = /[a-z]/.test(run) && /[A-Z]/.test(run);
  if (!mixedCase) return false;
  const camel = /^[a-z][a-z0-9]*([A-Z][a-z0-9]+)*$/.test(run);
  const pascal = /^([A-Z][a-z0-9]+)+$/.test(run);
  return !camel && !pascal;
}

/**
 * True when a class name looks build generated: a CSS-modules or styled hash,
 * or an Emotion/styled-components prefix. Such names are never shown as labels.
 */
export function isGeneratedClass(className: string): boolean {
  const name = className.trim();
  if (!name) return true;
  if (name.startsWith('_')) return true;
  if (FRAMEWORK_PREFIX.test(name)) return true;
  // CSS-modules output: `Block__element___hash` and `Name-module__part`.
  if (/__[A-Za-z0-9]{5,}/.test(name)) return true;
  if (/-module_/.test(name)) return true;

  return name.split(/[^A-Za-z0-9]+/).some(looksHashed);
}

/** True when an id looks build generated and should not anchor a label. */
export function isGeneratedId(id: string): boolean {
  return isGeneratedClass(id);
}

export function classList(element: Element): string[] {
  const attribute = element.getAttribute('class');
  if (!attribute) return [];
  return attribute.split(/\s+/).filter((name) => name.length > 0);
}

/** The element's role: explicit attribute first, then a conservative implied role. */
export function roleOf(element: Element): string | null {
  const explicit = element.getAttribute('role');
  if (explicit) {
    const first = explicit.trim().split(/\s+/)[0];
    if (first) return first;
  }

  const tag = element.tagName.toLowerCase();
  if (tag === 'a') return element.hasAttribute('href') ? 'link' : null;
  if (tag === 'section') {
    return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby')
      ? 'region'
      : null;
  }
  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
    if (type === 'search') return 'searchbox';
    if (type === 'range') return 'slider';
    if (type === 'hidden') return null;
    return 'textbox';
  }
  return IMPLIED_ROLES[tag] ?? null;
}

/** Direct, non-whitespace text of the element, collapsed and capped. */
export function textSample(element: Element, limit = 80): string | null {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** True when the element has a direct, non-whitespace text node child (PRD SUM-02). */
export function hasOwnText(element: Element): boolean {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3 && (node.nodeValue ?? '').trim().length > 0) return true;
  }
  return false;
}

/** A label's text sample stays short so a sentence never becomes the label. */
const LABEL_TEXT_SAMPLE = 12;

/**
 * A short human label, in order of preference: an authored `#id`, a role the
 * tag does not already imply, `aria-label`, an authored class, then the tag
 * plus a short text sample: `h1#firstHeading`, `div[role="tablist"]`,
 * `nav[aria-label="Main"]`, `section.hero`, `button "Get started"`.
 *
 * Generated class names never become the label, because a hashed name is
 * meaningless to the reader and changes between builds (PRD INS-04).
 */
export function labelOf(element: Element): string {
  const tag = element.tagName.toLowerCase();

  const id = element.getAttribute('id');
  if (id && !isGeneratedId(id)) return `${tag}#${id}`;

  // Only an explicit role the tag does not already imply adds information.
  const explicitRole = (element.getAttribute('role') ?? '').trim().split(/\s+/)[0];
  if (explicitRole && explicitRole !== IMPLIED_ROLES[tag]) {
    return `${tag}[role="${explicitRole.slice(0, 40)}"]`;
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return `${tag}[aria-label="${ariaLabel.trim().slice(0, 40)}"]`;
  }

  if (tag === 'img') {
    const alt = element.getAttribute('alt');
    if (alt && alt.trim()) return `img "${alt.trim().slice(0, 32)}"`;
  }

  const usable = classList(element).find((name) => !isGeneratedClass(name));
  if (usable) return `${tag}.${usable}`;

  const testId = element.getAttribute('data-testid');
  if (testId && !isGeneratedId(testId)) return `${tag}[data-testid="${testId.slice(0, 40)}"]`;

  // Only an element that renders text of its own is labelled by that text; a
  // wrapper is not named after whatever happens to sit inside it.
  if (hasOwnText(element)) {
    const text = textSample(element, LABEL_TEXT_SAMPLE);
    if (text) return `${tag} "${text}"`;
  }

  if (id) return `${tag}#${id}`;
  return tag;
}

function cssEscape(value: string): string {
  const escaper = (globalThis as { CSS?: { escape?(value: string): string } }).CSS?.escape;
  if (typeof escaper === 'function') return escaper(value);
  return value.replace(/[^\w-]/g, (char) => `\\${char}`);
}

function nthOfType(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  let index = 0;
  for (const child of Array.from(parent.children)) {
    if (child.tagName === element.tagName) {
      index += 1;
      if (child === element) return index;
    }
  }
  return index || 1;
}

/**
 * Best-effort CSS path. Prefers a unique `#id`, otherwise builds an
 * `:nth-of-type` chain back to the nearest ancestor with a usable id, or to
 * `body`.
 */
export function buildLocator(element: Element): string {
  const doc = element.ownerDocument;
  const id = element.getAttribute('id');
  if (id) {
    const selector = `#${cssEscape(id)}`;
    try {
      if (doc && doc.querySelectorAll(selector).length === 1) return selector;
    } catch {
      // Fall through to the structural path.
    }
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html' || tag === EXTENSION_HOST_TAG) {
      parts.unshift(tag === EXTENSION_HOST_TAG ? tag : 'body');
      break;
    }

    const currentId = current.getAttribute('id');
    if (currentId && current !== element) {
      let unique = false;
      try {
        unique = !!doc && doc.querySelectorAll(`#${cssEscape(currentId)}`).length === 1;
      } catch {
        unique = false;
      }
      if (unique) {
        parts.unshift(`#${cssEscape(currentId)}`);
        break;
      }
    }

    parts.unshift(`${tag}:nth-of-type(${nthOfType(current)})`);

    const parent: Element | null = current.parentElement;
    if (!parent) {
      // Detached, or the top of a shadow tree.
      break;
    }
    current = parent;
  }

  return parts.join(' > ');
}

export function describeElement(element: Element): ElementDescriptor {
  return {
    tag: element.tagName.toLowerCase(),
    id: element.getAttribute('id'),
    classes: classList(element),
    role: roleOf(element),
    label: labelOf(element),
    textSample: textSample(element),
    locator: buildLocator(element),
  };
}

/**
 * Ancestor chain from the element's parent up to `body`. Wrappers whose rect
 * matches their only element child are marked redundant so the breadcrumb can
 * hide them, while ArrowUp still walks through every level (PRD INS-04).
 */
export interface AncestorEntry {
  element: Element;
  descriptor: ElementDescriptor;
  /** True when the element has one element child with the same box. */
  redundant: boolean;
}

export function collectAncestors(
  element: Element,
  measure?: (target: Element) => { width: number; height: number; x: number; y: number },
): AncestorEntry[] {
  const out: AncestorEntry[] = [];
  let current = element.parentElement;

  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html' || tag === EXTENSION_HOST_TAG) break;

    let redundant = false;
    if (measure && tag !== 'body' && current.children.length === 1) {
      try {
        const own = measure(current);
        const child = measure(current.children[0] as Element);
        // A collapsed box is not "the same box as its child" in any useful
        // sense, and treating it as redundant would empty the breadcrumb.
        redundant =
          own.width > 0 &&
          own.height > 0 &&
          Math.abs(own.width - child.width) < 0.5 &&
          Math.abs(own.height - child.height) < 0.5 &&
          Math.abs(own.x - child.x) < 0.5 &&
          Math.abs(own.y - child.y) < 0.5;
      } catch {
        redundant = false;
      }
    }

    out.push({ element: current, descriptor: describeElement(current), redundant });
    if (tag === 'body') break;
    current = current.parentElement;
  }

  return out;
}
