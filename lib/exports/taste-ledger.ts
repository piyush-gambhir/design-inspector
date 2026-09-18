// Taste-ledger preset (PRD EXP-03). The exact fragment shape is specified in
// docs/TASTE_LEDGER_EXPORT.md and validated against the destination ledger.
//
// The contract this preset keeps: Essence holds only what the user wrote, every
// measured value lives under Observed, no em dash is ever emitted, and the
// output is a fragment that starts at its own `##` heading so it can be
// appended to the ledger.
import type {
  ElementSnapshot,
  PageSummary,
  SavedReference,
  SourceContext,
} from '@/lib/contracts';
import { num, px, scrubEmDashes } from './format';
import { isViewportDependentLength } from '@/lib/readings/units';

/** Spacing values listed as the page's rhythm. */
const MAX_RHYTHM_VALUES = 6;

/** Family and weight pairs named next to the type scale. */
const MAX_FAMILIES = 4;

export function toTasteLedger(references: SavedReference[], dateIso: string): string {
  const groups = new Map<string, SavedReference[]>();
  for (const reference of references) {
    const url = reference.snapshot.source.url;
    const existing = groups.get(url);
    if (existing) existing.push(reference);
    else groups.set(url, [reference]);
  }

  const date = dateIso.slice(0, 10);
  return [...groups.entries()].map(([url, group]) => entryFor(url, group, date)).join('\n\n');
}

function entryFor(url: string, references: SavedReference[], date: string): string {
  const first = references[0];
  if (!first) return '';
  const source = first.snapshot.source;
  const viewport = `${num(source.viewport.width)} x ${num(source.viewport.height)}`;

  // `kind` narrows the snapshot inside the branch, so neither list needs a cast
  // or a shape test to end up correctly typed.
  const summaries: PageSummary[] = [];
  const elements: ElementSnapshot[] = [];
  for (const reference of references) {
    if (reference.kind === 'summary') summaries.push(reference.snapshot);
    else elements.push(reference.snapshot);
  }

  const blocks: string[] = [
    `## ${date}: reference study, ${hostnameOf(url)}`,
    `Studied ${url} on ${date} at ${viewport}. Notes are mine; measurements are computed values at that viewport and time, not authored tokens.`,
    '### Essence (mine)',
    references.map((reference) => essenceLine(reference)).join('\n'),
    '### Observed (computed, this viewport)',
    observedBlock(summaries, elements),
    '### Avoid',
    '- ',
    '### Scope',
    scopeBlock(viewport, source, summaries),
  ];

  return blocks.join('\n\n');
}

/** Only the user's own words: the title and the note, nothing measured. */
function essenceLine(reference: SavedReference): string {
  const title = scrubEmDashes(reference.title).trim();
  const note = scrubEmDashes(reference.note).trim();
  if (note === '') return `- ${title}: no note recorded.`;
  return `- ${title}: ${/[.!?]$/.test(note) ? note : `${note}.`}`;
}

function observedBlock(summaries: PageSummary[], elements: ElementSnapshot[]): string {
  const lines: string[] = [];

  for (const summary of summaries) {
    const scale = summary.sizeScale.map((entry) => num(entry.sizePx));
    if (scale.length > 0) {
      lines.push(`- Type scale: ${scale.join(' / ')} px${familiesSuffix(summary)}.`);
    }
    const palette = paletteLine(summary);
    if (palette !== null) lines.push(palette);
    const rhythm = rhythmLine(summary);
    if (rhythm !== null) lines.push(rhythm);
    lines.push(radiiAndShadowsLine(summary));
    const stack = stackLine(summary);
    if (stack !== null) lines.push(stack);
  }

  for (const snapshot of elements) lines.push(elementLine(snapshot));

  return lines.length > 0 ? lines.join('\n') : '- No measurements were captured.';
}

function familiesSuffix(summary: PageSummary): string {
  const families = [
    ...new Set(
      summary.typography.map(
        (group) => `${group.familyReading} (${group.familyConfidence}) ${group.weight}`,
      ),
    ),
  ].slice(0, MAX_FAMILIES);
  return families.length > 0 ? ` (${families.join(', ')})` : '';
}

/**
 * What the page's colour language reads as: how many swatches it really has
 * once near-identical values merge, which of them are inferred accents, and how
 * many are neutral. A summary recorded before clusters existed keeps the older
 * role counts rather than having clusters invented for it here.
 */
function paletteLine(summary: PageSummary): string | null {
  const clusters = summary.paletteClusters;
  if (clusters && clusters.length > 0) {
    const accents = clusters
      .filter((cluster) => cluster.inferredRole === 'accent')
      .map((cluster) => cluster.representative.color.hex ?? cluster.representative.color.raw);
    const neutrals = clusters.filter((cluster) => cluster.inferredRole === 'neutral').length;
    const count = clusters.length === 1 ? '1 cluster' : `${clusters.length} clusters`;
    return `- Palette: ${count} (accent: ${accents.length > 0 ? accents.join(', ') : 'none'}; neutrals: ${neutrals}).`;
  }
  return paletteByRoleLine(summary);
}

function paletteByRoleLine(summary: PageSummary): string | null {
  if (summary.colors.length === 0) return null;
  const counts = new Map<string, number>();
  for (const group of summary.colors) {
    counts.set(group.role, (counts.get(group.role) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([role, count], index) =>
    index === 0 ? `${role} ${count} colors` : `${role} ${count}`,
  );
  const accents = summary.colors.filter((group) => group.inferredRole === 'accent').length;
  if (accents > 0) parts.push(`accent (inferred) ${accents}`);
  return `- Palette by role: ${parts.join(', ')}.`;
}

function rhythmLine(summary: PageSummary): string | null {
  const positive = new Map<number, number>();
  for (const bucket of [summary.spacing.padding, summary.spacing.margin, summary.spacing.gap]) {
    for (const entry of bucket) {
      if (entry.valuePx <= 0) continue;
      positive.set(entry.valuePx, (positive.get(entry.valuePx) ?? 0) + entry.count);
    }
  }
  if (positive.size === 0) return null;
  const values = [...positive.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, MAX_RHYTHM_VALUES)
    .map(([value]) => value)
    .sort((a, b) => a - b)
    .map((value) => num(value));
  return `- Spacing rhythm: ${values.join(', ')} px recur.`;
}

function radiiAndShadowsLine(summary: PageSummary): string {
  const radii =
    summary.radii.length > 0
      ? summary.radii.map((group) => group.value).join(', ')
      : 'none recorded';
  const shadows =
    summary.shadows.length === 1 ? '1 combination' : `${summary.shadows.length} combinations`;
  return `- Radii: ${radii}. Shadows: ${shadows}.`;
}

/** Only detections are named. "Not detected" is never written. */
function stackLine(summary: PageSummary): string | null {
  const detections = summary.stack.detections;
  if (detections.length === 0) return null;
  const parts = detections.map(
    (detection) =>
      `${detection.name}${detection.version ? ` ${detection.version}` : ''} (${detection.confidence})`,
  );
  return `- Stack: ${parts.join(', ')}.`;
}

/** The root font size, and whether it moves with the viewport (workstream V1). */
function rootText(source: SourceContext): string {
  if (!source.rootFontSizeFluid) return px(source.rootFontSize);
  const authored = (source.rootFontSizeAuthored ?? '').trim();
  const from = isViewportDependentLength(authored) ? `, from ${authored}` : '';
  return `${px(source.rootFontSize)} (fluid${from}, so px sizes are readings at this width)`;
}

/** "1.125rem (18px at 1440 wide)" on a fluid root, "18px / 1.125rem" otherwise. */
function sizeText(sizePx: number, sizeRem: number, source: SourceContext): string {
  if (!source.rootFontSizeFluid || !Number.isFinite(sizeRem) || sizeRem <= 0) {
    return `${px(sizePx)} / ${num(sizeRem)}rem`;
  }
  return `${num(sizeRem)}rem (${px(sizePx)} at ${num(source.viewport.width)} wide)`;
}

function elementLine(snapshot: ElementSnapshot): string {
  const label = scrubEmDashes(snapshot.element.label);
  const typography = snapshot.typography;
  if (!typography) {
    const background = snapshot.surfaces.backgroundColor;
    return `- ${label}: no text reading, background ${background.hex ?? background.raw}.`;
  }

  const parts = [
    `${typography.familyReading} (${typography.familyConfidence}) ${sizeText(typography.sizePx, typography.sizeRem, snapshot.source)}`,
    String(typography.weight),
    `lh ${typography.lineHeightRatio === null ? typography.lineHeightRaw : num(typography.lineHeightRatio)}`,
    `tracking ${typography.letterSpacingEm === null ? px(typography.letterSpacingPx) : `${num(typography.letterSpacingEm)}em`}`,
    typography.color.hex ?? typography.color.raw,
  ];
  return `- ${label}: ${parts.join(', ')}.`;
}

function scopeBlock(viewport: string, source: SourceContext, summaries: PageSummary[]): string {
  const sentences = [
    `Captured at ${viewport}, root ${rootText(source)}.`,
    'Responsive rules and interaction states were not captured.',
  ];
  for (const summary of summaries) {
    sentences.push(
      `Summary covered ${summary.scope.scannedElements} of ${summary.scope.eligibleElements} eligible elements (capped: ${summary.scope.capped ? 'yes' : 'no'}).`,
    );
  }
  return sentences.join(' ');
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
