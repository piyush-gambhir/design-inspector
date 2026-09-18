// Text filter for the page summary (PRD SUM-06, competitive Tier 1 item 5).
//
// Pure over a PageSummary: the side panel already holds the whole summary, so
// filtering is a local read and sends no new message to the page.
//
// Matching is a case-insensitive substring over the text each entry already
// shows. Numbers are offered in both the spaced and unspaced spellings, so
// "24px" and "24 px" both find a 24px value, and a bare "24" finds it too.

import type {
  ColorGroup,
  FontRecord,
  PageSummary,
  RadiusGroup,
  ShadowGroup,
  SizeScaleEntry,
  SpacingSummary,
  StackReport,
  TypographyGroup,
  ValueCount,
} from '@/lib/contracts';

function round(value: number, places = 2): string {
  return String(Number(value.toFixed(places)));
}

/** Both spellings of a number plus its unit, so either query form matches. */
function numberTokens(value: number, unit: string, places = 2): string[] {
  const text = round(value, places);
  return [text, `${text}${unit}`, `${text} ${unit}`];
}

export function typographyTokens(group: TypographyGroup, rootFontSize: number): string[] {
  const tokens = [
    group.familyReading,
    group.familyConfidence,
    String(group.weight),
    group.style,
    group.lineHeightRaw,
    group.letterSpacingRaw,
    ...numberTokens(group.sizePx, 'px'),
  ];
  if (rootFontSize > 0) tokens.push(...numberTokens(group.sizePx / rootFontSize, 'rem', 3));
  return tokens;
}

export function colorTokens(group: ColorGroup): string[] {
  return [
    group.color.hex ?? '',
    group.color.raw,
    group.role,
    group.inferredRole ?? '',
  ];
}

export function valueTokens(entry: ValueCount): string[] {
  return numberTokens(entry.valuePx, 'px');
}

export function sizeTokens(entry: SizeScaleEntry): string[] {
  return numberTokens(entry.sizePx, 'px');
}

export function fontTokens(font: FontRecord): string[] {
  return [font.family, font.source.kind, ...font.weights];
}

export function stackTokens(report: StackReport): string[] {
  return [
    ...report.detections.map((detection) => detection.name),
    ...report.hints.map((hint) => hint.name),
  ];
}

/** Every term in the query has to appear somewhere in the entry's own text. */
export function matchesQuery(tokens: string[], query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = tokens.join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export interface FilteredSummary {
  /** False when the query is empty, which shows everything. */
  active: boolean;
  typography: TypographyGroup[];
  sizeScale: SizeScaleEntry[];
  colors: ColorGroup[];
  spacing: SpacingSummary;
  radii: RadiusGroup[];
  shadows: ShadowGroup[];
  fonts: FontRecord[];
  stack: StackReport;
  /** Entries still shown, and how many there were before filtering. */
  shown: number;
  total: number;
}

function countSpacing(spacing: SpacingSummary): number {
  return spacing.padding.length + spacing.margin.length + spacing.gap.length;
}

export function filterSummary(summary: PageSummary, query: string): FilteredSummary {
  const rootFontSize = summary.source.rootFontSize;
  const total =
    summary.typography.length +
    summary.sizeScale.length +
    summary.colors.length +
    countSpacing(summary.spacing) +
    summary.radii.length +
    summary.shadows.length +
    summary.fonts.length +
    summary.stack.detections.length;

  const trimmed = query.trim();
  if (trimmed === '') {
    return {
      active: false,
      typography: summary.typography,
      sizeScale: summary.sizeScale,
      colors: summary.colors,
      spacing: summary.spacing,
      radii: summary.radii,
      shadows: summary.shadows,
      fonts: summary.fonts,
      stack: summary.stack,
      shown: total,
      total,
    };
  }

  const keep = (tokens: string[]): boolean => matchesQuery(tokens, trimmed);

  const typography = summary.typography.filter((group) =>
    keep(typographyTokens(group, rootFontSize)),
  );
  const sizeScale = summary.sizeScale.filter((entry) => keep(sizeTokens(entry)));
  const colors = summary.colors.filter((group) => keep(colorTokens(group)));
  const spacing: SpacingSummary = {
    padding: summary.spacing.padding.filter((entry) => keep(valueTokens(entry))),
    margin: summary.spacing.margin.filter((entry) => keep(valueTokens(entry))),
    gap: summary.spacing.gap.filter((entry) => keep(valueTokens(entry))),
  };
  const radii = summary.radii.filter((group) => keep([group.value]));
  const shadows = summary.shadows.filter((group) => keep([group.value]));
  const fonts = summary.fonts.filter((font) => keep(fontTokens(font)));
  const stack: StackReport = {
    ...summary.stack,
    detections: summary.stack.detections.filter((detection) => keep([detection.name])),
    hints: summary.stack.hints.filter((hint) => keep([hint.name])),
  };

  const shown =
    typography.length +
    sizeScale.length +
    colors.length +
    countSpacing(spacing) +
    radii.length +
    shadows.length +
    fonts.length +
    stack.detections.length;

  return {
    active: true,
    typography,
    sizeScale,
    colors,
    spacing,
    radii,
    shadows,
    fonts,
    stack,
    shown,
    total,
  };
}
