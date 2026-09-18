// Typed page-summary fixtures plus helpers for building scan records and
// stack evidence in tests.
import type {
  ColorGroup,
  ElementScanRecord,
  PageSummary,
  SavedReference,
  ScanScope,
  StackReport,
} from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';
import type { PageEvidence } from '@/lib/readings/stack-signatures';
import { clusterPalette } from '@/lib/readings/summary-aggregate';
import { color, corners, sides, source } from './snapshots';

export const scope: ScanScope = {
  eligibleElements: 1200,
  scannedElements: 812,
  capped: false,
  cap: 5000,
  durationMs: 184.5,
  skipped: [{ reason: 'not rendered', count: 388 }],
  inaccessibleFrames: 1,
  openShadowRoots: 2,
  notes: ['Offscreen elements with rendered layout were included.'],
};

export const stackReport: StackReport = {
  detections: [
    {
      id: 'nextjs',
      name: 'Next.js',
      category: 'framework',
      confidence: 'high',
      evidence: [{ kind: 'dom-marker', detail: 'script#__NEXT_DATA__' }],
      version: '15.2',
      observedAt: '2026-09-18T10:30:00.000Z',
    },
    {
      id: 'react',
      name: 'React',
      category: 'framework',
      confidence: 'likely',
      evidence: [{ kind: 'dom-marker', detail: 'implied by Next.js' }],
      version: null,
      observedAt: '2026-09-18T10:30:00.000Z',
    },
  ],
  hints: [{ name: 'Google Tag Manager', evidence: [{ kind: 'script-url', detail: 'https://www.googletagmanager.com/gtm.js?id=GTM-0' }] }],
  scope: 'page',
  observedAt: '2026-09-18T10:30:00.000Z',
};

function colorGroup(overrides: Partial<ColorGroup> & Pick<ColorGroup, 'role' | 'key'>): ColorGroup {
  return {
    color: color(overrides.key, { hex: overrides.key }),
    count: 1,
    inferredRole: null,
    examples: [{ locator: 'body', label: 'body' }],
    ...overrides,
  };
}

/** Every color role, with the clusters the aggregator would build from them. */
const paletteColors: ColorGroup[] = [
  colorGroup({ role: 'text', key: '#0a0a0a', count: 42, inferredRole: 'neutral' }),
  colorGroup({ role: 'text', key: '#4f46e5', count: 3, inferredRole: 'accent' }),
  colorGroup({ role: 'background', key: '#ffffff', count: 30, inferredRole: 'neutral' }),
  colorGroup({ role: 'border', key: '#e4e4e7', count: 12 }),
  colorGroup({ role: 'fill', key: '#18181b', count: 6 }),
  colorGroup({ role: 'stroke', key: '#71717a', count: 2 }),
  colorGroup({ role: 'gradient-stop', key: '#f4f4f5', count: 4 }),
];

/** Two typography groups, every color role, spacing including 0 and -8, one shadow. */
export const pageSummary: PageSummary = {
  id: 'summary-1',
  schemaVersion: SCHEMA_VERSION,
  source,
  scope,
  typography: [
    {
      key: 'Inter Display|600|normal|72|75.6px|-1.44px',
      familyReading: 'Inter Display',
      familyConfidence: 'matched',
      weight: 600,
      style: 'normal',
      sizePx: 72,
      lineHeightRaw: '75.6px',
      letterSpacingRaw: '-1.44px',
      count: 1,
      sample: 'Build faster',
      examples: [{ locator: 'main > section:nth-of-type(1) > h1', label: 'h1 "Build faster"' }],
    },
    {
      key: 'Inter|400|normal|16|24px|normal',
      familyReading: 'Inter',
      familyConfidence: 'declared',
      weight: 400,
      style: 'normal',
      sizePx: 16,
      lineHeightRaw: '24px',
      letterSpacingRaw: 'normal',
      count: 42,
      sample: 'Ship a design system | fast',
      examples: [{ locator: 'main p', label: 'p' }],
    },
  ],
  sizeScale: [
    { sizePx: 72, count: 1 },
    { sizePx: 16, count: 42 },
  ],
  colors: paletteColors,
  paletteClusters: clusterPalette(paletteColors),
  spacing: {
    padding: [
      { valuePx: 24, count: 60, examples: [] },
      { valuePx: 96, count: 8, examples: [] },
      { valuePx: 0, count: 120, examples: [] },
    ],
    margin: [
      { valuePx: 16, count: 22, examples: [] },
      { valuePx: 0, count: 200, examples: [] },
      { valuePx: -8, count: 2, examples: [] },
    ],
    gap: [
      { valuePx: 32, count: 9, examples: [] },
      { valuePx: 48, count: 4, examples: [] },
    ],
  },
  fonts: [
    {
      family: 'Inter Display',
      declared: true,
      loaded: true,
      matchedToContent: true,
      source: { kind: 'self-hosted', url: 'https://example.com/fonts/inter-display.woff2', format: 'woff2', subset: null },
      weights: ['600'],
      faces: [],
    },
    {
      family: 'Inter',
      declared: true,
      loaded: null,
      matchedToContent: true,
      source: { kind: 'google', url: 'https://fonts.googleapis.com/css2?family=Inter', format: null, subset: null },
      weights: ['400', '500'],
      faces: [],
    },
  ],
  radii: [
    { value: '8px', count: 12, examples: [] },
    { value: '16px 16px 4px 16px', count: 3, examples: [] },
  ],
  shadows: [{ value: 'rgba(0, 0, 0, 0.06) 0px 1px 2px 0px', count: 7, examples: [] }],
  stack: stackReport,
  limitations: ['Counts are element and property occurrences, not visual area.'],
};

export function summaryReference(overrides: Partial<SavedReference> = {}): SavedReference {
  return {
    id: 'ref-summary',
    schemaVersion: SCHEMA_VERSION,
    kind: 'summary',
    title: 'Example landing page',
    note: 'Wide type contrast, quiet palette.',
    createdAt: '2026-09-18T10:32:00.000Z',
    updatedAt: '2026-09-18T10:32:00.000Z',
    snapshot: pageSummary,
    screenshotId: null,
    screenshotIsCrop: null,
    ...overrides,
  } as SavedReference;
}

/** A scan record with sane empty defaults, so tests set only what they assert. */
export function scanRecord(overrides: Partial<ElementScanRecord> = {}): ElementScanRecord {
  return {
    locator: 'body',
    label: 'body',
    hasOwnText: false,
    typography: null,
    backgroundColor: null,
    backgroundLayers: [],
    borderColors: [],
    fill: null,
    stroke: null,
    padding: sides(0),
    margin: sides(0),
    gap: null,
    radius: corners('0px'),
    boxShadow: [],
    ...overrides,
  };
}

export function textRecord(
  overrides: Partial<ElementScanRecord> = {},
  typography: Partial<NonNullable<ElementScanRecord['typography']>> = {},
): ElementScanRecord {
  return scanRecord({
    hasOwnText: true,
    typography: {
      familyReading: 'Inter',
      familyConfidence: 'declared',
      weight: 400,
      style: 'normal',
      sizePx: 16,
      lineHeightRaw: '24px',
      letterSpacingRaw: 'normal',
      color: color('rgb(10, 10, 10)', { hex: '#0a0a0a' }),
      sample: 'Body copy',
      ...typography,
    },
    ...overrides,
  });
}

export function emptyEvidence(overrides: Partial<PageEvidence> = {}): PageEvidence {
  return {
    scriptUrls: [],
    stylesheetUrls: [],
    linkUrls: [],
    meta: [],
    domMarkers: [],
    globals: [],
    inlineScriptIds: [],
    htmlAttributes: [],
    headers: [],
    ...overrides,
  };
}
