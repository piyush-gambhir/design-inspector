







import type { ColorGroup, PageSummary, SourceContext } from '@/lib/contracts';
import {
  clusterPalette,
  colorsAreNear,
  type PaletteCluster,
} from '@/lib/readings/summary-aggregate';


export type Side = 'a' | 'b' | 'both';

export interface CompareEntry {

  key: string;
  label: string;
  count: number;
}

export interface CompareRow {
  key: string;
  label: string;

  a: number | null;
  b: number | null;
  side: Side;
}

export interface CompareSection {
  title: string;
  rows: CompareRow[];
}





export function compareCounts(
  a: CompareEntry[],
  b: CompareEntry[],
  order?: (row: CompareRow) => number,
): CompareRow[] {
  const rows = new Map<string, CompareRow>();

  const put = (entry: CompareEntry, side: 'a' | 'b'): void => {
    let row = rows.get(entry.key);
    if (!row) {
      row = { key: entry.key, label: entry.label, a: null, b: null, side };
      rows.set(entry.key, row);
    }

    row[side] = (row[side] ?? 0) + entry.count;
  };

  for (const entry of a) put(entry, 'a');
  for (const entry of b) put(entry, 'b');

  const merged = [...rows.values()].map((row): CompareRow => ({
    ...row,
    side: row.a !== null && row.b !== null ? 'both' : row.a !== null ? 'a' : 'b',
  }));

  const rank = order ?? ((row: CompareRow) => Math.max(row.a ?? 0, row.b ?? 0));
  return merged.sort((first, second) => rank(second) - rank(first) || cmp(first.label, second.label));
}




function round(value: number, places = 2): string {
  return String(Number(value.toFixed(places)));
}

export function typeScaleEntries(summary: PageSummary): CompareEntry[] {
  return summary.sizeScale.map((entry) => ({
    key: round(entry.sizePx),
    label: `${round(entry.sizePx)} px`,
    count: entry.count,
  }));
}






export function familyEntries(summary: PageSummary): CompareEntry[] {
  const used = new Map<string, { label: string; count: number }>();
  for (const group of summary.typography) {
    const key = group.familyReading.trim().toLowerCase();
    const entry = used.get(key) ?? { label: group.familyReading.trim(), count: 0 };
    entry.count += group.count;
    used.set(key, entry);
  }
  for (const font of summary.fonts) {
    const key = font.family.trim().toLowerCase();
    if (key === '' || used.has(key)) continue;
    used.set(key, { label: font.family.trim(), count: 0 });
  }
  return [...used.entries()].map(([key, entry]) => ({ key, label: entry.label, count: entry.count }));
}

export function spacingEntries(
  summary: PageSummary,
  kind: 'padding' | 'margin' | 'gap',
): CompareEntry[] {
  return summary.spacing[kind].map((entry) => ({
    key: round(entry.valuePx),
    label: `${round(entry.valuePx)} px`,
    count: entry.count,
  }));
}

export function radiusEntries(summary: PageSummary): CompareEntry[] {
  return summary.radii.map((group) => ({ key: group.value, label: group.value, count: group.count }));
}

export function shadowEntries(summary: PageSummary): CompareEntry[] {
  return summary.shadows.map((group) => ({
    key: group.value,
    label: group.value,
    count: group.count,
  }));
}


export function stackEntries(summary: PageSummary): CompareEntry[] {
  return summary.stack.detections.map((detection) => ({
    key: detection.id,
    label: detection.version ? `${detection.name} ${detection.version}` : detection.name,
    count: 1,
  }));
}




export interface PaletteCompareRow {
  key: string;
  label: string;
  a: PaletteCluster | null;
  b: PaletteCluster | null;
  side: Side;
}

function clusterLabel(cluster: PaletteCluster): string {
  const color = cluster.representative.color;
  return color.hex ?? color.raw;
}






export function comparePalettes(a: ColorGroup[], b: ColorGroup[]): PaletteCompareRow[] {
  const left = clusterPalette(a);
  const right = clusterPalette(b);
  const claimed = new Set<string>();
  const rows: PaletteCompareRow[] = [];

  for (const cluster of left) {
    const match = right.find(
      (other) =>
        !claimed.has(other.key) &&
        (other.key === cluster.key ||
          colorsAreNear(cluster.representative.color, other.representative.color)),
    );
    if (match) claimed.add(match.key);
    rows.push({
      key: cluster.key,
      label: clusterLabel(cluster),
      a: cluster,
      b: match ?? null,
      side: match ? 'both' : 'a',
    });
  }

  for (const cluster of right) {
    if (claimed.has(cluster.key)) continue;
    rows.push({ key: cluster.key, label: clusterLabel(cluster), a: null, b: cluster, side: 'b' });
  }

  return rows.sort(
    (first, second) =>
      Math.max(second.a?.totalCount ?? 0, second.b?.totalCount ?? 0) -
        Math.max(first.a?.totalCount ?? 0, first.b?.totalCount ?? 0) ||
      cmp(first.label, second.label),
  );
}




export interface SummaryComparison {
  sections: CompareSection[];
  palette: PaletteCompareRow[];
}

export function compareSummaries(a: PageSummary, b: PageSummary): SummaryComparison {
  const bySizeDescending = (row: CompareRow): number => Number.parseFloat(row.key);
  return {
    sections: [
      { title: 'Type scale', rows: compareCounts(typeScaleEntries(a), typeScaleEntries(b), bySizeDescending) },
      { title: 'Font families', rows: compareCounts(familyEntries(a), familyEntries(b)) },
      {
        title: 'Padding',
        rows: compareCounts(spacingEntries(a, 'padding'), spacingEntries(b, 'padding')),
      },
      {
        title: 'Margin',
        rows: compareCounts(spacingEntries(a, 'margin'), spacingEntries(b, 'margin')),
      },
      { title: 'Gap', rows: compareCounts(spacingEntries(a, 'gap'), spacingEntries(b, 'gap')) },
      { title: 'Radii', rows: compareCounts(radiusEntries(a), radiusEntries(b)) },
      { title: 'Shadows', rows: compareCounts(shadowEntries(a), shadowEntries(b)) },
      { title: 'Stack', rows: compareCounts(stackEntries(a), stackEntries(b)) },
    ],
    palette: comparePalettes(a.colors, b.colors),
  };
}




export function viewportLabel(source: SourceContext): string {
  return `${source.viewport.width} x ${source.viewport.height} CSS px`;
}

function sideLabel(side: Side, titles: { a: string; b: string }): string {
  if (side === 'both') return 'Both';
  return side === 'a' ? `${titles.a} only` : `${titles.b} only`;
}

function cell(count: number | null): string {
  return count === null ? '-' : String(count);
}


function cellText(text: string): string {
  return text.replace(/\|/g, '\\|');
}

export function comparisonToMarkdown(
  a: PageSummary,
  b: PageSummary,
  titles: { a: string; b: string },
): string {
  const comparison = compareSummaries(a, b);
  const lines: string[] = [];

  lines.push(`# Comparison: ${titles.a} and ${titles.b}`);
  lines.push('');
  lines.push(`| | ${cellText(titles.a)} | ${cellText(titles.b)} |`);
  lines.push('| --- | --- | --- |');
  lines.push(`| Source | ${cellText(a.source.url)} | ${cellText(b.source.url)} |`);
  lines.push(`| Captured | ${a.source.capturedAt} | ${b.source.capturedAt} |`);
  lines.push(`| Viewport | ${viewportLabel(a.source)} | ${viewportLabel(b.source)} |`);
  lines.push('');

  const table = (title: string, rows: { label: string; a: number | null; b: number | null; side: Side }[]) => {
    lines.push(`## ${title}`);
    lines.push('');
    if (rows.length === 0) {
      lines.push('Nothing recorded in either summary.');
      lines.push('');
      return;
    }
    lines.push(`| Value | ${cellText(titles.a)} | ${cellText(titles.b)} | Where |`);
    lines.push('| --- | --- | --- | --- |');
    for (const row of rows) {
      lines.push(
        `| ${cellText(row.label)} | ${cell(row.a)} | ${cell(row.b)} | ${sideLabel(row.side, titles)} |`,
      );
    }
    lines.push('');
  };

  const [typeScale, ...rest] = comparison.sections;
  if (typeScale) table(typeScale.title, typeScale.rows);
  table(
    'Palette',
    comparison.palette.map((row) => ({
      label: row.label,
      a: row.a?.totalCount ?? null,
      b: row.b?.totalCount ?? null,
      side: row.side,
    })),
  );
  for (const section of rest) table(section.title, section.rows);

  lines.push(
    'Counts are element and property occurrences, not visual area. Palette rows group near-identical shades for reading; the exact values stay in each summary.',
  );

  return lines.join('\n');
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
