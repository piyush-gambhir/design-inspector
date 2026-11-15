



export function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number.parseFloat(value.toFixed(3));
  if (Object.is(rounded, -0) || rounded === 0) return '0';
  return String(rounded);
}


export function px(value: number): string {
  return `${num(value)}px`;
}


export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}





export function scrubEmDashes(value: string): string {
  return value.replace(/\s*—\s*/g, ': ');
}


export function escapeCell(value: string): string {
  return scrubEmDashes(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}


export function quoteFamily(family: string): string {
  const name = family.trim().replace(/^["']|["']$/g, '');
  return /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(name) ? name : `"${name}"`;
}


export function fontStack(families: string[]): string {
  return families
    .map((family) => quoteFamily(family))
    .filter((family) => family !== '""')
    .join(', ');
}


export function isZeroLength(value: string): boolean {
  const numbers = value.match(/-?\d*\.?\d+/g);
  if (!numbers) return collapseWhitespace(value) === '' || collapseWhitespace(value) === '0';
  return numbers.every((token) => Number.parseFloat(token) === 0);
}


export function round2(value: number): number {
  return Number.parseFloat(value.toFixed(2));
}


export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
