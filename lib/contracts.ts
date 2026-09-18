// Data contracts for Design Inspector (docs/PRD.md section 18.4).
//
// Rules that every producer and consumer of these types follows:
// - Raw observed values stay separate from display formatting and inferred groups.
// - Every uncertain reading carries an evidence status (section 16.1).
// - Persisted records and exports carry SCHEMA_VERSION so they can be migrated.
// - Unknown is `null` or a Reading with status 'unavailable', never 0 or ''.

export const SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Evidence model (PRD 16.1)

/** Shared evidence status. Specific labels below map onto it in exports. */
export type EvidenceStatus = 'observed' | 'derived' | 'inferred' | 'unavailable';

/** Font identification (PRD TYP-01). declared < matched < verified. */
export type FontConfidence = 'declared' | 'matched' | 'verified';

/** Technology detection (PRD STK-01). Weak hints never become detections. */
export type StackConfidence = 'high' | 'likely';

/** A value plus how we know it. `note` explains derivation or why unavailable. */
export interface Reading<T> {
  value: T | null;
  status: EvidenceStatus;
  note?: string;
}

// ---------------------------------------------------------------------------
// Source context (PRD SAV-01, EXP-04)

export interface Viewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface SourceContext {
  url: string;
  title: string;
  /** ISO 8601 timestamp of the observation. */
  capturedAt: string;
  viewport: Viewport;
  /** Root font size in CSS px, read from the inspected document. */
  rootFontSize: number;
  /**
   * The authored root font-size when it could be read (same-origin stylesheet
   * or inline style), e.g. 'clamp(14px, 1vw, 18px)' or '62.5%'. Null when unknown.
   */
  rootFontSizeAuthored?: string | null;
  /**
   * True when the root font size depends on the viewport (vw/vh/clamp/calc in the
   * authored value, or a non-integer computed root with no readable source), so
   * px readings change with the window while rem readings are stable.
   */
  rootFontSizeFluid?: boolean;
  scrollX: number;
  scrollY: number;
}

// ---------------------------------------------------------------------------
// Primitive readings

export interface Sides<T> {
  top: T;
  right: T;
  bottom: T;
  left: T;
}

export interface Corners<T> {
  topLeft: T;
  topRight: T;
  bottomRight: T;
  bottomLeft: T;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A color as observed, plus conversions. Conversions are derived, and lossy
 *  when the source is outside sRGB or precision was lost (PRD SUR-02). */
export interface ColorValue {
  /** Serialization exactly as the browser reported it. */
  raw: string;
  hex: string | null;
  rgb: string | null;
  oklch: string | null;
  /** 0..1. Preserved from the raw value. */
  alpha: number;
  lossy: boolean;
}

// ---------------------------------------------------------------------------
// Typography (PRD section 8)

export type FontSourceKind =
  | 'google'
  | 'adobe'
  | 'fontshare'
  | 'self-hosted'
  | 'system'
  | 'unknown';

export interface FontSource {
  kind: FontSourceKind;
  /** URL of the font file or provider stylesheet, when discovered. */
  url: string | null;
  /** e.g. 'woff2'. */
  format: string | null;
  /** True when the discovered file is known to be a subset. Null when unknown. */
  subset: boolean | null;
  note?: string;
}

/**
 * What the font file itself says (OpenType name and fvar tables), read on
 * demand from the served woff/woff2/ttf. This is the real identity behind a
 * site's CSS alias (PRD TYP-01, TYP-03).
 */
export interface FontIdentity {
  /** name id 16 (typographic family) or 1. */
  family: string;
  /** name id 17 (typographic subfamily) or 2, e.g. 'Regular', 'Bold Italic'. */
  subfamily: string | null;
  /** name id 4. */
  fullName: string | null;
  /** name id 6. */
  postscriptName: string | null;
  /** name id 9. */
  designer: string | null;
  /** name id 8. */
  manufacturer: string | null;
  /** name id 5, trimmed to the version number when possible. */
  version: string | null;
  /** name id 13 (license description), truncated to 300 chars. */
  license: string | null;
  /** name id 14. */
  licenseUrl: string | null;
  /** fvar axes for variable fonts; empty for static faces. */
  axes: { tag: string; name: string | null; min: number; max: number; default: number }[];
  /** Container format that was parsed. */
  container: 'woff2' | 'woff' | 'sfnt' | 'ttc';
  /** File size in bytes. */
  fileSize: number;
  /** Where the identity came from. */
  evidence: 'name-table';
  /** The URL that was read. */
  url: string;
}

export interface FontFaceRecord {
  family: string;
  weight: string;
  style: string;
  /** Source URLs from @font-face src descriptors. */
  urls: string[];
  format: string | null;
  unicodeRange: string | null;
  /** From document.fonts status when readable. */
  status: 'loaded' | 'loading' | 'unloaded' | 'error' | null;
}

export interface ContrastReading {
  /** WCAG 2.x contrast ratio, or null when unavailable. */
  ratio: number | null;
  status: EvidenceStatus;
  /** The two colors used for the calculation, after alpha composition. */
  foreground: string | null;
  background: string | null;
  /** Why unavailable, e.g. 'gradient background'. */
  reason?: string;
}

export interface TypographyReading {
  /** Computed font-family stack, split and unquoted, in declared order. */
  familyStack: string[];
  /** The family we show as the reading. */
  familyReading: string;
  familyConfidence: FontConfidence;
  source: FontSource;
  /** Computed font-weight as a number (100..900). */
  weight: number;
  /** 'normal' | 'italic' | 'oblique ...'. */
  style: string;
  /** Computed font-variation-settings when not 'normal'. */
  variationSettings: string | null;
  sizePx: number;
  /** Derived: sizePx / rootFontSize. */
  sizeRem: number;
  /** Computed line-height serialization ('normal' or a px length). */
  lineHeightRaw: string;
  /** Resolved px, or null when 'normal'. Never invented. */
  lineHeightPx: number | null;
  /** Derived: lineHeightPx / sizePx, or null. */
  lineHeightRatio: number | null;
  letterSpacingRaw: string;
  /** 0 for 'normal'. */
  letterSpacingPx: number;
  /** Derived: letterSpacingPx / sizePx, or null when size is 0. */
  letterSpacingEm: number | null;
  textTransform: string;
  textDecoration: string;
  fontVariant: string;
  color: ColorValue;
  contrast: ContrastReading;
  /**
   * How the family reading was confirmed. 'rendered' means a canvas measurement
   * showed the family paints differently from its fallback, which is the
   * evidence behind a 'verified' familyConfidence. Null when not checked.
   */
  renderCheck?: 'rendered' | 'fallback' | 'inconclusive' | null;
  /** Present after the user asked to identify the font file (opt-in fetch). */
  identity?: FontIdentity | null;
}

// ---------------------------------------------------------------------------
// Surfaces (PRD section 9)

export interface SurfaceReading {
  backgroundColor: ColorValue;
  /** background-image layers in declared order (gradients, url()). */
  backgroundLayers: string[];
  borderColor: Sides<ColorValue>;
  borderWidth: Sides<number>;
  borderStyle: Sides<string>;
  radius: Corners<string>;
  /** Individual box-shadow entries in order. */
  boxShadow: string[];
  textShadow: string[];
  opacity: number;
  filter: string;
  backdropFilter: string;
  /** SVG only. */
  fill: ColorValue | null;
  stroke: ColorValue | null;
}

// ---------------------------------------------------------------------------
// Layout (PRD section 10)

export interface FlexReading {
  direction: string;
  wrap: string;
  justifyContent: string;
  alignItems: string;
  alignContent: string;
  rowGap: number;
  columnGap: number;
}

export interface GridReading {
  templateColumns: string;
  templateRows: string;
  autoFlow: string;
  rowGap: number;
  columnGap: number;
  /** Placement of the selected element inside its grid parent, when it is a grid item. */
  itemPlacement: { column: string; row: string } | null;
}

export interface LayoutReading {
  display: string;
  boxSizing: string;
  /** Border-box size from offsetWidth/offsetHeight (untransformed layout). */
  layoutSize: { width: number; height: number };
  /** getBoundingClientRect in viewport coordinates. Differs from layout when transformed. */
  visualRect: Rect;
  /** True when a transform is applied to the element or an ancestor. */
  transformed: boolean;
  padding: Sides<number>;
  margin: Sides<number>;
  border: Sides<number>;
  minWidth: string;
  maxWidth: string;
  minHeight: string;
  maxHeight: string;
  flex: FlexReading | null;
  grid: GridReading | null;
  position: string;
  /** Computed inset values, preserving 'auto'. */
  inset: Sides<string>;
  /** Preserves 'auto'. */
  zIndex: string;
  /** Authored expressions when their origin is actually available, e.g. { 'max-width': 'clamp(...)' }. */
  sourceExpressions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Assets (PRD section 11)

export type AssetKind = 'img' | 'picture' | 'svg-inline' | 'css-background' | 'video';
/** Video: only directly addressable files (mp4/webm URLs) count; blob: and MSE streams are reported with url null and a limitation (PRD AST-01). */

export interface AssetCandidate {
  url: string;
  /** srcset descriptor such as '2x' or '1200w', when present. */
  descriptor: string | null;
}

export interface AssetReading {
  kind: AssetKind;
  /** The resource the browser selected (currentSrc), or the single URL. Null for inline SVG. */
  url: string | null;
  candidates: AssetCandidate[];
  renderedWidth: number;
  renderedHeight: number;
  intrinsicWidth: number | null;
  intrinsicHeight: number | null;
  /** Bytes when known. Never 0 for unknown. */
  fileSize: number | null;
  mimeType: string | null;
  /** Serialized standalone markup for inline SVG. */
  svgMarkup: string | null;
  alt: string | null;
  /** How many places on the page reference this same resource (1 when unique). */
  usageCount?: number;
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Element identity (PRD INS-04, SAV-01)

export interface ElementDescriptor {
  tag: string;
  id: string | null;
  classes: string[];
  role: string | null;
  /** Short human label, e.g. 'h1', 'section#hero', 'button "Get started"'. */
  label: string;
  textSample: string | null;
  /** Best-effort CSS locator for context. Not a promise of rediscovery. */
  locator: string;
}

// ---------------------------------------------------------------------------
// Element snapshot (PRD 18.4)

export interface ElementSnapshot {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  source: SourceContext;
  element: ElementDescriptor;
  ancestors: ElementDescriptor[];
  layout: LayoutReading;
  /** Present when the element renders text. */
  typography: TypographyReading | null;
  surfaces: SurfaceReading;
  assets: AssetReading[];
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Page summary (PRD section 12)

export interface ExampleRef {
  locator: string;
  label: string;
}

export interface ScanScope {
  eligibleElements: number;
  scannedElements: number;
  /** True when the scan cap stopped the scan early. */
  capped: boolean;
  cap: number;
  durationMs: number;
  skipped: { reason: string; count: number }[];
  inaccessibleFrames: number;
  openShadowRoots: number;
  /** Plain-language coverage notes for export. */
  notes: string[];
}

export interface TypographyGroup {
  key: string;
  familyReading: string;
  familyConfidence: FontConfidence;
  weight: number;
  style: string;
  sizePx: number;
  lineHeightRaw: string;
  letterSpacingRaw: string;
  count: number;
  sample: string;
  examples: ExampleRef[];
}

export interface SizeScaleEntry {
  sizePx: number;
  count: number;
}

export type ColorRole = 'text' | 'background' | 'border' | 'fill' | 'stroke' | 'gradient-stop';

export interface ColorGroup {
  role: ColorRole;
  color: ColorValue;
  /** Normalized comparison key (e.g. lowercase rgba). */
  key: string;
  count: number;
  /** Suggested label. Inferred, user-correctable. */
  inferredRole: 'accent' | 'neutral' | null;
  examples: ExampleRef[];
}

export interface ValueCount {
  valuePx: number;
  count: number;
  examples: ExampleRef[];
}

export interface SpacingSummary {
  padding: ValueCount[];
  margin: ValueCount[];
  gap: ValueCount[];
}

export interface FontRecord {
  family: string;
  declared: boolean;
  /** Null when document.fonts is not readable. */
  loaded: boolean | null;
  matchedToContent: boolean;
  source: FontSource;
  weights: string[];
  faces: FontFaceRecord[];
  /** Present after the user asked to identify the font file (opt-in fetch). */
  identity?: FontIdentity | null;
}

export interface RadiusGroup {
  /** Serialized corner set, e.g. '8px' or '8px 8px 0 0'. */
  value: string;
  count: number;
  examples: ExampleRef[];
}

export interface ShadowGroup {
  value: string;
  count: number;
  examples: ExampleRef[];
}

export type StackCategory =
  | 'framework'
  | 'builder-cms'
  | 'styling'
  | 'motion-3d'
  | 'font-provider'
  | 'infra-analytics';

export type StackEvidenceKind =
  | 'script-url'
  | 'stylesheet-url'
  | 'dom-marker'
  | 'meta'
  | 'global'
  | 'header'
  | 'link-url';

export interface StackEvidence {
  kind: StackEvidenceKind;
  detail: string;
}

export interface StackDetection {
  id: string;
  name: string;
  category: StackCategory;
  confidence: StackConfidence;
  evidence: StackEvidence[];
  /** Only when reliable evidence states it explicitly. */
  version: string | null;
  observedAt: string;
}

export interface StackReport {
  detections: StackDetection[];
  /** Weak hints shown only in the expanded evidence view. */
  hints: { name: string; evidence: StackEvidence[] }[];
  scope: 'page';
  observedAt: string;
}

/**
 * Colors merged by perceptual (oklch) distance for reading at a glance (SUM-03).
 * The flat `colors` list stays the record; clusters are a view over it.
 */
export interface PaletteCluster {
  /** The representative's comparison key. Unique across clusters. */
  key: string;
  /** The highest-count member, which supplies the swatch and the hex shown. */
  representative: ColorGroup;
  /** Every member, highest count first. */
  members: ColorGroup[];
  /** Occurrences across all members. */
  totalCount: number;
  /** Roles this cluster was seen in, in the palette's own role order. */
  roles: ColorRole[];
  /** The SUM-03 suggestion for the cluster as a whole. Inferred, not declared. */
  inferredRole: 'accent' | 'neutral' | null;
}

export interface PageSummary {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  source: SourceContext;
  scope: ScanScope;
  typography: TypographyGroup[];
  sizeScale: SizeScaleEntry[];
  colors: ColorGroup[];
  spacing: SpacingSummary;
  fonts: FontRecord[];
  radii: RadiusGroup[];
  shadows: ShadowGroup[];
  stack: StackReport;
  /** Present on summaries produced after schema 1 gained clusters; older records lack it. */
  paletteClusters?: PaletteCluster[];
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Scan records (PRD SUM-01). Produced per element by the content script scan,
// consumed by the pure aggregator in lib/readings/summary-aggregate.ts.

export interface ElementScanRecord {
  locator: string;
  label: string;
  /** True when the element has a direct, non-whitespace text node child. */
  hasOwnText: boolean;
  /** Present only when hasOwnText is true. */
  typography: {
    familyReading: string;
    familyConfidence: FontConfidence;
    weight: number;
    style: string;
    sizePx: number;
    lineHeightRaw: string;
    letterSpacingRaw: string;
    color: ColorValue;
    sample: string;
  } | null;
  /** Null when fully transparent. */
  backgroundColor: ColorValue | null;
  backgroundLayers: string[];
  /** Colors of visible border sides only (width > 0 and style not none/hidden). */
  borderColors: ColorValue[];
  fill: ColorValue | null;
  stroke: ColorValue | null;
  padding: Sides<number>;
  margin: Sides<number>;
  /** Present for flex and grid containers. */
  gap: { row: number; column: number } | null;
  radius: Corners<string>;
  boxShadow: string[];
}

// ---------------------------------------------------------------------------
// Saved references (PRD section 14)

interface SavedReferenceBase {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  title: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  /** Key of a locally stored screenshot blob, when captured. */
  screenshotId: string | null;
  /** True when the screenshot is a visible crop of a larger element. */
  screenshotIsCrop: boolean | null;
}

export interface SavedElementReference extends SavedReferenceBase {
  kind: 'element';
  /** Immutable snapshot at save time. */
  snapshot: ElementSnapshot;
}

export interface SavedSummaryReference extends SavedReferenceBase {
  kind: 'summary';
  /** Immutable snapshot at save time. */
  snapshot: PageSummary;
}

/** Discriminated on `kind`, so `kind === 'summary'` narrows `snapshot` to PageSummary. */
export type SavedReference = SavedElementReference | SavedSummaryReference;

// ---------------------------------------------------------------------------
// Export envelope (PRD EXP-04)

export interface ExportEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  extensionVersion: string;
  exportedAt: string;
  sources: SourceContext[];
  references: SavedReference[];
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Settings

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
  /** Show the hover card while moving, or only after pinning. */
  hoverCard: boolean;
  /** Elements scanned before the page summary stops and reports a cap. */
  summaryScanCap: number;
  /** Which coloring the layout-outline toggle uses when switched on. */
  outlineColoring: 'tag' | 'depth';
  /** Clicking an inline text wrapper selects its semantic parent (heading, p, button). */
  preferSemanticParents: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  hoverCard: true,
  summaryScanCap: 5000,
  outlineColoring: 'tag',
  preferSemanticParents: true,
};
