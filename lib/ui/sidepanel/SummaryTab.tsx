// Page design summary (PRD 12).
//
// Section order matches the PRD. Every group is traceable back to the page,
// every uncertain reading carries its evidence, and nothing here is presented
// as the site's own token system.
import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Save, ScanLine } from 'lucide-react';
import type {
  FontRecord,
  PageSummary,
  SavedReference,
  TypographyGroup,
  ValueCount,
} from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';
import { sendToBackground } from '@/lib/messages';
import { groupTypographyByScale } from '@/lib/readings/summary-aggregate';
import { summaryToMarkdown, toJsonEnvelope } from '@/lib/exports';
import { Button, Input, Progress } from '@/components/ui';
import {
  Collapsible,
  ConfidenceBadge,
  EmptyState,
  Field,
  GroupHeading,
  Section,
  StatusLine,
  WindowedList,
} from '@/lib/ui/shared/components';
import {
  formatCapturedAt,
  formatLineHeightLabel,
  formatRootFontSize,
  formatSizeLabel,
  formatTrackingLabel,
  formatViewport,
} from '@/lib/ui/shared/format';
import { ExampleControls } from './ExampleControls';
import { PaletteView } from './PaletteView';
import { StackReportView } from './StackReportView';
import {
  copyText,
  exportDateStamp,
  extensionVersion,
  jsonDataUrl,
  runExport,
} from './exports';
import { filterSummary } from './summary-filter';

const SAMPLE_DISPLAY_CAP_PX = 28;
/** Long enough to stop filtering on every keystroke, short enough to feel live. */
const FILTER_DEBOUNCE_MS = 100;

/**
 * Ids for the summary's regions, so the "Jump to" row can reach them. A real
 * page's palette is hundreds of swatches, and tabbing through all of them to
 * reach Spacing is not navigation (tester UX note 3).
 */
export const SECTION_IDS = {
  typeScale: 'summary-type-scale',
  typography: 'summary-typography',
  palette: 'summary-palette',
  spacing: 'summary-spacing',
  radii: 'summary-radii',
  shadows: 'summary-shadows',
  fonts: 'summary-fonts',
  stack: 'summary-stack',
} as const;

const JUMP_TARGETS: { id: string; label: string }[] = [
  { id: SECTION_IDS.typeScale, label: 'Type scale' },
  { id: SECTION_IDS.typography, label: 'Typography' },
  { id: SECTION_IDS.palette, label: 'Palette' },
  { id: SECTION_IDS.spacing, label: 'Spacing' },
  { id: SECTION_IDS.radii, label: 'Radii' },
  { id: SECTION_IDS.shadows, label: 'Shadows' },
  { id: SECTION_IDS.fonts, label: 'Fonts' },
  { id: SECTION_IDS.stack, label: 'Stack' },
];

/**
 * Skip links for the summary. The href is what makes them links; the click
 * handler is what makes them work, because the side panel has no address bar
 * to hang a fragment on and focus has to land on the region itself.
 */
function JumpTo() {
  return (
    <nav aria-label="Jump to a summary section" className="flex flex-wrap items-center gap-1">
      <span className="text-[12px] text-muted-foreground">Jump to</span>
      {JUMP_TARGETS.map(target => (
        <a
          key={target.id}
          href={`#${target.id}`}
          data-role="jump-link"
          onClick={event => {
            const section = document.getElementById(target.id);
            if (!section) return;
            event.preventDefault();
            section.scrollIntoView({ block: 'start' });
            section.focus();
          }}
          className="inline-flex h-7 items-center rounded-full bg-surface-2 px-2.5 text-[12px] text-muted-foreground no-underline hover:text-foreground"
        >
          {target.label}
        </a>
      ))}
    </nav>
  );
}

const FONT_SOURCE_LABELS: Record<FontRecord['source']['kind'], string> = {
  google: 'Google Fonts',
  adobe: 'Adobe Fonts',
  fontshare: 'Fontshare',
  'self-hosted': 'Self-hosted',
  system: 'System',
  unknown: 'Unknown source',
};

function round(value: number, places = 2): string {
  return String(Number(value.toFixed(places)));
}

// ---------------------------------------------------------------------------

function ScopeSection({ summary }: { summary: PageSummary }) {
  const { scope, source } = summary;
  return (
    <Section title="Scope" subtitle="What this reading covers, and what it does not.">
      <div className="grid gap-0.5">
        <Field label="Viewport">{formatViewport(source.viewport)}</Field>
        <Field label="Root font size">{formatRootFontSize(source)}</Field>
        <Field label="Elements">
          {scope.scannedElements} scanned of {scope.eligibleElements} eligible
        </Field>
        <Field label="Cap">
          {scope.capped ? `Reached the ${scope.cap} element cap` : `${scope.cap}, not reached`}
        </Field>
        {/* A capped scan is a partial summary, and the only way to widen it is
            the scan cap in the toolbar popup, so the reading says so (19.3). */}
        {scope.capped ? (
          <StatusLine tone="error">
            Partial summary: the scan stopped at {scope.cap} elements. Raise the scan cap in the
            toolbar popup and refresh, or read this as a sample of the page.
          </StatusLine>
        ) : null}
        <Field label="Duration">{Math.round(scope.durationMs)} ms</Field>
        <Field label="Captured">{formatCapturedAt(source.capturedAt)}</Field>
        {scope.inaccessibleFrames > 0 ? (
          <Field label="Inaccessible frames">{scope.inaccessibleFrames}</Field>
        ) : null}
        {scope.openShadowRoots > 0 ? (
          <Field label="Open shadow roots">{scope.openShadowRoots}</Field>
        ) : null}
      </div>
      {scope.skipped.length > 0 ? (
        <Collapsible summary={`Skipped (${scope.skipped.length} reasons)`}>
          <ul className="grid gap-0.5">
            {scope.skipped.map(entry => (
              <li key={entry.reason} className="text-[12px]">
                <span className="tabular-nums">{entry.count}</span>{' '}
                <span className="text-muted-foreground">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      ) : null}
      {scope.notes.length > 0 || summary.limitations.length > 0 ? (
        <Collapsible summary="Coverage notes and limitations">
          <ul className="grid gap-1">
            {[...scope.notes, ...summary.limitations].map((note, index) => (
              <li key={`${index}-${note}`} className="text-[12px] text-muted-foreground">
                {note}
              </li>
            ))}
          </ul>
        </Collapsible>
      ) : null}
    </Section>
  );
}

/** The one-line stand-in for a section the filter emptied. */
function NoMatches({ section }: { section: string }) {
  return <StatusLine>No matches in {section}</StatusLine>;
}

function TypeScaleSection({ summary, filtering }: { summary: PageSummary; filtering: boolean }) {
  if (summary.sizeScale.length === 0) {
    if (!filtering) return null;
    return (
      <Section id={SECTION_IDS.typeScale} title="Type scale">
        <NoMatches section="Type scale" />
      </Section>
    );
  }
  const { rootFontSize, rootFontSizeFluid } = summary.source;
  return (
    <Section
      id={SECTION_IDS.typeScale}
      title="Type scale"
      count={summary.sizeScale.length}
      subtitle={
        rootFontSizeFluid
          ? 'Distinct text sizes, by usage count. The root font size scales with the viewport, so rem is the stable reading and px is this width only.'
          : 'Distinct text sizes, by usage count.'
      }
    >
      <ul className="flex flex-wrap gap-1.5">
        {summary.sizeScale.map(entry => (
          <li
            key={entry.sizePx}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-[12px] tabular-nums"
          >
            {formatSizeLabel(entry.sizePx, rootFontSize, rootFontSizeFluid)}
            <span className="ml-1 text-muted-foreground">x{entry.count}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function TypographyCombination({
  group,
  rootFontSize,
  rootFontSizeFluid,
  tabId,
}: {
  group: TypographyGroup;
  rootFontSize: number;
  rootFontSizeFluid: boolean | undefined;
  tabId: number | null;
}) {
  return (
    <li className="group/row rounded-[8px] bg-surface-2 p-2">
      <span
        className="type-sample"
        style={{
          fontFamily: group.familyReading,
          fontWeight: group.weight,
          fontStyle: group.style,
          fontSize: `${Math.min(group.sizePx, SAMPLE_DISPLAY_CAP_PX)}px`,
          lineHeight: 1.2,
        }}
      >
        {group.sample || 'Sample text'}
      </span>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="truncate text-[12px] font-medium">{group.familyReading}</span>
        <ConfidenceBadge confidence={group.familyConfidence} />
        <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
          x{group.count}
        </span>
      </div>
      <div className="mt-1 grid gap-0.5">
        <Field label="Size">
          {formatSizeLabel(group.sizePx, rootFontSize, rootFontSizeFluid)}
        </Field>
        <Field label="Weight">
          {group.weight}
          {group.style !== 'normal' ? `, ${group.style}` : ''}
        </Field>
        <Field label="Line height">
          {formatLineHeightLabel(group.lineHeightRaw, group.sizePx, rootFontSizeFluid)}
        </Field>
        <Field label="Tracking">
          {formatTrackingLabel(group.letterSpacingRaw, group.sizePx, rootFontSizeFluid)}
        </Field>
      </div>
      <ExampleControls examples={group.examples} tabId={tabId} reveal />
    </li>
  );
}

function TypographySection({
  summary,
  tabId,
  filtering,
}: {
  summary: PageSummary;
  tabId: number | null;
  filtering: boolean;
}) {
  // Folding the combinations under their size turns dozens of rows into the
  // handful of steps the page's type scale actually has (PRD SUM-06).
  // Grouping is O(n log n) over every measured combination; it depends on the
  // summary alone, so it is computed once per summary rather than per render.
  // It sits above the early return because a hook has to run every time.
  const steps = useMemo(
    () => groupTypographyByScale(summary.typography),
    [summary.typography],
  );

  if (summary.typography.length === 0) {
    return (
      <Section id={SECTION_IDS.typography} title="Typography combinations">
        {filtering ? (
          <NoMatches section="Typography combinations" />
        ) : (
          <StatusLine>No text-bearing elements were recorded in this scan.</StatusLine>
        )}
      </Section>
    );
  }
  // A filtered view has to show its matches without a second click, and a short
  // scale is not worth collapsing at all.
  const openByDefault = filtering || steps.length <= 3;

  return (
    <Section
      id={SECTION_IDS.typography}
      title="Typography combinations"
      count={summary.typography.length}
      subtitle="One step per text size. Inside each, the family, weight, style, line height, and tracking combinations found at that size."
    >
      <div className="grid gap-1.5">
        {steps.map(step => (
          <Collapsible
            key={step.sizePx}
            defaultOpen={openByDefault}
            summary={
              <span className="flex w-full items-center gap-2">
                <span className="font-medium text-foreground tabular-nums">
                  {formatSizeLabel(
                    step.sizePx,
                    summary.source.rootFontSize,
                    summary.source.rootFontSizeFluid,
                  )}
                </span>
                <span>
                  {step.combinations.length}{' '}
                  {step.combinations.length === 1 ? 'combination' : 'combinations'}
                </span>
                <span className="ml-auto tabular-nums">x{step.count}</span>
              </span>
            }
          >
            <ul className="grid gap-2">
              {step.combinations.map(group => (
                <TypographyCombination
                  key={group.key}
                  group={group}
                  rootFontSize={summary.source.rootFontSize}
                  rootFontSizeFluid={summary.source.rootFontSizeFluid}
                  tabId={tabId}
                />
              ))}
            </ul>
          </Collapsible>
        ))}
      </div>
      <StatusLine>
        Sample text is capped at {SAMPLE_DISPLAY_CAP_PX} px for display. The measured size is
        listed above.
      </StatusLine>
    </Section>
  );
}

function PaletteSection({
  summary,
  tabId,
  filtering,
}: {
  summary: PageSummary;
  tabId: number | null;
  filtering: boolean;
}) {
  if (summary.colors.length === 0) {
    return (
      <Section id={SECTION_IDS.palette} title="Palette">
        {filtering ? (
          <NoMatches section="Palette" />
        ) : (
          <StatusLine>No colors were recorded in this scan.</StatusLine>
        )}
      </Section>
    );
  }

  return (
    <Section
      id={SECTION_IDS.palette}
      title="Palette"
      count={summary.colors.length}
      subtitle="Counts are element and property occurrences, not area."
    >
      <PaletteView
        colors={summary.colors}
        tabId={tabId}
        clusters={filtering ? undefined : summary.paletteClusters}
      />
    </Section>
  );
}

function SpacingColumn({
  label,
  values,
  tabId,
}: {
  label: string;
  values: ValueCount[];
  tabId: number | null;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const positive = values.filter(entry => entry.valuePx > 0);
  const rest = values.filter(entry => entry.valuePx <= 0);

  const row = (entry: ValueCount) => (
    <li key={entry.valuePx}>
      <button
        type="button"
        aria-expanded={expanded === entry.valuePx}
        onClick={() => setExpanded(expanded === entry.valuePx ? null : entry.valuePx)}
        className="flex w-full items-baseline justify-between gap-2 rounded-[8px] px-1.5 py-1 text-left text-[12px] hover:bg-surface-3"
      >
        <span className="tabular-nums">{round(entry.valuePx)} px</span>
        <span className="text-muted-foreground tabular-nums">x{entry.count}</span>
      </button>
      {expanded === entry.valuePx ? (
        <ExampleControls examples={entry.examples} tabId={tabId} />
      ) : null}
    </li>
  );

  return (
    <div>
      <GroupHeading count={positive.length + rest.length}>{label}</GroupHeading>
      {positive.length === 0 && rest.length === 0 ? (
        <StatusLine>None recorded.</StatusLine>
      ) : (
        <WindowedList items={positive} className="grid" noun="values">
          {row}
        </WindowedList>
      )}
      {rest.length > 0 ? (
        <Collapsible summary="Show zero and negative">
          <WindowedList items={rest} className="grid" noun="values">
            {row}
          </WindowedList>
        </Collapsible>
      ) : null}
    </div>
  );
}

function SpacingSection({
  summary,
  tabId,
  filtering,
}: {
  summary: PageSummary;
  tabId: number | null;
  filtering: boolean;
}) {
  const { padding, margin, gap } = summary.spacing;
  if (filtering && padding.length === 0 && margin.length === 0 && gap.length === 0) {
    return (
      <Section id={SECTION_IDS.spacing} title="Spacing">
        <NoMatches section="Spacing" />
      </Section>
    );
  }
  return (
    <Section
      id={SECTION_IDS.spacing}
      title="Spacing"
      count={padding.length + margin.length + gap.length}
      subtitle="Frequent values first. Grouping is never the site's own scale."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <SpacingColumn label="Padding" values={summary.spacing.padding} tabId={tabId} />
        <SpacingColumn label="Margin" values={summary.spacing.margin} tabId={tabId} />
        <SpacingColumn label="Gap" values={summary.spacing.gap} tabId={tabId} />
      </div>
    </Section>
  );
}

function RadiiSection({
  summary,
  tabId,
  filtering,
}: {
  summary: PageSummary;
  tabId: number | null;
  filtering: boolean;
}) {
  if (summary.radii.length === 0) {
    if (!filtering) return null;
    return (
      <Section id={SECTION_IDS.radii} title="Radii">
        <NoMatches section="Radii" />
      </Section>
    );
  }
  return (
    <Section
      id={SECTION_IDS.radii}
      title="Radii"
      count={summary.radii.length}
      subtitle="Includes asymmetric corner sets."
    >
      <WindowedList items={summary.radii} className="grid gap-1.5" noun="radii">
        {group => (
          <li key={group.value} className="group/row rounded-[8px] bg-surface-2 p-2">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-6 shrink-0 bg-accent-quiet"
                style={{ borderRadius: group.value }}
              />
              <span className="value-cell font-mono text-[12px]">{group.value}</span>
              <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
                x{group.count}
              </span>
            </div>
            <ExampleControls examples={group.examples} tabId={tabId} reveal />
          </li>
        )}
      </WindowedList>
    </Section>
  );
}

function ShadowsSection({
  summary,
  tabId,
  filtering,
}: {
  summary: PageSummary;
  tabId: number | null;
  filtering: boolean;
}) {
  if (summary.shadows.length === 0) {
    if (!filtering) return null;
    return (
      <Section id={SECTION_IDS.shadows} title="Shadows">
        <NoMatches section="Shadows" />
      </Section>
    );
  }
  return (
    <Section
      id={SECTION_IDS.shadows}
      title="Shadows"
      count={summary.shadows.length}
      subtitle="Deduplicated shadow combinations."
    >
      <WindowedList items={summary.shadows} className="grid gap-2" noun="shadows">
        {group => (
          <li key={group.value} className="group/row rounded-[8px] bg-surface-2 p-2">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="size-9 shrink-0 rounded-[8px] bg-background"
                style={{ boxShadow: group.value }}
              />
              <span className="min-w-0 value-cell font-mono text-[12px]">{group.value}</span>
              <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
                x{group.count}
              </span>
            </div>
            <ExampleControls examples={group.examples} tabId={tabId} reveal />
          </li>
        )}
      </WindowedList>
    </Section>
  );
}

function FontsSection({
  summary,
  onDownload,
  filtering,
}: {
  summary: PageSummary;
  onDownload: (url: string, filename: string) => void;
  filtering: boolean;
}) {
  if (summary.fonts.length === 0) {
    if (!filtering) return null;
    return (
      <Section id={SECTION_IDS.fonts} title="Fonts">
        <NoMatches section="Fonts" />
      </Section>
    );
  }
  return (
    <Section
      id={SECTION_IDS.fonts}
      title="Fonts"
      count={summary.fonts.length}
      subtitle="Declared faces are not the same as loaded ones, or as faces used by content."
    >
      <ul className="grid gap-2">
        {summary.fonts.map(font => (
          <li key={font.family} className="rounded-[8px] bg-surface-2 p-2">
            <div className="flex items-center gap-2">
              <span className="truncate text-[12px] font-medium">{font.family}</span>
              <span className="ml-auto text-[12px] text-muted-foreground">
                {FONT_SOURCE_LABELS[font.source.kind]}
              </span>
            </div>
            <div className="mt-1 grid gap-0.5">
              <Field label="Declared">{font.declared ? 'Yes' : 'No'}</Field>
              <Field label="Loaded">
                {font.loaded === null ? 'Unknown' : font.loaded ? 'Yes' : 'No'}
              </Field>
              <Field label="Matched to content">{font.matchedToContent ? 'Yes' : 'No'}</Field>
              {font.weights.length > 0 ? (
                <Field label="Weights">{font.weights.join(', ')}</Field>
              ) : null}
              {font.source.format ? <Field label="Format">{font.source.format}</Field> : null}
              {font.source.subset !== null ? (
                <Field label="Subset">{font.source.subset ? 'Yes' : 'No'}</Field>
              ) : null}
            </div>
            {font.source.note ? <StatusLine>{font.source.note}</StatusLine> : null}
            {/* An unlocatable source is a reading, not an error, but it still
                owes the reader somewhere to go next (PRD 19.3). */}
            {font.source.kind === 'unknown' && !font.source.note ? (
              <StatusLine>
                No download source was found for this family. Copy the family name and look it up,
                or read the declared faces below for the URLs the page did use.
              </StatusLine>
            ) : null}
            {font.source.kind === 'self-hosted' && font.source.url ? (
              <Button
                type="button"
                size="sm"
                variant="text"
                className="mt-1.5"
                onClick={() =>
                  onDownload(
                    font.source.url as string,
                    `${font.family}.${font.source.format ?? 'woff2'}`,
                  )
                }
              >
                <Download aria-hidden />
                Download font file
              </Button>
            ) : null}
            {font.faces.length > 0 ? (
              <Collapsible summary={`Declared faces (${font.faces.length})`}>
                <ul className="grid gap-1">
                  {font.faces.map((face, index) => (
                    <li key={`${face.family}-${face.weight}-${index}`} className="text-[12px]">
                      <span className="font-mono">
                        {face.weight} {face.style}
                      </span>
                      <span className="ml-1 text-muted-foreground">
                        {face.status ?? 'status unknown'}
                      </span>
                      {face.urls.length > 0 ? (
                        <span className="value-cell ml-1 text-muted-foreground">
                          {face.urls[0]}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Collapsible>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function SummaryTab({
  tabId,
  pageTitle,
  summary,
  loading,
  error,
  progress,
  stale,
  onScan,
  onCancel,
}: {
  tabId: number | null;
  pageTitle: string;
  summary: PageSummary | null;
  loading: boolean;
  error: string | null;
  progress: { scanned: number; total: number } | null;
  stale: boolean;
  onScan: () => void;
  /** Stops a running scan. The panel keeps whatever it already had. */
  onCancel?: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'neutral' | 'error' | 'success'>('neutral');
  // `typed` is what the field shows; `query` is what the sections filter on.
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (typed === query) return;
    const timer = setTimeout(() => setQuery(typed), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed, query]);

  const filtered = useMemo(
    () => (summary ? filterSummary(summary, query) : null),
    [summary, query],
  );
  // Memoised on the summary's identity, not rebuilt per render: every section
  // below takes this object as a prop, so a fresh one each time would make the
  // whole summary reconcile whenever anything in the panel changed (PERF 3).
  const view: PageSummary | null = useMemo(
    () =>
      summary && filtered
        ? {
            ...summary,
            typography: filtered.typography,
            sizeScale: filtered.sizeScale,
            colors: filtered.colors,
            spacing: filtered.spacing,
            radii: filtered.radii,
            shadows: filtered.shadows,
            fonts: filtered.fonts,
            stack: filtered.stack,
          }
        : null,
    [summary, filtered],
  );

  const say = (message: string, tone: 'neutral' | 'error' | 'success' = 'neutral') => {
    setNotice(message);
    setNoticeTone(tone);
  };

  const download = (url: string, filename: string) => {
    void (async () => {
      const response = await sendToBackground({ type: 'download.url', url, filename });
      if (response.ok) say(`Downloading ${filename}.`, 'success');
      else say(response.error, 'error');
    })();
  };

  const saveSummary = () => {
    if (!summary) return;
    void (async () => {
      const response = await sendToBackground({
        type: 'reference.save',
        snapshot: summary,
        title: `${pageTitle || summary.source.title || 'Page'} summary`,
        note: '',
        captureScreenshot: false,
      });
      if (response.ok) say('Saved to your collection.', 'success');
      else say(response.error, 'error');
    })();
  };

  const copyMarkdown = () => {
    if (!summary) return;
    const attempt = runExport(() => summaryToMarkdown(summary));
    if (!attempt.ok) {
      say(`Markdown export is unavailable: ${attempt.error}`, 'error');
      return;
    }
    void copyText(attempt.value).then(copyError =>
      copyError ? say(copyError, 'error') : say('Markdown copied.', 'success'),
    );
  };

  const downloadJson = () => {
    if (!summary) return;
    const now = new Date().toISOString();
    const wrapper: SavedReference = {
      id: summary.id,
      schemaVersion: SCHEMA_VERSION,
      kind: 'summary',
      title: `${pageTitle || summary.source.title || 'Page'} summary`,
      note: '',
      createdAt: now,
      updatedAt: now,
      snapshot: summary,
      screenshotId: null,
      screenshotIsCrop: null,
    };
    const attempt = runExport(() =>
      JSON.stringify(toJsonEnvelope([wrapper], extensionVersion()), null, 2),
    );
    if (!attempt.ok) {
      say(`JSON export is unavailable: ${attempt.error}`, 'error');
      return;
    }
    void (async () => {
      const response = await sendToBackground({
        type: 'download.data',
        dataUrl: jsonDataUrl(attempt.value),
        filename: `design-inspector-summary-${exportDateStamp()}.json`,
      });
      if (response.ok) say('JSON download started.', 'success');
      else say(response.error, 'error');
    })();
  };

  if (loading) {
    return (
      <div className="grid gap-2">
        <StatusLine>
          {progress
            ? `Scanning ${progress.scanned} of ${progress.total} elements.`
            : 'Scanning this page.'}
        </StatusLine>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Progress
              aria-label="Scan progress"
              value={progress && progress.total > 0 ? (progress.scanned / progress.total) * 100 : 5}
            />
          </div>
          {onCancel ? (
            <Button type="button" size="sm" variant="text" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="grid gap-2">
        <EmptyState
          title="No page summary yet"
          body="Scanning reads the current document state at this viewport. It does not visit other routes or breakpoints."
          action={
            <Button type="button" onClick={onScan} disabled={tabId === null}>
              <ScanLine aria-hidden />
              Scan this page
            </Button>
          }
        />
        {error ? <StatusLine tone="error">{error}</StatusLine> : null}
      </div>
    );
  }

  // Both are non-null here: they are derived from `summary` above.
  const counts = filtered ?? { active: false, shown: 0, total: 0 };
  const filtering = counts.active;
  const shownSummary = view ?? summary;

  return (
    // 16px between cards, 12px inside one, 8px inside a row: the panel's whole
    // spacing rhythm, stated once here and once on the panel shell.
    <div className="grid gap-4">
      {stale ? (
        <div className="rounded-[10px] bg-surface p-3">
          {/* A page that moved on is a fact about the page, not a failure of
              the reading, so it is told in the quiet voice. */}
          <StatusLine>Page changed. Refresh for a current reading.</StatusLine>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        <Button type="button" size="sm" variant="tonal" onClick={onScan}>
          <RefreshCw aria-hidden />
          Refresh
        </Button>
        <Button type="button" size="sm" variant="text" onClick={saveSummary}>
          <Save aria-hidden />
          Save summary
        </Button>
        <Button type="button" size="sm" variant="text" onClick={copyMarkdown}>
          Copy Markdown
        </Button>
        <Button type="button" size="sm" variant="text" onClick={downloadJson}>
          Download JSON
        </Button>
      </div>

      {error ? <StatusLine tone="error">{error}</StatusLine> : null}
      {notice ? <StatusLine tone={noticeTone}>{notice}</StatusLine> : null}

      <ScopeSection summary={summary} />

      <JumpTo />

      <div className="flex items-center gap-2">
        <Input
          type="search"
          value={typed}
          aria-label="Filter the summary"
          placeholder="Filter values, families, colors"
          onChange={event => setTyped(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setTyped('');
            setQuery('');
          }}
        />
        {filtering ? (
          <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
            {counts.shown} of {counts.total} shown
          </span>
        ) : null}
      </div>

      <TypeScaleSection summary={shownSummary} filtering={filtering} />
      <TypographySection summary={shownSummary} tabId={tabId} filtering={filtering} />
      <PaletteSection summary={shownSummary} tabId={tabId} filtering={filtering} />
      <SpacingSection summary={shownSummary} tabId={tabId} filtering={filtering} />
      <RadiiSection summary={shownSummary} tabId={tabId} filtering={filtering} />
      <ShadowsSection summary={shownSummary} tabId={tabId} filtering={filtering} />
      <FontsSection summary={shownSummary} onDownload={download} filtering={filtering} />
      <Section
        id={SECTION_IDS.stack}
        title="Stack"
        count={shownSummary.stack.detections.length}
        subtitle="Also available on its own tab."
      >
        {filtering && shownSummary.stack.detections.length === 0 &&
        shownSummary.stack.hints.length === 0 ? (
          <NoMatches section="Stack" />
        ) : (
          <StackReportView report={shownSummary.stack} />
        )}
      </Section>
    </div>
  );
}
