







export const SCHEMA_VERSION = 1 as const;





export type EvidenceStatus = 'observed' | 'derived' | 'inferred' | 'unavailable';


export type FontConfidence = 'declared' | 'matched' | 'verified';


export type StackConfidence = 'high' | 'likely';


export interface Reading<T> {
  value: T | null;
  status: EvidenceStatus;
  note?: string;
}




export interface Viewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface SourceContext {
  url: string;
  title: string;

  capturedAt: string;
  viewport: Viewport;

  rootFontSize: number;




  rootFontSizeAuthored?: string | null;





  rootFontSizeFluid?: boolean;
  scrollX: number;
  scrollY: number;
}




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



export interface ColorValue {

  raw: string;
  hex: string | null;
  rgb: string | null;
  oklch: string | null;

  alpha: number;
  lossy: boolean;
}




export type FontSourceKind =
  | 'google'
  | 'adobe'
  | 'fontshare'
  | 'self-hosted'
  | 'system'
  | 'unknown';

export interface FontSource {
  kind: FontSourceKind;

  url: string | null;

  format: string | null;

  subset: boolean | null;
  note?: string;
}






export interface FontIdentity {

  family: string;

  subfamily: string | null;

  fullName: string | null;

  postscriptName: string | null;

  designer: string | null;

  manufacturer: string | null;

  version: string | null;

  license: string | null;

  licenseUrl: string | null;

  axes: { tag: string; name: string | null; min: number; max: number; default: number }[];

  container: 'woff2' | 'woff' | 'sfnt' | 'ttc';

  fileSize: number;

  evidence: 'name-table';

  url: string;
}

export interface FontFaceRecord {
  family: string;
  weight: string;
  style: string;

  urls: string[];
  format: string | null;
  unicodeRange: string | null;

  status: 'loaded' | 'loading' | 'unloaded' | 'error' | null;
}

export interface ContrastReading {

  ratio: number | null;
  status: EvidenceStatus;

  foreground: string | null;
  background: string | null;

  reason?: string;
}

export interface TypographyReading {

  familyStack: string[];

  familyReading: string;
  familyConfidence: FontConfidence;
  source: FontSource;

  weight: number;

  style: string;

  variationSettings: string | null;
  sizePx: number;

  sizeRem: number;

  lineHeightRaw: string;

  lineHeightPx: number | null;

  lineHeightRatio: number | null;
  letterSpacingRaw: string;

  letterSpacingPx: number;

  letterSpacingEm: number | null;
  textTransform: string;
  textDecoration: string;
  fontVariant: string;
  color: ColorValue;
  contrast: ContrastReading;





  renderCheck?: 'rendered' | 'fallback' | 'inconclusive' | null;

  identity?: FontIdentity | null;
}




export interface SurfaceReading {
  backgroundColor: ColorValue;

  backgroundLayers: string[];
  borderColor: Sides<ColorValue>;
  borderWidth: Sides<number>;
  borderStyle: Sides<string>;
  radius: Corners<string>;

  boxShadow: string[];
  textShadow: string[];
  opacity: number;
  filter: string;
  backdropFilter: string;

  fill: ColorValue | null;
  stroke: ColorValue | null;
}




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

  itemPlacement: { column: string; row: string } | null;
}

export interface LayoutReading {
  display: string;
  boxSizing: string;

  layoutSize: { width: number; height: number };

  visualRect: Rect;

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

  inset: Sides<string>;

  zIndex: string;

  sourceExpressions: Record<string, string>;
}




export type AssetKind = 'img' | 'picture' | 'svg-inline' | 'css-background' | 'video';


export interface AssetCandidate {
  url: string;

  descriptor: string | null;
}

export interface AssetReading {
  kind: AssetKind;

  url: string | null;
  candidates: AssetCandidate[];
  renderedWidth: number;
  renderedHeight: number;
  intrinsicWidth: number | null;
  intrinsicHeight: number | null;

  fileSize: number | null;
  mimeType: string | null;

  svgMarkup: string | null;
  alt: string | null;

  usageCount?: number;
  limitations: string[];
}




export interface ElementDescriptor {
  tag: string;
  id: string | null;
  classes: string[];
  role: string | null;

  label: string;
  textSample: string | null;

  locator: string;
}




export interface ElementSnapshot {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  source: SourceContext;
  element: ElementDescriptor;
  ancestors: ElementDescriptor[];
  layout: LayoutReading;

  typography: TypographyReading | null;
  surfaces: SurfaceReading;
  assets: AssetReading[];
  limitations: string[];
}




export interface ExampleRef {
  locator: string;
  label: string;
}

export interface ScanScope {
  eligibleElements: number;
  scannedElements: number;

  capped: boolean;
  cap: number;
  durationMs: number;
  skipped: { reason: string; count: number }[];
  inaccessibleFrames: number;
  openShadowRoots: number;

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

  key: string;
  count: number;

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

  loaded: boolean | null;
  matchedToContent: boolean;
  source: FontSource;
  weights: string[];
  faces: FontFaceRecord[];

  identity?: FontIdentity | null;
}

export interface RadiusGroup {

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

  version: string | null;
  observedAt: string;
}

export interface StackReport {
  detections: StackDetection[];

  hints: { name: string; evidence: StackEvidence[] }[];
  scope: 'page';
  observedAt: string;
}





export interface PaletteCluster {

  key: string;

  representative: ColorGroup;

  members: ColorGroup[];

  totalCount: number;

  roles: ColorRole[];

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

  paletteClusters?: PaletteCluster[];
  limitations: string[];
}





export interface ElementScanRecord {
  locator: string;
  label: string;

  hasOwnText: boolean;

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

  backgroundColor: ColorValue | null;
  backgroundLayers: string[];

  borderColors: ColorValue[];
  fill: ColorValue | null;
  stroke: ColorValue | null;
  padding: Sides<number>;
  margin: Sides<number>;

  gap: { row: number; column: number } | null;
  radius: Corners<string>;
  boxShadow: string[];
}




interface SavedReferenceBase {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  title: string;
  note: string;
  createdAt: string;
  updatedAt: string;

  screenshotId: string | null;

  screenshotIsCrop: boolean | null;
}

export interface SavedElementReference extends SavedReferenceBase {
  kind: 'element';

  snapshot: ElementSnapshot;
}

export interface SavedSummaryReference extends SavedReferenceBase {
  kind: 'summary';

  snapshot: PageSummary;
}


export type SavedReference = SavedElementReference | SavedSummaryReference;




export interface ExportEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  extensionVersion: string;
  exportedAt: string;
  sources: SourceContext[];
  references: SavedReference[];
  limitations: string[];
}




export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;

  hoverCard: boolean;

  summaryScanCap: number;

  outlineColoring: 'tag' | 'depth';

  preferSemanticParents: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  hoverCard: true,
  summaryScanCap: 5000,
  outlineColoring: 'tag',
  preferSemanticParents: true,
};
