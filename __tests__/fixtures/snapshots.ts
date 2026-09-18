// Typed sample snapshots used by the export and aggregation tests.
import type {
  ColorValue,
  Corners,
  ElementSnapshot,
  SavedReference,
  Sides,
  SourceContext,
} from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';

export function color(raw: string, overrides: Partial<ColorValue> = {}): ColorValue {
  return { raw, hex: null, rgb: null, oklch: null, alpha: 1, lossy: false, ...overrides };
}

export function sides<T>(value: T, overrides: Partial<Sides<T>> = {}): Sides<T> {
  return { top: value, right: value, bottom: value, left: value, ...overrides };
}

export function corners(value: string, overrides: Partial<Corners<string>> = {}): Corners<string> {
  return { topLeft: value, topRight: value, bottomRight: value, bottomLeft: value, ...overrides };
}

export const source: SourceContext = {
  url: 'https://example.com/',
  title: 'Example: a landing page',
  capturedAt: '2026-09-18T10:30:00.000Z',
  viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
  rootFontSize: 16,
  scrollX: 0,
  scrollY: 240,
};

/** A hero heading: fallback stack, lossy oklch text color, no surfaces. */
export const headingSnapshot: ElementSnapshot = {
  id: 'snapshot-heading',
  schemaVersion: SCHEMA_VERSION,
  source,
  element: {
    tag: 'h1',
    id: null,
    classes: ['hero__title'],
    role: null,
    label: 'h1 "Build faster"',
    textSample: 'Build faster',
    locator: 'main > section:nth-of-type(1) > h1',
  },
  ancestors: [
    {
      tag: 'section',
      id: 'hero',
      classes: ['hero'],
      role: null,
      label: 'section#hero',
      textSample: null,
      locator: 'main > section:nth-of-type(1)',
    },
  ],
  layout: {
    display: 'block',
    boxSizing: 'border-box',
    layoutSize: { width: 1160, height: 151.2 },
    visualRect: { x: 140, y: 208, width: 1160, height: 151.2 },
    transformed: false,
    padding: sides(0),
    margin: sides(0, { bottom: 24 }),
    border: sides(0),
    minWidth: '0px',
    maxWidth: 'none',
    minHeight: '0px',
    maxHeight: 'none',
    flex: null,
    grid: null,
    position: 'static',
    inset: sides('auto'),
    zIndex: 'auto',
    sourceExpressions: {},
  },
  typography: {
    familyStack: ['Inter Display', 'Inter', 'system-ui', 'sans-serif'],
    familyReading: 'Inter Display',
    familyConfidence: 'matched',
    source: { kind: 'self-hosted', url: 'https://example.com/fonts/inter-display.woff2', format: 'woff2', subset: null },
    weight: 600,
    style: 'normal',
    variationSettings: null,
    sizePx: 72,
    sizeRem: 4.5,
    lineHeightRaw: '75.6px',
    lineHeightPx: 75.6,
    lineHeightRatio: 1.05,
    letterSpacingRaw: '-1.44px',
    letterSpacingPx: -1.44,
    letterSpacingEm: -0.02,
    textTransform: 'none',
    textDecoration: 'none solid oklch(0.18 0.01 250)',
    fontVariant: 'normal',
    color: color('oklch(0.18 0.01 250)', {
      hex: '#0a0a0a',
      rgb: 'rgb(10, 10, 10)',
      oklch: 'oklch(0.18 0.01 250)',
      lossy: true,
    }),
    contrast: {
      ratio: 12.4,
      status: 'derived',
      foreground: '#0a0a0a',
      background: '#ffffff',
    },
  },
  surfaces: {
    backgroundColor: color('rgba(0, 0, 0, 0)', { hex: '#000000', alpha: 0 }),
    backgroundLayers: [],
    borderColor: sides(color('rgb(0, 0, 0)', { hex: '#000000' })),
    borderWidth: sides(0),
    borderStyle: sides('none'),
    radius: corners('0px'),
    boxShadow: [],
    textShadow: [],
    opacity: 1,
    filter: 'none',
    backdropFilter: 'none',
    fill: null,
    stroke: null,
  },
  assets: [],
  limitations: ['Pseudo-element styles were not read for this element.'],
};

/** A translucent card: two shadows, unequal radii, a filter, and a gradient. */
export const cardSnapshot: ElementSnapshot = {
  id: 'snapshot-card',
  schemaVersion: SCHEMA_VERSION,
  source,
  element: {
    tag: 'div',
    id: null,
    classes: ['card', 'card--glass'],
    role: null,
    label: 'div.card',
    textSample: null,
    locator: 'main > section:nth-of-type(2) > div:nth-of-type(1)',
  },
  ancestors: [],
  layout: {
    display: 'flex',
    boxSizing: 'border-box',
    layoutSize: { width: 368, height: 244.5 },
    visualRect: { x: 140, y: 720, width: 368, height: 244.5 },
    transformed: true,
    padding: sides(24),
    margin: sides(0),
    border: sides(1),
    minWidth: '0px',
    maxWidth: '420px',
    minHeight: '0px',
    maxHeight: 'none',
    flex: {
      direction: 'column',
      wrap: 'nowrap',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      alignContent: 'normal',
      rowGap: 16,
      columnGap: 16,
    },
    grid: null,
    position: 'relative',
    inset: sides('auto', { top: '0px' }),
    zIndex: '2',
    sourceExpressions: {},
  },
  typography: null,
  surfaces: {
    backgroundColor: color('rgba(255, 255, 255, 0.72)', { hex: '#ffffff', alpha: 0.72 }),
    backgroundLayers: [
      'linear-gradient(180deg, rgba(255, 255, 255, 0.8) 0%, rgb(244, 244, 245) 100%)',
    ],
    borderColor: sides(color('rgba(0, 0, 0, 0.08)', { hex: '#000000', alpha: 0.08 })),
    borderWidth: sides(1),
    borderStyle: sides('solid'),
    radius: corners('16px', { bottomRight: '4px' }),
    boxShadow: [
      'rgba(0, 0, 0, 0.06) 0px 1px 2px 0px',
      'rgba(0, 0, 0, 0.08) 0px 12px 32px -8px',
    ],
    textShadow: [],
    opacity: 0.96,
    filter: 'saturate(1.1)',
    backdropFilter: 'blur(12px)',
    fill: null,
    stroke: null,
  },
  assets: [
    {
      kind: 'img',
      url: 'https://example.com/media/card.avif',
      candidates: [
        { url: 'https://example.com/media/card.avif', descriptor: '1x' },
        { url: 'https://example.com/media/card@2x.avif', descriptor: '2x' },
      ],
      renderedWidth: 320,
      renderedHeight: 180,
      intrinsicWidth: 1280,
      intrinsicHeight: 720,
      fileSize: null,
      mimeType: 'image/avif',
      svgMarkup: null,
      alt: 'A product screenshot',
      limitations: ['File size was not observed.'],
    },
  ],
  limitations: [],
};

/** A grid container with an authored max-width expression and negative margins. */
export const gridSnapshot: ElementSnapshot = {
  id: 'snapshot-grid',
  schemaVersion: SCHEMA_VERSION,
  source,
  element: {
    tag: 'section',
    id: 'features',
    classes: ['features'],
    role: null,
    label: 'section#features',
    textSample: null,
    locator: 'main > section:nth-of-type(2)',
  },
  ancestors: [],
  layout: {
    display: 'grid',
    boxSizing: 'content-box',
    layoutSize: { width: 1200, height: 612.333 },
    visualRect: { x: 120, y: 660, width: 1200, height: 612.333 },
    transformed: false,
    padding: sides(24, { top: 96, bottom: 96 }),
    margin: sides(0, { top: -8, bottom: -8 }),
    border: sides(0),
    minWidth: '320px',
    maxWidth: '1200px',
    minHeight: '0px',
    maxHeight: 'none',
    flex: null,
    grid: {
      templateColumns: '368px 368px 368px',
      templateRows: '244.5px',
      autoFlow: 'row',
      rowGap: 32,
      columnGap: 48,
      itemPlacement: { column: 'span 2 / auto', row: 'auto / auto' },
    },
    position: 'static',
    inset: sides('auto'),
    zIndex: 'auto',
    sourceExpressions: {
      'max-width': 'clamp(320px, 90vw, 1200px)',
      'font-size': 'clamp(1rem, 2vw, 1.25rem)',
    },
  },
  typography: null,
  surfaces: {
    backgroundColor: color('rgb(250, 250, 250)', { hex: '#fafafa' }),
    backgroundLayers: [],
    borderColor: sides(color('rgb(228, 228, 231)', { hex: '#e4e4e7' })),
    borderWidth: sides(0, { top: 1 }),
    borderStyle: sides('none', { top: 'solid' }),
    radius: corners('0px'),
    boxShadow: ['none'],
    textShadow: [],
    opacity: 1,
    filter: 'none',
    backdropFilter: 'none',
    fill: null,
    stroke: null,
  },
  assets: [],
  limitations: [],
};

export function elementReference(
  snapshot: ElementSnapshot,
  overrides: Partial<SavedReference> = {},
): SavedReference {
  return {
    id: `ref-${snapshot.id}`,
    schemaVersion: SCHEMA_VERSION,
    kind: 'element',
    title: 'Hero typography',
    note: 'Large heading balanced by a narrow text column.',
    createdAt: '2026-09-18T10:31:00.000Z',
    updatedAt: '2026-09-18T10:31:00.000Z',
    snapshot,
    screenshotId: null,
    screenshotIsCrop: null,
    ...overrides,
  } as SavedReference;
}
