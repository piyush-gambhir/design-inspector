











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


const EMPTY_LIST_VALUES = new Set(['', 'none', 'normal', 'auto', 'initial', 'unset']);






export function splitCssList(value: string | null | undefined): string[] {
  const text = (value ?? '').trim();
  if (EMPTY_LIST_VALUES.has(text.toLowerCase())) return [];
  return splitTopLevel(text, ',');
}






export function parsePx(value: string | null | undefined): number {
  const text = (value ?? '').trim();
  if (!text) return 0;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}


const VIEWPORT_UNIT = /\d\s*(?:vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb)\b/i;








export function isViewportDependentLength(value: string | null | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return false;
  if (text.includes('clamp(')) return true;
  return VIEWPORT_UNIT.test(text);
}


export function pxToRem(px: number, rootFontSize: number): number {
  if (!Number.isFinite(rootFontSize) || rootFontSize <= 0) return 0;
  return px / rootFontSize;
}

export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}


export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '0';
  const text = value.toFixed(decimals);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}


export function formatPx(value: number, decimals = 2): string {
  return `${formatNumber(roundTo(value, decimals), decimals)}px`;
}


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


export function isDeclared(value: string | null | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase();
  return text !== '' && text !== 'none';
}
