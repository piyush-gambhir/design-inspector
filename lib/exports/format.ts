// Shared formatting helpers for the export adapters.
// Pure TypeScript: no DOM, no chrome APIs.

/** Formats a number with at most 3 decimals and no trailing zeros. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number.parseFloat(value.toFixed(3));
  if (Object.is(rounded, -0) || rounded === 0) return '0';
  return String(rounded);
}

/** `12.5px`, using the same decimal rules as `num`. */
export function px(value: number): string {
  return `${num(value)}px`;
}

/** Collapses every run of whitespace to a single space and trims the ends. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Removes em dashes, which are banned in every piece of prose this extension
 * writes. A dash with surrounding spaces becomes a colon plus one space.
 */
export function scrubEmDashes(value: string): string {
  return value.replace(/\s*—\s*/g, ': ');
}

/** Escapes pipe characters so a value cannot break out of a Markdown table cell. */
export function escapeCell(value: string): string {
  return scrubEmDashes(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Quotes a font family name when it needs quoting in a CSS font stack. */
export function quoteFamily(family: string): string {
  const name = family.trim().replace(/^["']|["']$/g, '');
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(name) ? name : `"${name}"`;
}

/** Serializes a split font stack back into a CSS `font-family` value. */
export function fontStack(families: string[]): string {
  return families
    .map((family) => quoteFamily(family))
    .filter((family) => family !== '""')
    .join(', ');
}

/** True for CSS length strings that resolve to zero, e.g. `0`, `0px`, `0% 0%`. */
export function isZeroLength(value: string): boolean {
  const numbers = value.match(/-?\d*\.?\d+/g);
  if (!numbers) return collapseWhitespace(value) === '' || collapseWhitespace(value) === '0';
  return numbers.every((token) => Number.parseFloat(token) === 0);
}

/** Rounds to 2 decimals, the grouping precision used across summaries. */
export function round2(value: number): number {
  return Number.parseFloat(value.toFixed(2));
}

/** Stable string comparison used as the final tie-break in every sort. */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
