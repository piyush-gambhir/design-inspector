// Closest-standard Tailwind suggestions (PRD EXP-02 mode 2).
//
// This mode answers "which stock utilities come nearest to what the page
// actually renders", and it is built on top of the faithful mode rather than
// beside it: every class the faithful exporter emits is either replaced by a
// default-theme utility or kept as-is, and `unsupportedCss` is passed straight
// through. Nothing can be silently dropped, because nothing new is enumerated
// here.
//
// What counts as a deviation: any property whose emitted class is not an exact
// standard utility for the observed value. That is two cases, and `delta` says
// which one:
// - a standard step was accepted, and `delta` is how far it moves the value
//   (e.g. `-3.6px`);
// - no standard step was close enough, the arbitrary value was kept, and
//   `delta` names the nearest standard step and its distance.
import type { ColorValue, ElementSnapshot } from '@/lib/contracts';
import type { StyleCategory } from './css';
import { collapseWhitespace, num } from './format';
import { toTailwind } from './tailwind';
import {
  BORDER_RADII,
  BORDER_WIDTHS,
  FONT_SIZES,
  FONT_WEIGHTS,
  LETTER_SPACINGS,
  LINE_HEIGHT_LENGTHS,
  LINE_HEIGHT_RATIOS,
  OPACITIES,
  PALETTE,
  SHADOWS,
  SPACING,
  Z_INDICES,
  type PaletteColor,
  type ScaleStep,
  type ShadowLayer,
} from './tailwind-theme';

export interface TailwindClosestOutput {
  /** Space-separated standard utilities from the default theme. */
  classes: string;
  /** Per property: what was observed, what the class produces, and the delta. */
  deviations: { property: string; observed: string; suggested: string; delta: string }[];
  /** Properties with no standard utility close enough; emitted as CSS. */
  unsupportedCss: string;
  /** e.g. 'Tailwind v4 default theme; classes within 12.5 percent of the observed value.' */
  assumption: string;
}

/** A standard step is accepted inside this fraction of the observed value. */
const TOLERANCE = 0.125;
/** Below this, a px value gets a flat 1px tolerance instead of a fraction. */
const SMALL_PX = 8;
const SMALL_PX_TOLERANCE = 1;
/** Oklab distance under which a palette color is close enough to name. */
const COLOR_TOLERANCE = 0.02;
/** Shadow layers match when every offset is inside this many px. */
const SHADOW_PX_TOLERANCE = 1;
const SHADOW_ALPHA_TOLERANCE = 0.02;
/** A radius at or above this is Tailwind's `rounded-full`. */
const FULL_RADIUS_PX = 9999;

export function toTailwindClosest(
  snapshot: ElementSnapshot,
  category: StyleCategory,
): TailwindClosestOutput {
  const faithful = toTailwind(snapshot, category);
  const context: Context = {
    snapshot,
    colors: colorIndex(snapshot),
    fontSizePx: snapshot.typography?.sizePx ?? null,
  };

  const classes: string[] = [];
  const deviations: TailwindClosestOutput['deviations'] = [];
  const seen = new Set<string>();

  for (const original of faithful.classes.split(' ').filter((entry) => entry !== '')) {
    const mapped = mapClass(original, context);
    if (!seen.has(mapped.className)) {
      seen.add(mapped.className);
      classes.push(mapped.className);
    }
    if (mapped.deviation) deviations.push(mapped.deviation);
  }

  return {
    classes: classes.join(' '),
    deviations,
    unsupportedCss: faithful.unsupportedCss,
    assumption:
      'Tailwind v4 default theme. A standard utility is used when it lands within 12.5 percent of the observed value (1px for px values under 8px) and, for colors, within an oklch distance of 0.02; everything else keeps the observed value as an arbitrary class. Every size class is paired with an explicit leading-* because the theme couples a line height to each text size. No responsive prefixes are inferred from one viewport.',
  };
}

// ---------------------------------------------------------------------------

interface Context {
  snapshot: ElementSnapshot;
  /** Arbitrary-value token as the faithful exporter wrote it, to its color. */
  colors: Map<string, ColorValue>;
  fontSizePx: number | null;
}

interface Mapped {
  className: string;
  deviation: TailwindClosestOutput['deviations'][number] | null;
}

/** Matches `prefix-[value]`; the prefix is everything before the last bracket. */
const ARBITRARY = /^([a-z0-9-]+)-\[(.+)\]$/;

function mapClass(original: string, context: Context): Mapped {
  const match = ARBITRARY.exec(original);
  // A class without an arbitrary value already is a standard utility.
  if (!match) return { className: original, deviation: null };

  const prefix = match[1] as string;
  const value = match[2] as string;

  const color = context.colors.get(value);
  if (color) return mapColor(original, prefix, color);

  if (prefix === 'shadow') return mapShadow(original, context);
  if (prefix === 'font') return mapFont(original, value);
  if (prefix === 'leading') return mapLineHeight(original, value, context);
  if (prefix === 'tracking') return mapTracking(original, value, context);
  if (prefix === 'opacity') return mapUnitless(original, prefix, value, OPACITIES, 'opacity');
  if (prefix === 'z') return mapUnitless(original, prefix, value, Z_INDICES, 'z-index');
  if (prefix === 'text') return mapFontSize(original, value);
  if (RADIUS_PREFIXES.has(prefix)) return mapRadius(original, prefix, value);
  if (BORDER_PREFIXES.has(prefix)) return mapBorderWidth(original, prefix, value);
  if (SPACING_PREFIXES.has(prefix)) return mapSpacing(original, prefix, value);

  return {
    className: original,
    deviation: {
      property: propertyFor(prefix),
      observed: readable(value),
      suggested: original,
      delta: 'the default theme has no utility for this value, so it is kept as an arbitrary class',
    },
  };
}

// ---------------------------------------------------------------------------
// Prefix groups

const SPACING_PREFIXES = new Set([
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  'w', 'h', 'min-w', 'max-w', 'min-h', 'max-h',
  'gap', 'gap-x', 'gap-y',
  'top', 'right', 'bottom', 'left', 'inset', 'inset-x', 'inset-y',
]);

const RADIUS_PREFIXES = new Set([
  'rounded', 'rounded-t', 'rounded-r', 'rounded-b', 'rounded-l',
  'rounded-tl', 'rounded-tr', 'rounded-br', 'rounded-bl',
]);

const BORDER_PREFIXES = new Set([
  'border', 'border-t', 'border-r', 'border-b', 'border-l', 'border-x', 'border-y',
]);

const PROPERTY_NAMES: Record<string, string> = {
  p: 'padding', px: 'padding inline', py: 'padding block',
  pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left',
  m: 'margin', mx: 'margin inline', my: 'margin block',
  mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left',
  w: 'width', h: 'height',
  'min-w': 'min-width', 'max-w': 'max-width', 'min-h': 'min-height', 'max-h': 'max-height',
  gap: 'gap', 'gap-x': 'column-gap', 'gap-y': 'row-gap',
  top: 'top', right: 'right', bottom: 'bottom', left: 'left',
  inset: 'inset', 'inset-x': 'inset-inline', 'inset-y': 'inset-block',
  rounded: 'border-radius',
  'rounded-t': 'border-radius top', 'rounded-r': 'border-radius right',
  'rounded-b': 'border-radius bottom', 'rounded-l': 'border-radius left',
  'rounded-tl': 'border-top-left-radius', 'rounded-tr': 'border-top-right-radius',
  'rounded-br': 'border-bottom-right-radius', 'rounded-bl': 'border-bottom-left-radius',
  border: 'border-width',
  'border-t': 'border-top-width', 'border-r': 'border-right-width',
  'border-b': 'border-bottom-width', 'border-l': 'border-left-width',
  'border-x': 'border-inline-width', 'border-y': 'border-block-width',
  text: 'font-size', leading: 'line-height', tracking: 'letter-spacing',
  opacity: 'opacity', z: 'z-index', shadow: 'box-shadow',
  'grid-cols': 'grid-template-columns', 'grid-rows': 'grid-template-rows',
};

const COLOR_PROPERTIES: Record<string, string> = {
  text: 'color',
  bg: 'background-color',
  border: 'border-color',
  'border-t': 'border-top-color', 'border-r': 'border-right-color',
  'border-b': 'border-bottom-color', 'border-l': 'border-left-color',
  fill: 'fill', stroke: 'stroke', shadow: 'box-shadow color',
};

function propertyFor(prefix: string): string {
  return PROPERTY_NAMES[prefix] ?? prefix;
}

// ---------------------------------------------------------------------------
// Scales

function mapSpacing(original: string, prefix: string, value: string): Mapped {
  const observed = lengthPx(value);
  if (observed === null) return keep(original, prefix, value);
  const negative = observed < 0;
  const magnitude = Math.abs(observed);
  const best = nearest(SPACING, magnitude);
  if (!best) return keep(original, prefix, value);
  const produced = negative ? -best.value : best.value;
  const className = `${negative ? '-' : ''}${prefix}-${best.suffix}`;
  return decide(original, prefix, observed, produced, className, 'px', `${prefix}-${best.suffix}`);
}

function mapFontSize(original: string, value: string): Mapped {
  const observed = lengthPx(value);
  if (observed === null) return keep(original, 'text', value);
  const best = nearest(FONT_SIZES, observed);
  if (!best) return keep(original, 'text', value);
  return decide(original, 'text', observed, best.value, `text-${best.suffix}`, 'px', `text-${best.suffix}`);
}

function mapRadius(original: string, prefix: string, value: string): Mapped {
  const observed = lengthPx(value);
  if (observed === null) return keep(original, prefix, value);
  // A radius this large is a pill, which is exactly what `rounded-full` means,
  // so it is an equivalent class rather than an approximation.
  if (observed >= FULL_RADIUS_PX) return { className: `${prefix}-full`, deviation: null };
  const best = nearest(BORDER_RADII, observed);
  if (!best) return keep(original, prefix, value);
  const className = `${prefix}-${best.suffix}`;
  return decide(original, prefix, observed, best.value, className, 'px', className);
}

function mapBorderWidth(original: string, prefix: string, value: string): Mapped {
  const observed = lengthPx(value);
  if (observed === null) return keep(original, prefix, value);
  const best = nearest(BORDER_WIDTHS, observed);
  if (!best) return keep(original, prefix, value);
  // Width 1 is the bare `border` class, with no numeric suffix.
  const className = best.suffix === '' ? prefix : `${prefix}-${best.suffix}`;
  return decide(original, prefix, observed, best.value, className, 'px', className);
}

function mapUnitless(
  original: string,
  prefix: string,
  value: string,
  steps: ScaleStep[],
  property: string,
): Mapped {
  const observed = Number.parseFloat(value);
  if (!Number.isFinite(observed)) return keep(original, prefix, value);
  const best = nearest(steps, observed);
  if (!best) return keep(original, prefix, value);
  const className = `${prefix}-${best.suffix}`;
  return decide(original, property, observed, best.value, className, '', className);
}

function mapFont(original: string, value: string): Mapped {
  const weight = Number.parseFloat(value);
  if (!Number.isFinite(weight) || !/^\d+$/.test(value)) {
    // The default theme only ships font-sans, font-serif and font-mono, and
    // guessing which one a page's family belongs to would be an invention.
    return {
      className: original,
      deviation: {
        property: 'font-family',
        observed: readable(value),
        suggested: original,
        delta: 'the default theme has no utility for this family, so it is kept as an arbitrary class',
      },
    };
  }
  const best = nearest(FONT_WEIGHTS, weight);
  if (!best) return keep(original, 'font', value);
  const className = `font-${best.suffix}`;
  return decide(original, 'font-weight', weight, best.value, className, '', className);
}

/**
 * Line height is matched in px against both scales at once: the numeric
 * `leading-3` to `leading-10` steps and the named ratios resolved against this
 * element's font size. A tie prefers the named class, which reads better.
 */
function mapLineHeight(original: string, value: string, context: Context): Mapped {
  const observed = lengthPx(value);
  if (observed === null) return keep(original, 'leading', value);

  const candidates: { className: string; produced: number }[] = LINE_HEIGHT_LENGTHS.map((step) => ({
    className: `leading-${step.suffix}`,
    produced: step.value,
  }));
  const sizePx = context.fontSizePx;
  if (sizePx !== null && sizePx > 0) {
    for (const step of LINE_HEIGHT_RATIOS) {
      candidates.unshift({ className: `leading-${step.suffix}`, produced: step.value * sizePx });
    }
  }

  const best = nearestCandidate(candidates, observed);
  if (!best) return keep(original, 'leading', value);
  return decide(original, 'line-height', observed, best.produced, best.className, 'px', best.className);
}

/** Letter spacing is matched in px so the same tolerance rule applies. */
function mapTracking(original: string, value: string, context: Context): Mapped {
  const observed = lengthPx(value);
  if (observed === null) return keep(original, 'tracking', value);
  const sizePx = context.fontSizePx;
  if (sizePx === null || sizePx <= 0) return keep(original, 'tracking', value);

  const candidates = LETTER_SPACINGS.map((step) => ({
    className: `tracking-${step.suffix}`,
    produced: step.value * sizePx,
  }));
  const best = nearestCandidate(candidates, observed);
  if (!best) return keep(original, 'tracking', value);
  return decide(
    original,
    'letter-spacing',
    observed,
    best.produced,
    best.className,
    'px',
    best.className,
  );
}

function mapColor(original: string, prefix: string, color: ColorValue): Mapped {
  const property = COLOR_PROPERTIES[prefix] ?? propertyFor(prefix);
  const observed = color.hex ?? color.raw;
  const match = nearestPaletteColor(color);

  if (match && match.distance <= COLOR_TOLERANCE) {
    const className = `${prefix}-${match.color.name}`;
    if (match.distance === 0) return { className, deviation: null };
    return {
      className,
      deviation: {
        property,
        observed,
        suggested: className,
        delta: `oklch distance ${num(match.distance)}`,
      },
    };
  }

  const reason =
    color.alpha < 1
      ? 'the color is translucent, and an opacity modifier would be a guess'
      : match
        ? `the nearest palette color ${match.color.name} is an oklch distance of ${num(match.distance)} away`
        : 'the color could not be compared in oklch';
  return {
    className: original,
    deviation: { property, observed, suggested: original, delta: reason },
  };
}

function mapShadow(original: string, context: Context): Mapped {
  const observed = context.snapshot.surfaces.boxShadow
    .map((layer) => collapseWhitespace(layer))
    .filter((layer) => layer !== '' && layer.toLowerCase() !== 'none');
  const parsed = observed.map((layer) => parseShadowLayer(layer));
  const summary = observed.join(', ');

  if (parsed.some((layer) => layer === null)) {
    return {
      className: original,
      deviation: {
        property: 'box-shadow',
        observed: summary,
        suggested: original,
        delta: 'the shadow could not be compared with the default theme, so it is kept verbatim',
      },
    };
  }
  const layers = parsed as ShadowLayer[];

  let best: { suffix: string; drift: number } | null = null;
  for (const step of SHADOWS) {
    const drift = shadowDrift(layers, step.layers);
    if (drift === null) continue;
    if (!best || drift < best.drift) best = { suffix: step.suffix, drift };
  }
  if (!best) {
    return {
      className: original,
      deviation: {
        property: 'box-shadow',
        observed: summary,
        suggested: original,
        delta: 'no default shadow matches these layers, so the observed shadow is kept verbatim',
      },
    };
  }

  const className = `shadow-${best.suffix}`;
  return {
    className,
    deviation:
      best.drift === 0
        ? null
        : {
            property: 'box-shadow',
            observed: summary,
            suggested: className,
            delta: `largest offset difference ${num(best.drift)}px`,
          },
  };
}

// ---------------------------------------------------------------------------
// Shared decision helpers

/**
 * Accept the nearest step when it lands inside the tolerance, otherwise keep
 * the faithful arbitrary class and say how far the nearest step was.
 */
function decide(
  original: string,
  property: string,
  observed: number,
  produced: number,
  className: string,
  unit: 'px' | '',
  standardName: string,
): Mapped {
  const difference = produced - observed;
  if (!withinTolerance(observed, produced, unit)) {
    return {
      className: original,
      deviation: {
        property: propertyFor(property),
        observed: format(observed, unit),
        suggested: original,
        delta: `nearest standard ${standardName} is ${signed(difference, unit)}, outside the threshold`,
      },
    };
  }
  if (difference === 0) return { className, deviation: null };
  return {
    className,
    deviation: {
      property: propertyFor(property),
      observed: format(observed, unit),
      suggested: `${className} (${format(produced, unit)})`,
      delta: signed(difference, unit),
    },
  };
}

export function withinTolerance(observed: number, candidate: number, unit: 'px' | ''): boolean {
  const difference = Math.abs(candidate - observed);
  if (observed === 0) return candidate === 0;
  if (unit === 'px' && Math.abs(observed) < SMALL_PX) return difference <= SMALL_PX_TOLERANCE;
  return difference <= Math.abs(observed) * TOLERANCE;
}

function keep(original: string, prefix: string, value: string): Mapped {
  return {
    className: original,
    deviation: {
      property: propertyFor(prefix),
      observed: readable(value),
      suggested: original,
      delta: 'the value could not be compared with the default theme, so it is kept verbatim',
    },
  };
}

function nearest(steps: ScaleStep[], observed: number): ScaleStep | null {
  let best: ScaleStep | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const step of steps) {
    const distance = Math.abs(step.value - observed);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

function nearestCandidate(
  candidates: { className: string; produced: number }[],
  observed: number,
): { className: string; produced: number } | null {
  let best: { className: string; produced: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.produced - observed);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Colors

interface OklchTriple {
  l: number;
  c: number;
  h: number;
}

/**
 * The colors this snapshot actually carries, keyed by the token the faithful
 * exporter writes for them. This is how a `text-[...]` class is told apart from
 * a `text-[16px]` one without re-parsing CSS colors here.
 */
function colorIndex(snapshot: ElementSnapshot): Map<string, ColorValue> {
  const index = new Map<string, ColorValue>();
  const add = (color: ColorValue | null): void => {
    if (!color) return;
    index.set(colorToken(color), color);
  };
  add(snapshot.typography?.color ?? null);
  add(snapshot.surfaces.backgroundColor);
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    add(snapshot.surfaces.borderColor[side]);
  }
  add(snapshot.surfaces.fill);
  add(snapshot.surfaces.stroke);
  return index;
}

/** The same encoding `toTailwind` uses, so the tokens line up exactly. */
function colorToken(color: ColorValue): string {
  if (color.hex && !color.lossy && color.alpha >= 1) return color.hex;
  return collapseWhitespace(color.raw).replace(/ /g, '_');
}

export function parseOklch(text: string | null): OklchTriple | null {
  if (!text) return null;
  const match = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([-\d.]+)/i.exec(text);
  if (!match) return null;
  const lightness = Number.parseFloat(match[1] as string);
  const chroma = Number.parseFloat(match[3] as string);
  const hue = Number.parseFloat(match[4] as string);
  if (!Number.isFinite(lightness) || !Number.isFinite(chroma) || !Number.isFinite(hue)) return null;
  return { l: match[2] === '%' ? lightness / 100 : lightness, c: chroma, h: hue };
}

/** Straight-line distance in oklab, the honest way to compare two oklch colors. */
export function oklchDistance(a: OklchTriple, b: OklchTriple): number {
  const aRadians = (a.h * Math.PI) / 180;
  const bRadians = (b.h * Math.PI) / 180;
  const dl = a.l - b.l;
  const da = a.c * Math.cos(aRadians) - b.c * Math.cos(bRadians);
  const db = a.c * Math.sin(aRadians) - b.c * Math.sin(bRadians);
  return Math.sqrt(dl * dl + da * da + db * db);
}

export function nearestPaletteColor(
  color: ColorValue,
): { color: PaletteColor; distance: number } | null {
  // Tailwind expresses a translucent color with an opacity modifier, which
  // would be a second guess on top of the hue match, so it is not attempted.
  if (color.alpha < 1) return null;
  const observed = parseOklch(color.oklch);
  if (!observed) return null;

  let best: { color: PaletteColor; distance: number } | null = null;
  for (const candidate of PALETTE) {
    const distance = oklchDistance(observed, candidate);
    if (!best || distance < best.distance) best = { color: candidate, distance };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Shadows

const SHADOW_COLOR = /rgba?\([^)]*\)|#[0-9a-f]{3,8}|oklch\([^)]*\)|hsla?\([^)]*\)/i;

export function parseShadowLayer(layer: string): ShadowLayer | null {
  const text = collapseWhitespace(layer);
  const inset = /\binset\b/i.test(text);
  const colorMatch = SHADOW_COLOR.exec(text);
  const alpha = colorMatch ? alphaOf(colorMatch[0]) : 1;
  const rest = (colorMatch ? text.replace(colorMatch[0], ' ') : text).replace(/\binset\b/gi, ' ');
  const numbers = rest.match(/-?\d*\.?\d+/g);
  if (!numbers || numbers.length < 2) return null;
  const values = numbers.map((entry) => Number.parseFloat(entry));
  if (values.some((value) => !Number.isFinite(value))) return null;
  return {
    offsetX: values[0] as number,
    offsetY: values[1] as number,
    blur: values[2] ?? 0,
    spread: values[3] ?? 0,
    alpha,
    inset,
  };
}

function alphaOf(color: string): number {
  const slash = /\/\s*([\d.]+)%?\s*\)/.exec(color);
  if (slash) {
    const value = Number.parseFloat(slash[1] as string);
    return color.includes('%') && slash[0].includes('%') ? value / 100 : value;
  }
  const rgba = /rgba?\(([^)]*)\)/i.exec(color);
  if (rgba) {
    const parts = (rgba[1] as string).split(',').map((part) => part.trim());
    if (parts.length === 4) {
      const value = Number.parseFloat(parts[3] as string);
      return Number.isFinite(value) ? value : 1;
    }
  }
  if (/^#[0-9a-f]{8}$/i.test(color)) {
    return Number.parseInt(color.slice(7, 9), 16) / 255;
  }
  return 1;
}

/** The largest px difference between two shadow stacks, or null when they differ in shape. */
function shadowDrift(observed: ShadowLayer[], theme: ShadowLayer[]): number | null {
  if (observed.length !== theme.length) return null;
  let drift = 0;
  for (let index = 0; index < observed.length; index += 1) {
    const a = observed[index] as ShadowLayer;
    const b = theme[index] as ShadowLayer;
    if (a.inset !== b.inset) return null;
    if (Math.abs(a.alpha - b.alpha) > SHADOW_ALPHA_TOLERANCE) return null;
    for (const key of ['offsetX', 'offsetY', 'blur', 'spread'] as const) {
      const difference = Math.abs(a[key] - b[key]);
      if (difference > SHADOW_PX_TOLERANCE) return null;
      if (difference > drift) drift = difference;
    }
  }
  return drift;
}

// ---------------------------------------------------------------------------
// Formatting

/** A single px length, or null when the token is not one. */
function lengthPx(value: string): number | null {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  if (match) {
    const parsed = Number.parseFloat(match[1] as string);
    return Number.isFinite(parsed) ? parsed : null;
  }
  // `top-[0px]` can also arrive as a bare `0`.
  const bare = /^(-?\d*\.?\d+)$/.exec(value.trim());
  if (bare && Number.parseFloat(bare[1] as string) === 0) return 0;
  return null;
}

function format(value: number, unit: 'px' | ''): string {
  return unit === 'px' ? `${num(value)}px` : num(value);
}

function signed(value: number, unit: 'px' | ''): string {
  const body = format(Math.abs(value), unit);
  return `${value < 0 ? '-' : '+'}${body}`;
}

/** Arbitrary values use underscores for spaces; undo that for display. */
function readable(value: string): string {
  return value.replace(/_/g, ' ');
}
