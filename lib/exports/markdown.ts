// Human-readable Markdown export (PRD EXP-03, EXP-04, and the example in
// PRD section 15).
//
// Two rules hold everywhere in this file: user notes stay visibly separate from
// measured data, and no em dash is ever written. An em dash inside a user note
// becomes a colon plus a space.
import type {
  ColorValue,
  ContrastReading,
  ElementSnapshot,
  FontConfidence,
  PageSummary,
  PaletteCluster,
  SavedReference,
  Sides,
  SourceContext,
} from '@/lib/contracts';
import { cmp, collapseWhitespace, escapeCell, isZeroLength, num, px, round2, scrubEmDashes } from './format';
import { sidesShorthand } from './css';
import { isViewportDependentLength } from '@/lib/readings/units';

const SCOPE_LINES = [
  'Values describe the captured element at this viewport and time.',
  'Responsive rules and other interaction states were not captured.',
];

const ROLE_ORDER = ['text', 'background', 'border', 'fill', 'stroke', 'gradient-stop'] as const;

export function referenceToMarkdown(reference: SavedReference): string {
  const blocks: string[] = [`# Reference: ${scrubEmDashes(reference.title)}`];

  // `kind` is the discriminant, so it narrows `snapshot` on its own: nothing
  // here has to re-derive the shape or cast it.
  let scope: string;
  if (reference.kind === 'element') {
    const snapshot = reference.snapshot;
    blocks.push(elementHeaderBullets(snapshot).join('\n'));
    blocks.push('## Observed styles');
    blocks.push(...elementStyleBlocks(snapshot));
    const assets = assetBullets(snapshot);
    if (assets.length > 0) {
      blocks.push('## Assets');
      blocks.push(assets.join('\n'));
    }
    scope = SCOPE_LINES.join('\n');
  } else {
    const snapshot = reference.snapshot;
    blocks.push(summaryHeaderBullets(snapshot).join('\n'));
    blocks.push('## Observed styles');
    blocks.push(...summaryBodyBlocks(snapshot));
    scope = summaryScopeBlock(snapshot);
  }

  blocks.push('## My observation');
  blocks.push(noteBlock(reference.note));
  blocks.push('## Scope');
  blocks.push(scope);

  return `${blocks.join('\n\n')}\n`;
}

export function summaryToMarkdown(summary: PageSummary): string {
  const blocks: string[] = [
    `# Page summary: ${scrubEmDashes(summary.source.title)}`,
    summaryHeaderBullets(summary).join('\n'),
    ...summaryBodyBlocks(summary),
    '## Scope',
    summaryScopeBlock(summary),
  ];
  return `${blocks.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// Element references

function elementHeaderBullets(snapshot: ElementSnapshot): string[] {
  const bullets = sourceBullets(snapshot.source);
  bullets.push(`- Element: ${scrubEmDashes(snapshot.element.label)}`);
  const typography = snapshot.typography;
  if (typography) {
    bullets.push(
      `- Font reading: ${typography.familyReading} (${fontConfidenceLabel(typography.familyConfidence)})`,
    );
  }
  return bullets;
}

function elementStyleBlocks(snapshot: ElementSnapshot): string[] {
  const blocks: string[] = [];

  const typography = typographyBullets(snapshot);
  blocks.push('### Typography');
  blocks.push(typography.length > 0 ? typography.join('\n') : 'This element renders no text.');

  blocks.push('### Surfaces');
  blocks.push(surfaceBullets(snapshot).join('\n'));

  blocks.push('### Layout');
  blocks.push(layoutBullets(snapshot).join('\n'));

  return blocks;
}

function typographyBullets(snapshot: ElementSnapshot): string[] {
  const typography = snapshot.typography;
  if (!typography) return [];
  const bullets: string[] = [];

  bullets.push(`- Font stack: ${typography.familyStack.join(', ')}`);
  bullets.push(
    snapshot.source.rootFontSizeFluid
      ? `- Size: ${sizeText(typography.sizePx, typography.sizeRem, snapshot.source)}`
      : `- Size: ${px(typography.sizePx)}; equivalent ${num(typography.sizeRem)}rem at a ${num(snapshot.source.rootFontSize)}px root`,
  );
  bullets.push(`- Weight: ${typography.weight}`);
  if (typography.style !== 'normal') bullets.push(`- Style: ${typography.style}`);
  bullets.push(
    typography.lineHeightPx === null
      ? `- Line height: ${typography.lineHeightRaw}; ratio unavailable`
      : `- Line height: ${px(typography.lineHeightPx)}; ratio ${typography.lineHeightRatio === null ? 'unavailable' : num(typography.lineHeightRatio)}`,
  );
  bullets.push(
    `- Letter spacing: ${px(typography.letterSpacingPx)}; equivalent ${typography.letterSpacingEm === null ? 'unavailable' : `${num(typography.letterSpacingEm)}em`}`,
  );
  if (usable(typography.textTransform)) {
    bullets.push(`- Text transform: ${typography.textTransform}`);
  }
  if (usable(typography.textDecoration)) {
    bullets.push(`- Text decoration: ${collapseWhitespace(typography.textDecoration)}`);
  }
  if (typography.fontVariant !== 'normal' && typography.fontVariant !== 'none') {
    bullets.push(`- Font variant: ${typography.fontVariant}`);
  }
  if (typography.variationSettings !== null) {
    bullets.push(`- Variation settings: ${typography.variationSettings}`);
  }
  bullets.push(`- Text color: ${colorLabel(typography.color)}`);
  bullets.push(`- Contrast: ${contrastLabel(typography.contrast)}`);
  bullets.push(
    `- Font source: ${typography.source.kind}${typography.source.url ? ` (${typography.source.url})` : ''}`,
  );

  return bullets;
}

function surfaceBullets(snapshot: ElementSnapshot): string[] {
  const surfaces = snapshot.surfaces;
  const bullets: string[] = [];

  bullets.push(
    surfaces.backgroundColor.alpha === 0
      ? '- Background color: transparent'
      : `- Background color: ${colorLabel(surfaces.backgroundColor)}`,
  );
  if (surfaces.backgroundLayers.length > 0) {
    bullets.push(
      `- Background layers: ${surfaces.backgroundLayers.map((layer) => collapseWhitespace(layer)).join(' | ')}`,
    );
  }

  const borders = visibleSides(surfaces.borderWidth, surfaces.borderStyle);
  if (borders.length === 0) bullets.push('- Border: none visible');
  else {
    for (const side of borders) {
      bullets.push(
        `- Border ${side}: ${px(surfaces.borderWidth[side])} ${surfaces.borderStyle[side]} ${colorLabel(surfaces.borderColor[side])}`,
      );
    }
  }

  const radius = surfaces.radius;
  const cornerValues = [
    radius.topLeft,
    radius.topRight,
    radius.bottomRight,
    radius.bottomLeft,
  ].map((corner) => collapseWhitespace(corner));
  const firstCorner = cornerValues[0] ?? '0px';
  bullets.push(
    `- Radius: ${cornerValues.every((corner) => corner === firstCorner) ? firstCorner : cornerValues.join(' ')}`,
  );

  const shadows = surfaces.boxShadow.map((entry) => collapseWhitespace(entry)).filter(usable);
  bullets.push(shadows.length > 0 ? `- Shadows: ${shadows.join(' | ')}` : '- Shadows: none');
  const textShadows = surfaces.textShadow.map((entry) => collapseWhitespace(entry)).filter(usable);
  if (textShadows.length > 0) bullets.push(`- Text shadows: ${textShadows.join(' | ')}`);

  if (surfaces.opacity !== 1) bullets.push(`- Opacity: ${num(surfaces.opacity)}`);
  if (usable(surfaces.filter)) bullets.push(`- Filter: ${collapseWhitespace(surfaces.filter)}`);
  if (usable(surfaces.backdropFilter)) {
    bullets.push(`- Backdrop filter: ${collapseWhitespace(surfaces.backdropFilter)}`);
  }
  if (surfaces.fill) bullets.push(`- Fill: ${colorLabel(surfaces.fill)}`);
  if (surfaces.stroke) bullets.push(`- Stroke: ${colorLabel(surfaces.stroke)}`);

  return bullets;
}

function layoutBullets(snapshot: ElementSnapshot): string[] {
  const layout = snapshot.layout;
  const bullets: string[] = [];

  bullets.push(`- Display: ${layout.display}`);
  bullets.push(`- Box sizing: ${layout.boxSizing}`);
  bullets.push(
    `- Layout size: ${num(layout.layoutSize.width)} x ${num(layout.layoutSize.height)} px${layout.transformed ? ' (a transform is applied, so the visual rect differs)' : ''}`,
  );
  bullets.push(`- Padding: ${sidesShorthand(layout.padding)}`);
  bullets.push(`- Margin: ${sidesShorthand(layout.margin)}`);
  // A zero minimum is the browser default, so it is not worth a line.
  if (usable(layout.minWidth) && !isZeroLength(layout.minWidth)) {
    bullets.push(`- Min width: ${layout.minWidth}`);
  }
  if (usable(layout.maxWidth)) bullets.push(`- Max width: ${layout.maxWidth}`);
  if (usable(layout.minHeight) && !isZeroLength(layout.minHeight)) {
    bullets.push(`- Min height: ${layout.minHeight}`);
  }
  if (usable(layout.maxHeight)) bullets.push(`- Max height: ${layout.maxHeight}`);

  const flex = layout.flex;
  if (flex) {
    bullets.push(
      `- Flex: ${flex.direction}, wrap ${flex.wrap}, justify ${flex.justifyContent}, items ${flex.alignItems}, content ${flex.alignContent}`,
    );
    bullets.push(`- Gap: row ${px(flex.rowGap)}, column ${px(flex.columnGap)}`);
  }
  const grid = layout.grid;
  if (grid) {
    bullets.push(`- Grid columns: ${grid.templateColumns}`);
    bullets.push(`- Grid rows: ${grid.templateRows}`);
    bullets.push(`- Grid auto flow: ${grid.autoFlow}`);
    bullets.push(`- Gap: row ${px(grid.rowGap)}, column ${px(grid.columnGap)}`);
    if (grid.itemPlacement) {
      bullets.push(
        `- Grid placement: column ${grid.itemPlacement.column}, row ${grid.itemPlacement.row}`,
      );
    }
  }

  if (layout.position !== 'static') {
    bullets.push(`- Position: ${layout.position}`);
    const insets = (['top', 'right', 'bottom', 'left'] as const)
      .filter((side) => layout.inset[side] !== 'auto' && usable(layout.inset[side]))
      .map((side) => `${side} ${layout.inset[side]}`);
    if (insets.length > 0) bullets.push(`- Insets: ${insets.join(', ')}`);
  }
  if (layout.zIndex !== 'auto' && usable(layout.zIndex)) {
    bullets.push(`- Z-index: ${layout.zIndex}`);
  }

  for (const [property, expression] of Object.entries(layout.sourceExpressions).sort()) {
    bullets.push(`- Authored ${property}: ${expression}`);
  }

  return bullets;
}

function assetBullets(snapshot: ElementSnapshot): string[] {
  return snapshot.assets.map((asset) => {
    const size =
      asset.intrinsicWidth !== null && asset.intrinsicHeight !== null
        ? `${num(asset.intrinsicWidth)} x ${num(asset.intrinsicHeight)} intrinsic`
        : 'intrinsic size unknown';
    const rendered = `${num(asset.renderedWidth)} x ${num(asset.renderedHeight)} rendered`;
    return `- ${asset.kind}: ${asset.url ?? 'inline'} (${rendered}, ${size})`;
  });
}

// ---------------------------------------------------------------------------
// Page summaries

function summaryHeaderBullets(summary: PageSummary): string[] {
  const bullets = sourceBullets(summary.source);
  const scope = summary.scope;
  bullets.push(
    `- Scan scope: ${scope.scannedElements} of ${scope.eligibleElements} eligible elements (cap ${scope.cap}, capped: ${scope.capped ? 'yes' : 'no'})`,
  );
  return bullets;
}

function summaryBodyBlocks(summary: PageSummary): string[] {
  const clusters = summary.paletteClusters ?? [];
  return [
    '## Type scale',
    typeScaleTable(summary),
    '## Typography combinations',
    typographyTable(summary),
    // A summary recorded before clusters existed has none, and inventing them
    // here would be a second opinion rather than the one the scan formed.
    ...(clusters.length > 0 ? ['## Palette clusters', paletteClusterTable(clusters)] : []),
    '## Palette',
    paletteTable(summary),
    '## Spacing',
    spacingLists(summary),
    '## Radii and shadows',
    radiiAndShadows(summary),
    '## Fonts',
    fontsTable(summary),
    '## Stack',
    stackTable(summary),
  ];
}

function typeScaleTable(summary: PageSummary): string {
  if (summary.sizeScale.length === 0) return 'No text-bearing elements were scanned.';
  const rows = summary.sizeScale.map((entry) => {
    const combinations = summary.typography.filter(
      (group) => round2(group.sizePx) === entry.sizePx,
    );
    const families = uniqueStrings(
      combinations.map((group) => `${group.familyReading} ${group.weight}`),
    );
    return `| ${num(entry.sizePx)} | ${num(entry.sizePx / summary.source.rootFontSize)} | ${escapeCell(families.join(', ') || 'unknown')} | ${entry.count} |`;
  });
  return [
    '| Size px | rem | Families and weights | Count |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function typographyTable(summary: PageSummary): string {
  if (summary.typography.length === 0) return 'No typography combinations were recorded.';
  const rows = summary.typography.map(
    (group) =>
      `| ${escapeCell(group.familyReading)} (${fontConfidenceLabel(group.familyConfidence)}) | ${group.weight} | ${group.style} | ${num(group.sizePx)} | ${escapeCell(group.lineHeightRaw)} | ${escapeCell(group.letterSpacingRaw)} | ${group.count} | ${escapeCell(group.sample)} |`,
  );
  return [
    '| Family | Weight | Style | Size px | Line height | Letter spacing | Count | Sample |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/**
 * Near-identical palette entries merged into one swatch each (SUM-03). The flat
 * table below still carries every measured row: this one only says which of
 * them read as the same colour, in the order the clusters were ranked.
 */
function paletteClusterTable(clusters: PaletteCluster[]): string {
  const rows = clusters.map((cluster) => {
    const color = cluster.representative.color;
    const label = cluster.inferredRole ? `${cluster.inferredRole} (inferred)` : '';
    return `| ${escapeCell(color.hex ?? color.raw)} | ${cluster.roles.join(', ')} | ${cluster.totalCount} | ${label} |`;
  });
  return [
    '| Value | Roles | Total count | Label |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function paletteTable(summary: PageSummary): string {
  if (summary.colors.length === 0) return 'No colors were recorded.';
  const ordered = [...summary.colors].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      b.count - a.count ||
      cmp(a.key, b.key),
  );
  const rows = ordered.map(
    (group) =>
      `| ${group.role} | ${escapeCell(group.color.hex ?? group.color.raw)} | ${num(group.color.alpha)} | ${group.count} | ${group.inferredRole ? `${group.inferredRole} (inferred)` : ''} |`,
  );
  return ['| Role | Value | Alpha | Count | Label |', '| --- | --- | --- | --- | --- |', ...rows].join(
    '\n',
  );
}

function spacingLists(summary: PageSummary): string {
  const list = (values: { valuePx: number; count: number }[]): string =>
    values.length === 0
      ? 'none recorded'
      : values.map((entry) => `${num(entry.valuePx)}px (${entry.count})`).join(', ');
  return [
    `- Padding: ${list(summary.spacing.padding)}`,
    `- Margin: ${list(summary.spacing.margin)}`,
    `- Gap: ${list(summary.spacing.gap)}`,
  ].join('\n');
}

function radiiAndShadows(summary: PageSummary): string {
  const radii =
    summary.radii.length === 0
      ? 'none recorded'
      : summary.radii.map((group) => `${group.value} (${group.count})`).join(', ');
  const shadows =
    summary.shadows.length === 0
      ? 'none recorded'
      : summary.shadows.map((group) => `${group.value} (${group.count})`).join(' | ');
  return [`- Radii: ${radii}`, `- Shadows: ${shadows}`].join('\n');
}

function fontsTable(summary: PageSummary): string {
  if (summary.fonts.length === 0) return 'No font records were collected.';
  const rows = summary.fonts.map(
    (font) =>
      `| ${escapeCell(font.family)} | ${font.declared ? 'yes' : 'no'} | ${font.loaded === null ? 'unknown' : font.loaded ? 'yes' : 'no'} | ${font.matchedToContent ? 'yes' : 'no'} | ${font.source.kind} | ${escapeCell(font.weights.join(', ') || 'unknown')} |`,
  );
  return [
    '| Family | Declared | Loaded | Matched | Source | Weights |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function stackTable(summary: PageSummary): string {
  const detections = summary.stack.detections;
  if (detections.length === 0) return 'No technologies were detected with sufficient evidence.';
  const rows = detections.map((detection) => {
    const first = detection.evidence[0];
    const evidence = first ? `${first.kind}: ${first.detail}` : 'none recorded';
    const name = detection.version ? `${detection.name} ${detection.version}` : detection.name;
    return `| ${escapeCell(name)} | ${detection.category} | ${detection.confidence} | ${escapeCell(evidence)} |`;
  });
  return [
    '| Technology | Category | Confidence | Evidence |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function summaryScopeBlock(summary: PageSummary): string {
  const scope = summary.scope;
  const lines: string[] = [
    `- Scanned ${scope.scannedElements} of ${scope.eligibleElements} eligible elements in ${num(scope.durationMs)} ms (cap ${scope.cap}, capped: ${scope.capped ? 'yes' : 'no'}).`,
    `- Inaccessible frames: ${scope.inaccessibleFrames}. Open shadow roots: ${scope.openShadowRoots}.`,
  ];
  for (const skipped of scope.skipped) {
    lines.push(`- Skipped ${skipped.count}: ${scrubEmDashes(skipped.reason)}.`);
  }
  for (const note of scope.notes) lines.push(`- ${scrubEmDashes(note)}`);
  for (const limitation of summary.limitations) lines.push(`- ${scrubEmDashes(limitation)}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Shared pieces

function sourceBullets(source: SourceContext): string[] {
  return [
    `- Source: ${source.url}`,
    `- Captured: ${source.capturedAt}`,
    `- Viewport: ${num(source.viewport.width)} x ${num(source.viewport.height)} CSS px`,
    `- Root font size: ${rootFontSizeText(source)}`,
  ];
}

/**
 * The root font size, and whether it moves. A fluid root is stated once here,
 * because it is the reason every px size in the document is written as a
 * reading at one viewport width (workstream V1).
 */
function rootFontSizeText(source: SourceContext): string {
  if (!source.rootFontSizeFluid) return px(source.rootFontSize);
  const authored = (source.rootFontSizeAuthored ?? '').trim();
  // Only a value that moves is named as the cause.
  const from = isViewportDependentLength(authored) ? `, from ${authored}` : '';
  return (
    `${px(source.rootFontSize)} (fluid${from}). It scales with the viewport, ` +
    'so px sizes below are readings at this width and rem is the stable value.'
  );
}

/** "1.125rem (16.12px at 1440 wide)" on a fluid root, "16.12px" otherwise. */
function sizeText(sizePx: number, sizeRem: number, source: SourceContext): string {
  if (!source.rootFontSizeFluid || !Number.isFinite(sizeRem) || sizeRem <= 0) {
    return px(sizePx);
  }
  return `${num(sizeRem)}rem (${px(sizePx)} at ${num(source.viewport.width)} wide)`;
}

function noteBlock(note: string): string {
  const scrubbed = scrubEmDashes(note).trim();
  return scrubbed === '' ? 'No note recorded.' : scrubbed;
}

function fontConfidenceLabel(confidence: FontConfidence): string {
  switch (confidence) {
    case 'verified':
      return 'verified';
    case 'matched':
      return 'matched, not verified';
    case 'declared':
      return 'declared, not matched';
  }
}

function contrastLabel(contrast: ContrastReading): string {
  if (contrast.ratio === null) {
    return `unavailable${contrast.reason ? ` (${scrubEmDashes(contrast.reason)})` : ''}`;
  }
  return `${num(contrast.ratio)}:1 (${contrast.status})`;
}

function colorLabel(color: ColorValue): string {
  const base = color.hex ?? color.raw;
  const alpha = color.alpha < 1 ? `, alpha ${num(color.alpha)}` : '';
  const lossy = color.lossy ? ', sRGB approximation' : '';
  return `${base}${alpha}${lossy}`;
}

function visibleSides(
  widths: Sides<number>,
  styles: Sides<string>,
): (keyof Sides<number>)[] {
  return (['top', 'right', 'bottom', 'left'] as const).filter(
    (side) => widths[side] > 0 && usable(styles[side]) && styles[side] !== 'hidden',
  );
}

export function isElementSnapshot(
  snapshot: ElementSnapshot | PageSummary,
): snapshot is ElementSnapshot {
  return 'element' in snapshot;
}

function usable(value: string): boolean {
  const trimmed = collapseWhitespace(value);
  return trimmed !== '' && trimmed.toLowerCase() !== 'none';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
