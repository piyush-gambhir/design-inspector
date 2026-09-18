// Unit and CSS value-list helpers. Pure, no DOM access, so they can be unit
// tested without a browser (PRD 20.2).
//
// The list splitters exist because computed values such as `box-shadow` and
// `background-image` are comma separated lists whose items contain their own
// commas: `rgb(0, 0, 0) 0 1px 2px, rgb(255, 255, 255) 0 0 0`. Splitting on
// every comma corrupts them, so we only split at the top level.

/**
 * Splits `value` on `separator` characters that sit outside brackets and
 * quotes. Items are trimmed; empty items are dropped.
 */
export function splitTopLevel(value: string, separator = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] as string;

    if (quote) {
      if (char === '\\') {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (char === separator && depth === 0) {
      const item = value.slice(start, i).trim();
      if (item) out.push(item);
      start = i + 1;
    }
  }

  const last = value.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** Placeholder values that mean "nothing declared" for a list property. */
const EMPTY_LIST_VALUES = new Set(['', 'none', 'normal', 'auto', 'initial', 'unset']);

/**
 * Splits a computed list property (`background-image`, `box-shadow`,
 * `text-shadow`) into its layers, preserving declared order. Returns an empty
 * array when nothing is declared.
 */
export function splitCssList(value: string | null | undefined): string[] {
  const text = (value ?? '').trim();
  if (EMPTY_LIST_VALUES.has(text.toLowerCase())) return [];
  return splitTopLevel(text, ',');
}

/**
 * Reads a computed length as CSS px. Keywords that carry no length
 * (`normal`, `auto`, `none`) read as 0, which callers keep separate from the
 * raw string so that `line-height: normal` is never shown as `0px`.
 */
export function parsePx(value: string | null | undefined): number {
  const text = (value ?? '').trim();
  if (!text) return 0;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A number followed by a viewport unit, anywhere in an authored value. */
const VIEWPORT_UNIT = /\d\s*(?:vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb)\b/i;

/**
 * True for an authored length whose result moves with the viewport: a viewport
 * unit, or a `clamp()` whose middle term is almost always one.
 *
 * Percentages are not viewport dependent: the root's percentage parent is the
 * browser's default font size, not the window.
 */
export function isViewportDependentLength(value: string | null | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return false;
  if (text.includes('clamp(')) return true;
  return VIEWPORT_UNIT.test(text);
}

/** px to rem against the inspected document's root font size (PRD TYP-01). */
export function pxToRem(px: number, rootFontSize: number): number {
  if (!Number.isFinite(rootFontSize) || rootFontSize <= 0) return 0;
  return px / rootFontSize;
}

export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Fixed-decimal text with trailing zeros removed, for compact display. */
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = value.toFixed(decimals);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** Compact px label: `12px`, `1.5px`, `0px`. */
export function formatPx(value: number, decimals = 2): string {
  return `${formatNumber(roundTo(value, decimals), decimals)}px`;
}

/** Extracts the `url(...)` targets from a computed value, unquoted. */
export function extractUrls(value: string | null | undefined): string[] {
  const text = value ?? '';
  const out: string[] = [];
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
  let match = pattern.exec(text);
  while (match) {
    const url = match[1] ?? match[2] ?? match[3] ?? '';
    if (url) out.push(url);
    match = pattern.exec(text);
  }
  return out;
}

/** True when a computed value declares something other than `none`. */
export function isDeclared(value: string | null | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase();
  return text !== '' && text !== 'none';
}
