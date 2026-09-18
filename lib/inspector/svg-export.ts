// Standalone .svg export for an inline SVG (PRD AST-03).
//
// The exported file must render on its own, carry no executable content, and
// be honest about anything it still depends on. We therefore inline the
// computed paint properties, copy the targets of `<use href="#id">` into the
// clone, strip scripts and event handlers, and report every reference that
// still points outside the document.

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** Elements whose paint we inline. Containers are covered through their children. */
const PAINTED_TAGS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'use',
]);

const PAINT_PROPERTIES = ['fill', 'stroke', 'stroke-width', 'opacity'] as const;

export interface SvgExportResult {
  markup: string;
  limitations: string[];
}

type StyleReader = (element: Element) => CSSStyleDeclaration;

function safeStyle(element: Element, getStyle: StyleReader): CSSStyleDeclaration | null {
  try {
    return getStyle(element);
  } catch {
    return null;
  }
}

function escapeId(value: string): string {
  const escaper = (globalThis as { CSS?: { escape?(value: string): string } }).CSS?.escape;
  if (typeof escaper === 'function') return escaper(value);
  return value.replace(/[^\w-]/g, (char) => `\\${char}`);
}

function fragmentId(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  return text.startsWith('#') && text.length > 1 ? text.slice(1) : null;
}

function hrefOf(element: Element): string | null {
  return element.getAttribute('href') ?? element.getAttributeNS(XLINK_NS, 'href');
}

function stripExecutable(root: Element): void {
  const nodes: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const node of nodes) {
    if (node.tagName.toLowerCase() === 'script') {
      node.remove();
      continue;
    }
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        node.removeAttribute(attribute.name);
        continue;
      }
      if (
        (name === 'href' || name === 'xlink:href') &&
        /^\s*javascript:/i.test(attribute.value)
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  }
}

function ensureDefs(clone: SVGElement): Element {
  const existing = Array.from(clone.children).find(
    (child) => child.tagName.toLowerCase() === 'defs',
  );
  if (existing) return existing;
  const doc = clone.ownerDocument;
  const defs = doc.createElementNS(SVG_NS, 'defs');
  clone.insertBefore(defs, clone.firstChild);
  return defs;
}

function serialize(clone: SVGElement): string {
  const serializer = (globalThis as { XMLSerializer?: new () => XMLSerializer }).XMLSerializer;
  if (serializer) {
    try {
      return new serializer().serializeToString(clone);
    } catch {
      // Fall through to the HTML serializer.
    }
  }
  return clone.outerHTML;
}

/** Collapses the duplicate namespace declarations a serializer may emit. */
function dedupeRootNamespaces(markup: string): string {
  const tagEnd = markup.indexOf('>');
  if (tagEnd < 0) return markup;
  let tag = markup.slice(0, tagEnd);
  const rest = markup.slice(tagEnd);
  const seen = new Set<string>();
  tag = tag.replace(/\s(xmlns(?::[\w-]+)?)="([^"]*)"/g, (match, name: string) => {
    if (seen.has(name)) return '';
    seen.add(name);
    return match;
  });
  return tag + rest;
}

/**
 * Serializes an inline `<svg>` into standalone markup. Never throws: anything
 * it cannot resolve is reported in `limitations` instead (PRD AST-03).
 */
export function serializeInlineSvg(
  svg: SVGElement,
  options: { getStyle?: StyleReader } = {},
): SvgExportResult {
  const limitations: string[] = [];
  const getStyle = options.getStyle ?? ((element: Element) => getComputedStyle(element));

  let clone: SVGElement;
  try {
    clone = svg.cloneNode(true) as SVGElement;
  } catch {
    return { markup: '', limitations: ['The SVG could not be copied for export.'] };
  }

  // Inline computed paint. Originals and clones enumerate in the same order.
  const originals: Element[] = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const clones: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (let i = 0; i < originals.length && i < clones.length; i += 1) {
    const original = originals[i] as Element;
    const target = clones[i] as Element;
    if (!PAINTED_TAGS.has(original.tagName.toLowerCase())) continue;
    const style = safeStyle(original, getStyle);
    if (!style) continue;
    for (const property of PAINT_PROPERTIES) {
      const computed = (style.getPropertyValue(property) ?? '').trim();
      if (!computed) continue;
      const attribute = original.getAttribute(property);
      if (attribute !== null && attribute.trim() === computed) continue;
      try {
        target.setAttribute(property, computed);
      } catch {
        // An unusual value; leave the attribute as authored.
      }
    }
  }

  // Copy <use> targets that live outside the selected subtree.
  const uses = Array.from(clone.querySelectorAll('use'));
  const copied = new Set<string>();
  for (const use of uses) {
    const href = hrefOf(use);
    const id = fragmentId(href);
    if (!id) {
      if (href) limitations.push(`A <use> element points outside this document: ${href}`);
      continue;
    }
    if (clone.querySelector(`#${escapeId(id)}`)) continue;
    if (copied.has(id)) continue;

    const doc = svg.ownerDocument;
    const target = doc?.getElementById(id) ?? null;
    if (!target) {
      limitations.push(`The <use> target #${id} was not found, so that shape may be missing.`);
      continue;
    }
    try {
      ensureDefs(clone).appendChild(target.cloneNode(true));
      copied.add(id);
    } catch {
      limitations.push(`The <use> target #${id} could not be copied into the export.`);
    }
  }

  stripExecutable(clone);

  try {
    clone.setAttributeNS(XMLNS_NS, 'xmlns', SVG_NS);
    clone.setAttributeNS(XMLNS_NS, 'xmlns:xlink', XLINK_NS);
  } catch {
    limitations.push('Namespace attributes could not be set on the export.');
  }

  // Give the standalone file a size when the markup has none.
  if (!clone.getAttribute('width') || !clone.getAttribute('height')) {
    try {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && !clone.getAttribute('viewBox')) {
        clone.setAttribute('width', String(Math.round(rect.width)));
        clone.setAttribute('height', String(Math.round(rect.height)));
      }
    } catch {
      // Geometry is optional for the export.
    }
  }

  const markup = dedupeRootNamespaces(serialize(clone));

  // Anything still pointing outside the document is a real dependency.
  const external = new Set<string>();
  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
  let match = urlPattern.exec(markup);
  while (match) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (value && !value.startsWith('#') && !value.startsWith('data:')) external.add(value);
    match = urlPattern.exec(markup);
  }
  const hrefPattern = /(?:xlink:)?href="([^"]*)"/gi;
  match = hrefPattern.exec(markup);
  while (match) {
    const value = (match[1] ?? '').trim();
    if (value && !value.startsWith('#') && !value.startsWith('data:')) external.add(value);
    match = hrefPattern.exec(markup);
  }
  for (const reference of external) {
    limitations.push(`This export still references ${reference}, which is not embedded.`);
  }

  return { markup, limitations };
}

/** A `data:` URL for downloading serialized SVG markup (PRD AST-02). */
export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}
