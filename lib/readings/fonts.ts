// Font identification (PRD TYP-01, TYP-02, TYP-03).
//
// The hard rule from TYP-02: the first family in a CSS stack is never treated
// as the verified rendered font on the strength of a CSS declaration.
// `declared` is the stack alone, `matched` means a loaded @font-face covering
// the computed weight exists for that family (or the family is a generic or
// well-known system family), and `verified` is reserved for the one piece of
// evidence that actually settles it: a canvas measurement showing the family
// paints text at a different width than the fallbacks it would drop to.

import type {
  FontConfidence,
  FontFaceRecord,
  FontIdentity,
  FontSource,
  FontSourceKind,
} from '../contracts';
import { splitTopLevel } from './units';

/** CSS generic families plus the system aliases that resolve without a download. */
export const GENERIC_FAMILIES: readonly string[] = [
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
];

/** Families that ship with mainstream operating systems (PRD TYP-01 source: system). */
export const SYSTEM_FAMILIES: readonly string[] = [
  'segoe ui',
  'roboto',
  'helvetica neue',
  'helvetica',
  'arial',
  'georgia',
  'times new roman',
  'times',
  'courier new',
  'courier',
  'verdana',
  'tahoma',
  'trebuchet ms',
  'menlo',
  'monaco',
  'consolas',
  'apple color emoji',
  'segoe ui emoji',
];

const PROVIDER_HOSTS: { kind: FontSource['kind']; hosts: readonly string[] }[] = [
  { kind: 'google', hosts: ['fonts.gstatic.com', 'fonts.googleapis.com'] },
  { kind: 'adobe', hosts: ['use.typekit.net', 'p.typekit.net', 'use.edgefonts.net'] },
  { kind: 'fontshare', hosts: ['fontshare.com', 'api.fontshare.com', 'cdn.fontshare.com'] },
];

const FONT_FILE_PATTERN = /\.(woff2|woff|ttf|otf|eot|svg)(\?|#|$)/i;

/** Unquotes and trims one family token. */
export function normalizeFamily(family: string): string {
  const text = family.trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

/**
 * Splits a computed font-family stack. Quoted names may contain commas, so the
 * split happens at top level only and quotes are then removed.
 */
export function splitFontFamilyStack(stack: string | null | undefined): string[] {
  const text = (stack ?? '').trim();
  if (!text) return [];
  return splitTopLevel(text, ',')
    .map(normalizeFamily)
    .filter((family) => family.length > 0);
}

export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.includes(normalizeFamily(family).toLowerCase());
}

/** Generic or a well-known preinstalled family, so no web font is needed. */
export function isSystemFamily(family: string): boolean {
  const key = normalizeFamily(family).toLowerCase();
  return GENERIC_FAMILIES.includes(key) || SYSTEM_FAMILIES.includes(key);
}

export function formatFromUrl(url: string): string | null {
  const match = /\.(woff2|woff|ttf|otf|eot)(\?|#|$)/i.exec(url);
  if (match) return (match[1] as string).toLowerCase();
  if (url.startsWith('data:font/')) {
    const type = url.slice('data:font/'.length).split(/[;,]/)[0];
    return type ? type.toLowerCase() : null;
  }
  return null;
}

/** `format('woff2')` hints in a src descriptor, used when the URL has no extension. */
export function formatFromSrcHint(src: string): string | null {
  const match = /format\(\s*["']?([a-z0-9-]+)["']?\s*\)/i.exec(src);
  return match ? (match[1] as string).toLowerCase() : null;
}

/** Extracts the `url()` targets from a `src` descriptor in declared order. */
export function srcUrls(src: string, baseUrl?: string): string[] {
  const out: string[] = [];
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
  let match = pattern.exec(src);
  while (match) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    if (raw) {
      if (baseUrl) {
        try {
          out.push(new URL(raw, baseUrl).href);
        } catch {
          out.push(raw);
        }
      } else {
        out.push(raw);
      }
    }
    match = pattern.exec(src);
  }
  return out;
}

/** The full Unicode range. Anything narrower means the file is a subset. */
export function isSubsetRange(unicodeRange: string | null): boolean | null {
  if (!unicodeRange) return null;
  const normalized = unicodeRange.replace(/\s+/g, '').toLowerCase();
  if (!normalized) return null;
  const full = new Set(['u+0-10ffff', 'u+0-10ffff;', 'u+00-10ffff', 'u+000000-10ffff']);
  return !full.has(normalized);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url, 'https://example.invalid').hostname.toLowerCase();
  } catch {
    return null;
  }
}

export interface ClassifyOptions {
  /** Origin of the inspected document, used to tell self-hosted from third party. */
  pageOrigin?: string;
  /** Provider stylesheet links found on the page, used when no src URL is readable. */
  providerUrls?: string[];
}

/**
 * Classifies where a family comes from. URLs win over heuristics; a family
 * with no discoverable file falls back to `system` or `unknown`.
 */
export function classifyFontSource(
  family: string,
  urls: string[],
  options: ClassifyOptions = {},
): FontSource {
  // 1. The face's own src URLs are the only direct evidence.
  for (const provider of PROVIDER_HOSTS) {
    const hit = urls.find((url) => providerHostMatches(provider.hosts, url));
    if (hit) {
      return { kind: provider.kind, url: hit, format: formatFromUrl(hit), subset: null };
    }
  }

  const fileUrl = urls.find((url) => FONT_FILE_PATTERN.test(url) || url.startsWith('data:font/'));
  if (fileUrl) {
    const host = hostOf(fileUrl);
    const pageHost = options.pageOrigin ? hostOf(options.pageOrigin) : null;
    const sameOrigin = fileUrl.startsWith('data:') || !host || !pageHost || host === pageHost;
    return {
      kind: 'self-hosted',
      url: fileUrl,
      format: formatFromUrl(fileUrl),
      subset: null,
      ...(sameOrigin ? {} : { note: `That host is not this page's own origin.` }),
    };
  }

  if (isSystemFamily(family)) {
    return { kind: 'system', url: null, format: null, subset: null };
  }

  // 2. No readable src. A provider stylesheet on the page counts only when its
  //    URL names this family (Google Fonts and Fontshare carry family names in
  //    the query). Otherwise the honest answer is unknown, with the provider
  //    mentioned as a possibility, never asserted (PRD TYP-03, 16.1).
  const providerUrls = options.providerUrls ?? [];
  for (const provider of PROVIDER_HOSTS) {
    const hit = providerUrls.find(
      (url) => providerHostMatches(provider.hosts, url) && urlNamesFamily(url, family),
    );
    if (hit) {
      return {
        kind: provider.kind,
        url: hit,
        format: null,
        subset: null,
        note: 'Attributed from the provider stylesheet that requests this family; the font file itself was not readable.',
      };
    }
  }
  const providersPresent = PROVIDER_HOSTS.filter((provider) =>
    providerUrls.some((url) => providerHostMatches(provider.hosts, url)),
  ).map((provider) => provider.kind);

  return {
    kind: 'unknown',
    url: null,
    format: null,
    subset: null,
    note:
      providersPresent.length > 0
        ? `No @font-face source was readable for this family. The page loads ${providersPresent.join(' and ')} fonts, which may or may not include it.`
        : 'No @font-face source was discoverable for this family.',
  };
}

function providerHostMatches(hosts: readonly string[], url: string): boolean {
  const host = hostOf(url);
  return host ? hosts.some((known) => host === known || host.endsWith(`.${known}`)) : false;
}

/** True when a provider stylesheet URL requests this family by name. */
export function urlNamesFamily(url: string, family: string): boolean {
  const wanted = normalizeFamily(family).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!wanted) return false;
  let query = '';
  try {
    query = decodeURIComponent(new URL(url).search);
  } catch {
    return false;
  }
  return query
    .split(/[?&]/)
    .filter((part) => /^family=/i.test(part) || /^f\[\]=/i.test(part))
    .flatMap((part) => part.replace(/^[^=]*=/, '').split('|'))
    .map((name) => name.split(/[:@]/)[0] ?? '')
    .some((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '') === wanted);
}

// ---------------------------------------------------------------------------
// Weight ranges

/** Parses an `@font-face` weight descriptor into an inclusive range. */
export function parseWeightRange(weight: string | null | undefined): [number, number] {
  const text = (weight ?? '').trim().toLowerCase();
  if (!text || text === 'normal') return [400, 400];
  if (text === 'bold') return [700, 700];
  const parts = text.split(/\s+/).map((part) => {
    if (part === 'normal') return 400;
    if (part === 'bold') return 700;
    const value = Number.parseFloat(part);
    return Number.isFinite(value) ? value : 400;
  });
  const first = parts[0] ?? 400;
  const second = parts[1] ?? first;
  return [Math.min(first, second), Math.max(first, second)];
}

export function weightCovered(weight: string | null | undefined, computedWeight: number): boolean {
  const [min, max] = parseWeightRange(weight);
  return computedWeight >= min && computedWeight <= max;
}

// ---------------------------------------------------------------------------
// Family identification

export interface FamilyIdentification {
  familyReading: string;
  familyConfidence: FontConfidence;
  source: FontSource;
}

/**
 * Identifies the family to show for a text element. Never returns `verified`
 * (PRD TYP-02): a loaded file does not prove it rendered the characters.
 */
export function identifyFamily(
  stack: string[],
  computedWeight: number,
  faces: FontFaceRecord[],
  options: ClassifyOptions = {},
): FamilyIdentification {
  const first = stack[0] ?? '';
  if (!first) {
    return {
      familyReading: 'Unknown',
      familyConfidence: 'declared',
      source: { kind: 'unknown', url: null, format: null, subset: null },
    };
  }

  const key = first.toLowerCase();
  const familyFaces = faces.filter((face) => normalizeFamily(face.family).toLowerCase() === key);
  const loadedCovering = familyFaces.filter(
    (face) => face.status === 'loaded' && weightCovered(face.weight, computedWeight),
  );

  const urls = (loadedCovering.length > 0 ? loadedCovering : familyFaces).flatMap(
    (face) => face.urls,
  );
  const source = classifyFontSource(first, urls, options);

  const chosen = loadedCovering[0] ?? familyFaces[0];
  if (chosen) {
    const subset = isSubsetRange(chosen.unicodeRange);
    source.subset = subset;
    if (subset === true && !source.note) {
      source.note = 'This file is a subset, not the whole family.';
    }
    if (!source.format && chosen.format) source.format = chosen.format;
  }

  const matched = loadedCovering.length > 0 || isSystemFamily(first);

  return {
    familyReading: first,
    familyConfidence: matched ? 'matched' : 'declared',
    source,
  };
}

// ---------------------------------------------------------------------------
// Verified rendering (PRD TYP-02)

export type RenderCheck = 'rendered' | 'fallback' | 'inconclusive';

/**
 * Wide enough that a substituted face almost always measures differently, and
 * short enough to measure in well under a millisecond.
 */
export const RENDER_CHECK_TEXT = 'Sphinx of black quartz judge my vow 0123456789';

/** The size the comparison is made at. Larger magnifies the width difference. */
const RENDER_CHECK_PX = 32;

/** Only the part of a 2D context this check touches, so a test can stand in for it. */
export interface TextMeasurer {
  font: string;
  measureText(text: string): { width: number };
}

const measurerByDocument = new WeakMap<Document, TextMeasurer | null>();
const renderCheckCache = new Map<string, RenderCheck>();

/** Test seam, and the page-session reset when a font finishes loading late. */
export function resetRenderCheckCache(): void {
  renderCheckCache.clear();
}

/**
 * A CSS font shorthand at the comparison size. A family name is page data, so
 * `quoted` escapes it before it goes anywhere near a shorthand.
 */
function shorthand(weight: number, style: string, family: string): string {
  return `${style && style !== 'normal' ? `${style} ` : ''}${weight} ${RENDER_CHECK_PX}px ${family}`;
}

function quoted(family: string): string {
  return `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** One detached canvas per document, created on the first deep reading and kept. */
function measurerFor(doc: Document): TextMeasurer | null {
  if (!measurerByDocument.has(doc)) {
    let made: TextMeasurer | null = null;
    try {
      // Never inserted into the document, so it costs no layout and is invisible.
      made = doc.createElement('canvas').getContext('2d') as unknown as TextMeasurer | null;
    } catch {
      made = null;
    }
    measurerByDocument.set(doc, made);
  }
  return measurerByDocument.get(doc) ?? null;
}

/**
 * Did this family actually paint the text, or did the browser quietly fall
 * through to the next entry in the stack?
 *
 * The test is the oldest one there is: measure the string with the family in
 * front of a fallback, then measure the fallback alone. If the two agree, the
 * family contributed nothing. Two fallbacks are used because a face can
 * coincidentally match one of them, and a family that differs from both
 * monospace and serif is rendering. Equal widths are only called a fallback
 * when the font set agrees the face is absent: a family whose metrics happen to
 * match the fallback is a real case, and it reads as inconclusive (PRD 16.1).
 *
 * This is the evidence PRD TYP-02 reserves `verified` for, so it is deliberate
 * that it runs only on a pinned (deep) reading, never on hover.
 */
export function renderCheck(
  family: string,
  weight: number,
  style: string,
  doc: Document,
  /** Test seam. Left out, the document's own canvas is used; `null` means none. */
  measurer?: TextMeasurer | null,
): RenderCheck {
  const name = normalizeFamily(family);
  if (!name) return 'inconclusive';
  // A generic keyword is whatever the browser resolves it to, so there is no
  // substitution to detect: it rendered, by definition.
  if (isGenericFamily(name)) return 'rendered';

  const key = `${name.toLowerCase()}|${weight}|${style}`;
  const cached = renderCheckCache.get(key);
  if (cached) return cached;

  // Resolved after the cache, so a repeat reading costs nothing at all.
  const context = measurer === undefined ? measurerFor(doc) : measurer;
  const width = (of: string): number => {
    if (!context) return 0;
    try {
      context.font = shorthand(weight, style, of);
      const measured = context.measureText(RENDER_CHECK_TEXT).width;
      return Number.isFinite(measured) && measured > 0 ? measured : 0;
    } catch {
      return 0;
    }
  };

  const name2 = quoted(name);
  const mono = width('monospace');
  const serif = width('serif');
  const withMono = width(`${name2}, monospace`);
  const withSerif = width(`${name2}, serif`);

  let result: RenderCheck = 'inconclusive';
  if (mono && serif && withMono && withSerif) {
    if (withMono !== mono && withSerif !== serif) result = 'rendered';
    else if (withMono === mono && withSerif === serif && absent(doc, name2, weight, style)) {
      result = 'fallback';
    }
  }
  renderCheckCache.set(key, result);
  return result;
}

/** True when `document.fonts.check()` answers a definite no for this face. */
function absent(doc: Document, family: string, weight: number, style: string): boolean {
  try {
    const set = doc.fonts;
    return (
      !!set &&
      typeof set.check === 'function' &&
      set.check(shorthand(weight, style, family), RENDER_CHECK_TEXT) === false
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reading faces from the document

export interface DocumentFontsResult {
  faces: FontFaceRecord[];
  /** Provider stylesheet URLs found on the page (Google, Adobe, Fontshare). */
  providerUrls: string[];
  limitations: string[];
}

function faceKey(family: string, weight: string, style: string): string {
  return `${normalizeFamily(family).toLowerCase()}|${weight.trim()}|${style.trim()}`;
}

/**
 * Collects @font-face records from `document.fonts` (for load status) merged
 * with CSSFontFaceRules (for src URLs, which FontFace objects do not expose).
 * Cross-origin stylesheets throw on `cssRules`; that is caught and reported as
 * a limitation so typography still works (PRD TYP-03).
 */
export function readDocumentFonts(doc: Document = document): DocumentFontsResult {
  const limitations: string[] = [];
  const byKey = new Map<string, FontFaceRecord>();
  const providerUrls: string[] = [];

  const collectProvider = (url: string): void => {
    const host = hostOf(url);
    if (!host) return;
    const known = PROVIDER_HOSTS.some((provider) =>
      provider.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)),
    );
    if (known && !providerUrls.includes(url)) providerUrls.push(url);
  };

  try {
    // Only requested stylesheets count. A preconnect proves nothing (F10, F2).
    const links = doc.querySelectorAll('link[rel~="stylesheet"][href]');
    links.forEach((link) => {
      const href = (link as HTMLLinkElement).href;
      if (href) collectProvider(href);
    });
  } catch {
    limitations.push('Stylesheet links could not be listed.');
  }

  // Pass 1: CSSFontFaceRule for src URLs and unicode-range.
  let sheets: StyleSheet[] = [];
  try {
    sheets = Array.from(doc.styleSheets);
  } catch {
    limitations.push('The document stylesheet list could not be read.');
  }

  let blockedSheets = 0;
  for (const sheet of sheets) {
    const cssSheet = sheet as CSSStyleSheet;
    if (cssSheet.href) collectProvider(cssSheet.href);
    let rules: CSSRuleList | null = null;
    try {
      rules = cssSheet.cssRules;
    } catch {
      blockedSheets += 1;
      continue;
    }
    if (!rules) continue;

    for (const rule of Array.from(rules)) {
      const type = (rule as { type?: number }).type;
      const isFontFace =
        type === 5 || rule.constructor?.name === 'CSSFontFaceRule' || /^@font-face/i.test(rule.cssText ?? '');
      if (!isFontFace) continue;

      const style = (rule as CSSFontFaceRule).style;
      if (!style) continue;
      const family = normalizeFamily(style.getPropertyValue('font-family') ?? '');
      if (!family) continue;
      const src = style.getPropertyValue('src') ?? '';
      const weight = (style.getPropertyValue('font-weight') || 'normal').trim();
      const fontStyle = (style.getPropertyValue('font-style') || 'normal').trim();
      const range = style.getPropertyValue('unicode-range') || null;
      const urls = srcUrls(src, cssSheet.href ?? doc.baseURI);
      urls.forEach(collectProvider);

      const key = faceKey(family, weight, fontStyle);
      byKey.set(key, {
        family,
        weight,
        style: fontStyle,
        urls,
        format: urls.map(formatFromUrl).find((value): value is string => !!value) ?? formatFromSrcHint(src),
        unicodeRange: range ? range.trim() : null,
        status: null,
      });
    }
  }

  if (blockedSheets > 0) {
    limitations.push(
      `${blockedSheets} cross-origin stylesheet${blockedSheets === 1 ? '' : 's'} could not be read, so some @font-face sources are unknown.`,
    );
  }

  // Pass 2: document.fonts for load status, which the CSS rules do not carry.
  try {
    const set = doc.fonts;
    if (set && typeof set.forEach === 'function') {
      set.forEach((face) => {
        const family = normalizeFamily(face.family ?? '');
        if (!family) return;
        const weight = (face.weight || 'normal').trim();
        const style = (face.style || 'normal').trim();
        const key = faceKey(family, weight, style);
        const existing = byKey.get(key);
        const status = (face.status ?? null) as FontFaceRecord['status'];
        if (existing) {
          existing.status = status;
          if (!existing.unicodeRange && face.unicodeRange) {
            existing.unicodeRange = face.unicodeRange;
          }
        } else {
          byKey.set(key, {
            family,
            weight,
            style,
            urls: [],
            format: null,
            unicodeRange: face.unicodeRange ?? null,
            status,
          });
        }
      });
    } else {
      limitations.push('document.fonts is unavailable, so font load status is unknown.');
    }
  } catch {
    limitations.push('document.fonts could not be read, so font load status is unknown.');
  }

  return { faces: Array.from(byKey.values()), providerUrls, limitations };
}

// ---------------------------------------------------------------------------
// Presenting an identity (shared by the on-page panel and the side panel)

/**
 * The three hosted providers, in one table: their name is what the source line
 * prints and what the "Open on ..." link is labelled with, and the specimen
 * page is where a reader goes to see the whole family.
 */
const PROVIDERS: Record<'google' | 'adobe' | 'fontshare', { name: string; page: (family: string) => string }> = {
  google: {
    name: 'Google Fonts',
    page: (family) => `https://fonts.google.com/specimen/${family.replace(/\s+/g, '+')}`,
  },
  adobe: {
    name: 'Adobe Fonts',
    page: (family) => `https://fonts.adobe.com/search?query=${encodeURIComponent(family)}`,
  },
  fontshare: {
    name: 'Fontshare',
    page: (family) =>
      `https://www.fontshare.com/fonts/${family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  },
};

function providerOf(kind: FontSourceKind): { name: string; page: (family: string) => string } | null {
  return kind === 'google' || kind === 'adobe' || kind === 'fontshare' ? PROVIDERS[kind] : null;
}

/** File sizes read as whole units: a font is 48 KB, never 49152 bytes. */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export function hostnameOf(url: string | null): string | null {
  return !url || url.startsWith('data:') ? null : hostOf(url);
}


/**
 * The one quiet line that replaces a seven-line CDN URL: where the file comes
 * from, what format it is, and how big it is. The URL itself stays behind the
 * Copy URL button, because nobody reads a hashed filename.
 */
export function fontSourceLine(source: FontSource, fileSize?: number | null): string {
  const parts: string[] = [];
  const host = hostnameOf(source.url);
  if (source.kind === 'self-hosted') {
    parts.push(host ? `Self-hosted on ${host}` : 'Self-hosted');
  } else if (source.kind === 'system') {
    parts.push('System font, nothing was downloaded');
  } else if (source.kind === 'unknown') {
    parts.push('Source not found');
  } else {
    parts.push(providerOf(source.kind)?.name ?? source.kind);
    if (host) parts.push(host);
  }

  if (source.format) parts.push(source.format);
  const size = formatFileSize(fileSize);
  if (size) parts.push(size);
  return parts.join(' · ');
}

export interface ProviderLink {
  label: string;
  url: string;
}

/** Where to go and read the whole family, when a provider hosts it. */
export function providerLink(kind: FontSourceKind, family: string): ProviderLink | null {
  const name = normalizeFamily(family).trim();
  const provider = providerOf(kind);
  if (!name || !provider) return null;
  return { label: `Open on ${provider.name}`, url: provider.page(name) };
}

/**
 * What each confidence label is actually claiming. Shown as the badge's title,
 * because the difference between "matched" and "verified" is the whole of
 * PRD TYP-02 and a three-word badge cannot carry it.
 */
export function confidenceEvidence(
  confidence: FontConfidence,
  check?: RenderCheck | null,
): string {
  if (confidence === 'verified') return 'Measured: this family paints differently from its fallbacks.';
  if (check === 'fallback') return 'Measured: the fallback painted this, not this family.';
  return confidence === 'matched'
    ? 'A loaded face covers this family and weight. Not proof it painted this.'
    : 'The first family in the CSS stack. Nothing confirms it was used.';
}

/** "wght 100 to 900". Variable axes as one short chip each. */
export function axisChipText(axis: FontIdentity['axes'][number]): string {
  const round = (value: number): number => Math.round(value * 100) / 100;
  return `${axis.tag} ${round(axis.min)} to ${round(axis.max)}`;
}

/** "by Neubau Berlin", "by Rasmus Andersson for Inter Project". */
export function designerLine(identity: FontIdentity): string | null {
  const designer = identity.designer?.trim() || null;
  const foundry = identity.manufacturer?.trim() || null;
  if (designer && foundry && designer !== foundry) return `by ${designer} for ${foundry}`;
  const one = designer ?? foundry;
  return one ? `by ${one}` : null;
}

/** The first sentence of a licence description, which is the part that says what you may do. */
export function firstSentence(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const stop = /[.!?](\s|$)/.exec(trimmed);
  return stop ? trimmed.slice(0, stop.index + 1) : trimmed;
}

/**
 * The name to show: the typeface's own, when the file has been read, and the
 * CSS alias otherwise. A site calling Neue Haas "Nb international pro webfont"
 * is exactly the case this exists for.
 */
export function displayFamily(cssFamily: string, identity?: FontIdentity | null): string {
  const real = identity?.family?.trim();
  return real ? real : cssFamily;
}

/** True when the CSS alias is worth printing beside the real name. */
export function aliasDiffers(cssFamily: string, identity?: FontIdentity | null): boolean {
  const real = identity?.family?.trim();
  if (!real) return false;
  return normalizeFamily(real).toLowerCase() !== normalizeFamily(cssFamily).toLowerCase();
}

/**
 * One sentence naming the typeface, its designer, the alias the site uses for
 * it, and where the file came from. This is the line the exports carry, so a
 * saved reference says "NB International Pro Regular by Neubau Berlin
 * (declared as 'Nb international pro webfont'), self-hosted" rather than
 * repeating the nickname the CSS happened to use. Null with no identity: the
 * caller keeps whatever it printed before.
 */
export function identityDescription(
  cssFamily: string,
  identity: FontIdentity | null | undefined,
  sourceKind: FontSourceKind,
): string | null {
  if (!identity) return null;
  const name = [identity.family, identity.subfamily].filter((part) => !!part?.trim()).join(' ');
  const by = designerLine(identity);
  const parts = [by ? `${name} ${by}` : name];
  if (aliasDiffers(cssFamily, identity)) parts.push(`(declared as '${cssFamily}')`);
  const where =
    sourceKind === 'self-hosted'
      ? 'self-hosted'
      : sourceKind === 'system'
        ? 'system'
        : sourceKind === 'unknown'
          ? 'source unknown'
          : (providerOf(sourceKind)?.name ?? sourceKind);
  return `${parts.join(' ')}, ${where}`;
}
