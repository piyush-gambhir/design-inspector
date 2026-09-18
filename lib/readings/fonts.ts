// Font identification (PRD TYP-01, TYP-02, TYP-03).
//
// The hard rule from TYP-02: the first family in a CSS stack is never treated
// as the verified rendered font. V1 only ever reports `declared` or `matched`.
// `matched` means a loaded @font-face covering the computed weight exists for
// that family, or the family is a generic or well-known system family.

import type { FontConfidence, FontFaceRecord, FontSource } from '../contracts';
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
      ...(sameOrigin ? {} : { note: `Served from ${host ?? 'another host'}.` }),
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
