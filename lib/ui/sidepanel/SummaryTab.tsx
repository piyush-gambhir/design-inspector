// Page design summary (PRD 12).
//
// Section order matches the PRD. Every group is traceable back to the page,
// every uncertain reading carries its evidence, and nothing here is presented
// as the site's own token system.
import { useEffect, useId, useMemo, useState } from 'react';
import { Download, RefreshCw, Save, ScanLine } from 'lucide-react';
import type {
  FontIdentity,
  FontRecord,
  PageSummary,
  SavedReference,
  TypographyGroup,
  ValueCount,
} from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';
import { sendToBackground } from '@/lib/messages';
import { groupTypographyByScale } from '@/lib/readings/summary-aggregate';
import {
  aliasDiffers,
  axisChipText,
  designerLine,
  displayFamily,
  firstSentence,
  fontSourceLine,
  formatFromUrl,
  providerLink,
} from '@/lib/readings/fonts';
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

const SPECIMEN_PANGRAM = 'The quick brown fox jumps over the lazy dog';
/** One specimen per loaded weight, capped: a family with 18 faces is a download, not a panel. */
const MAX_SPECIMEN_FACES = 4;
const SPECIMEN_PX = 28;

const FONT_FILE_URL = /\.(woff2|woff|ttf|otf)(\?|#|$)/i;

/** The first loaded face URL for a family, which is what "Identify" reads. */
function identifiableUrl(font: FontRecord): string | null {
  const loaded = font.faces.filter(face => face.status === 'loaded' && face.urls.length > 0);
  const pool = loaded.length > 0 ? loaded : font.faces.filter(face => face.urls.length > 0);
  for (const face of pool) {
    const url = face.urls.find(candidate => FONT_FILE_URL.test(candidate));
    if (url) return url;
  }
  return font.source.url && FONT_FILE_URL.test(font.source.url) ? font.source.url : null;
}


interface SpecimenFace {
  key: string;
  label: string;
  /** The local family name this file was registered under, never the page's own. */
  localFamily: string;
}

/**
 * Loads the family's own files into this panel so the reader sees the typeface
 * rather than a description of it.
 *
 * The bytes are fetched here rather than passed back from the worker because
 * extension messages are JSON: sending a megabyte of font through them would
 * base64 it twice. The browser has the file cached from the identify request a
 * moment earlier, so this is a second read of the same cache entry.
 */
function useSpecimens(
  font: FontRecord,
  enabled: boolean,
  idPrefix: string,
): { faces: SpecimenFace[]; error: string | null } {
  const [faces, setFaces] = useState<SpecimenFace[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof FontFace !== 'function' || !document.fonts) {
      setError('This browser cannot preview font files.');
      return;
    }
    const wanted = font.faces
      .filter(face => face.status === 'loaded' && face.urls.some(url => FONT_FILE_URL.test(url)))
      .slice(0, MAX_SPECIMEN_FACES);
    const pool = wanted.length > 0 ? wanted : font.faces.filter(face => face.urls.length > 0).slice(0, 1);
    if (pool.length === 0) return;

    let cancelled = false;
    const added: FontFace[] = [];

    void (async () => {
      const loaded: SpecimenFace[] = [];
      for (const [index, face] of pool.entries()) {
        const url = face.urls.find(candidate => FONT_FILE_URL.test(candidate));
        if (!url) continue;
        const localFamily = `${idPrefix}-${index}`;
        try {
          const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
          if (!response.ok) throw new Error(`${response.status}`);
          const bytes = await response.arrayBuffer();
          const fontFace = new FontFace(localFamily, bytes);
          await fontFace.load();
          if (cancelled) return;
          document.fonts.add(fontFace);
          added.push(fontFace);
          loaded.push({
            key: `${face.weight}-${face.style}-${index}`,
            label: `${face.weight}${face.style !== 'normal' ? ` ${face.style}` : ''}`,
            localFamily,
          });
        } catch {
          // One weight that will not load is not a reason to drop the rest.
        }
      }
      if (cancelled) return;
      setFaces(loaded);
      if (loaded.length === 0) setError('The font files could not be loaded for a preview.');
    })();

    return () => {
      cancelled = true;
      for (const fontFace of added) {
        try {
          document.fonts.delete(fontFace);
        } catch {
          // Already gone with the panel.
        }
      }
    };
  }, [enabled, font, idPrefix]);

  return { faces, error };
}

function FontCard({
  font,
  headingSample,
  onDownload,
  identity,
  onIdentified,
}: {
  font: FontRecord;
  headingSample: string | null;
  onDownload: (url: string, filename: string) => void;
  identity: FontIdentity | null;
  onIdentified: (url: string, identity: FontIdentity) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const idPrefix = `di-specimen-${reactId}`;
  const url = identifiableUrl(font);
  const { faces: specimens, error: specimenError } = useSpecimens(font, identity !== null, idPrefix);

  const shownFamily = displayFamily(font.family, identity);
  const alias = aliasDiffers(font.family, identity) ? font.family : null;
  const provider = providerLink(font.source.kind, shownFamily);
  const by = identity ? designerLine(identity) : null;
  const licenseSentence = identity && !identity.licenseUrl ? firstSentence(identity.license) : null;

  const identify = () => {
    if (!url) return;
    setPending(true);
    setError(null);
    void (async () => {
      const response = await sendToBackground({ type: 'font.identify', url });
      setPending(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      if (!('identity' in response)) {
        setError('The font file returned no identity.');
        return;
      }
      onIdentified(url, response.identity);
    })();
  };

  return (
    <li className="rounded-[8px] bg-surface-2 p-2">
      <div className="flex items-center gap-2">
        <span className="truncate text-[12px] font-medium">{shownFamily}</span>
        <span className="ml-auto text-[12px] text-muted-foreground">
          {FONT_SOURCE_LABELS[font.source.kind]}
        </span>
      </div>
      <div className="mt-1 grid gap-0.5">
        {identity?.subfamily ? <Field label="Style">{identity.subfamily}</Field> : null}
        {alias ? <Field label="Declared as">{alias}</Field> : null}
        <Field label="Declared">{font.declared ? 'Yes' : 'No'}</Field>
        <Field label="Loaded">
          {font.loaded === null ? 'Unknown' : font.loaded ? 'Yes' : 'No'}
        </Field>
        <Field label="Matched to content">{font.matchedToContent ? 'Yes' : 'No'}</Field>
        {font.weights.length > 0 ? <Field label="Weights">{font.weights.join(', ')}</Field> : null}
        {by ? <Field label="Designer">{by}</Field> : null}
        {identity?.version ? <Field label="Version">{identity.version}</Field> : null}
        {identity?.licenseUrl ? (
          <Field label="License">
            <a
              href={identity.licenseUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="value-cell underline-offset-2 hover:underline"
            >
              {identity.licenseUrl}
            </a>
          </Field>
        ) : licenseSentence ? (
          <Field label="License">{licenseSentence}</Field>
        ) : null}
        {identity?.axes.length ? (
          <Field label="Axes">{identity.axes.map(axisChipText).join(', ')}</Field>
        ) : null}
        <Field label="Source">{fontSourceLine(font.source, identity?.fileSize ?? null)}</Field>
        {font.source.subset !== null ? (
          <Field label="Subset">{font.source.subset ? 'Yes' : 'No'}</Field>
        ) : null}
      </div>
      {font.source.note ? <StatusLine>{font.source.note}</StatusLine> : null}
      {/* An unlocatable source is a reading, not an error, but it still
          owes the reader somewhere to go next (PRD 19.3). */}
      {font.source.kind === 'unknown' && !font.source.note ? (
        <StatusLine>
          No download source was found for this family. Copy the family name and look it up, or read
          the declared faces below for the URLs the page did use.
        </StatusLine>
      ) : null}

      {specimens.length > 0 ? (
        <div className="mt-2 grid gap-1.5">
          {/* The point of the whole feature: what the typeface looks like. */}
          {specimens.map((face, index) => (
            <div key={face.key} className="grid gap-0.5">
              <span className="text-[12px] text-muted-foreground">Specimen {face.label}</span>
              <span
                className="break-words leading-tight"
                style={{ fontFamily: `"${face.localFamily}"`, fontSize: `${SPECIMEN_PX}px` }}
              >
                {SPECIMEN_PANGRAM}
              </span>
              {index === 0 && headingSample ? (
                <span
                  className="break-words leading-tight text-muted-foreground"
                  style={{ fontFamily: `"${face.localFamily}"`, fontSize: `${SPECIMEN_PX}px` }}
                >
                  {headingSample}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {specimenError ? <StatusLine>{specimenError}</StatusLine> : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {!identity && url ? (
          <Button
            type="button"
            size="sm"
            variant="text"
            disabled={pending}
            title="Reads this one font file to find the typeface name, designer, and licence. Contacts the font's host."
            onClick={identify}
          >
            <ScanLine aria-hidden />
            {pending ? 'Reading the file' : 'Identify'}
          </Button>
        ) : null}
        {url ? (
          <Button
            type="button"
            size="sm"
            variant="text"
            onClick={() =>
              onDownload(url, `${shownFamily}.${font.source.format ?? formatFromUrl(url) ?? 'woff2'}`)
            }
          >
            <Download aria-hidden />
            Download font file
          </Button>
        ) : null}
        {provider ? (
          <a
            href={provider.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-7 items-center rounded-full bg-surface-3 px-2.5 text-[12px] text-muted-foreground no-underline hover:text-foreground"
          >
            {provider.label}
          </a>
        ) : null}
      </div>
      {error ? <StatusLine tone="error">{error}</StatusLine> : null}

      {font.faces.length > 0 ? (
        <Collapsible summary={`Declared faces (${font.faces.length})`}>
          <ul className="grid gap-1">
            {font.faces.map((face, index) => (
              <li key={`${face.family}-${face.weight}-${index}`} className="text-[12px]">
                <span className="font-mono">
                  {face.weight} {face.style}
                </span>
                <span className="ml-1 text-muted-foreground">{face.status ?? 'status unknown'}</span>
                {face.urls.length > 0 ? (
                  <span className="value-cell ml-1 text-muted-foreground">{face.urls[0]}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Collapsible>
      ) : null}
    </li>
  );
}

/** The largest text the page actually sets, used as the second specimen line. */
export function largestHeadingSample(summary: PageSummary): string | null {
  let best: TypographyGroup | null = null;
  for (const group of summary.typography) {
    if (!group.sample.trim()) continue;
    if (!best || group.sizePx > best.sizePx) best = group;
  }
  const sample = best?.sample.trim() ?? '';
  return sample === '' ? null : sample.slice(0, 60);
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
  // Identities live here rather than in each card so a family identified once
  // stays identified while the reader filters and scrolls.
  const [identities, setIdentities] = useState<Record<string, FontIdentity>>({});
  const headingSample = useMemo(() => largestHeadingSample(summary), [summary]);

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
      subtitle="Declared faces are not the same as loaded ones, or as faces used by content. Identify reads the file itself, which contacts the font's host."
    >
      <ul className="grid gap-2">
        {summary.fonts.map(font => {
          const url = identifiableUrl(font);
          return (
            <FontCard
              key={font.family}
              font={font}
              headingSample={headingSample}
              onDownload={onDownload}
              identity={(url ? identities[url] : undefined) ?? font.identity ?? null}
              onIdentified={(key, identity) =>
                setIdentities(current => ({ ...current, [key]: identity }))
              }
            />
          );
        })}
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
