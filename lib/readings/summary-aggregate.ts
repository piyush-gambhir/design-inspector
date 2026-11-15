








import type {
  ColorGroup,
  ColorRole,
  ColorValue,
  Corners,
  ElementScanRecord,
  ExampleRef,
  FontRecord,
  PageSummary,
  PaletteCluster,
  RadiusGroup,
  ScanScope,
  ShadowGroup,
  SizeScaleEntry,
  SourceContext,
  SpacingSummary,
  StackReport,
  TypographyGroup,
  ValueCount,
} from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';
import { parseColor } from './color';

export interface AggregateInput {
  records: ElementScanRecord[];
  fonts: FontRecord[];
  stack: StackReport;
  source: SourceContext;
  scope: ScanScope;
}






const MAX_EXAMPLES = 24;


const MAX_SAMPLE = 60;


const MAX_ACCENTS = 3;


const OKLCH_CHROMA_THRESHOLD = 0.08;
const HEX_SATURATION_THRESHOLD = 0.35;

const ROLE_ORDER: ColorRole[] = [
  'text',
  'background',
  'border',
  'fill',
  'stroke',
  'gradient-stop',
];

const COLOR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'oklch']);


const GRADIENT_PREFIX = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

export function aggregateSummary(input: AggregateInput): PageSummary {
  const steps = aggregateSummarySteps(input);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}


export function* aggregateSummarySteps(input: AggregateInput): Generator<void, PageSummary> {
  const { records } = input;
  const colors = buildColors(records);
  yield;
  const typography = buildTypography(records);
  yield;
  const sizeScale = buildSizeScale(records);
  yield;
  const paletteClusters = clusterPalette(colors);
  yield;
  const spacing = buildSpacing(records);
  yield;
  const fonts = buildFonts(input.fonts, records);
  yield;
  const radii = buildRadii(records);
  yield;
  const shadows = buildShadows(records);
  return {
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    source: input.source,
    scope: input.scope,
    typography,
    sizeScale,
    colors,
    paletteClusters,
    spacing,
    fonts,
    radii,
    shadows,
    stack: input.stack,
    limitations: buildLimitations(input.scope),
  };
}




function buildTypography(records: ElementScanRecord[]): TypographyGroup[] {
  const groups = new Map<string, TypographyGroup>();



  for (const record of records) {
    if (!record.hasOwnText || !record.typography) continue;
    const typo = record.typography;
    const key = [
      typo.familyReading,
      typo.weight,
      typo.style,
      typo.sizePx,
      typo.lineHeightRaw,
      typo.letterSpacingRaw,
    ].join('|');

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        familyReading: typo.familyReading,
        familyConfidence: typo.familyConfidence,
        weight: typo.weight,
        style: typo.style,
        sizePx: typo.sizePx,
        lineHeightRaw: typo.lineHeightRaw,
        letterSpacingRaw: typo.letterSpacingRaw,
        count: 0,
        sample: '',
        examples: [],
      };
      groups.set(key, group);
    }

    group.count += 1;
    if (group.sample === '') {
      const sample = collapseWhitespace(typo.sample);
      if (sample !== '') group.sample = sample.slice(0, MAX_SAMPLE);
    }
    pushExample(group.examples, record);
  }

  return [...groups.values()].sort(
    (a, b) => b.sizePx - a.sizePx || b.count - a.count || cmp(a.key, b.key),
  );
}

function buildSizeScale(records: ElementScanRecord[]): SizeScaleEntry[] {
  const counts = new Map<number, number>();
  for (const record of records) {
    if (!record.hasOwnText || !record.typography) continue;
    const size = round2(record.typography.sizePx);
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([sizePx, count]): SizeScaleEntry => ({ sizePx, count }))
    .sort((a, b) => b.sizePx - a.sizePx);
}




function buildColors(records: ElementScanRecord[]): ColorGroup[] {
  const groups = new Map<string, ColorGroup>();

  const add = (role: ColorRole, color: ColorValue, record: ElementScanRecord): void => {
    const key = colorKey(color);
    const id = `${role}|${key}`;
    let group = groups.get(id);
    if (!group) {
      group = { role, color, key, count: 0, inferredRole: null, examples: [] };
      groups.set(id, group);
    }
    group.count += 1;
    pushExample(group.examples, record);
  };

  for (const record of records) {
    if (record.hasOwnText && record.typography) {
      add('text', record.typography.color, record);
    }
    if (record.backgroundColor) add('background', record.backgroundColor, record);
    for (const border of record.borderColors) add('border', border, record);
    if (record.fill) add('fill', record.fill, record);
    if (record.stroke) add('stroke', record.stroke, record);
    for (const layer of record.backgroundLayers) {
      const trimmed = layer.trim();
      if (!GRADIENT_PREFIX.test(trimmed)) continue;
      for (const stop of extractGradientColors(trimmed)) add('gradient-stop', stop, record);
    }
  }

  const all = [...groups.values()];
  inferAccents(all);
  return all.sort(
    (a, b) =>
      b.count - a.count ||
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      cmp(a.key, b.key),
  );
}


interface AccentCandidate {
  key: string;
  color: ColorValue;
  count: number;
}








function inferRoles(candidates: AccentCandidate[]): Map<string, 'accent' | 'neutral'> {
  const roles = new Map<string, 'accent' | 'neutral'>();
  if (candidates.length === 0) return roles;

  const median = medianOf(candidates.map((candidate) => candidate.count));
  const colorful: AccentCandidate[] = [];

  for (const candidate of candidates) {
    const nonNeutral = isNonNeutral(candidate.color);
    if (nonNeutral === null) continue;
    if (!nonNeutral) {
      roles.set(candidate.key, 'neutral');
      continue;
    }
    if (candidate.count < median) colorful.push(candidate);
  }

  colorful
    .sort((a, b) => b.count - a.count || cmp(a.key, b.key))
    .slice(0, MAX_ACCENTS)
    .forEach((candidate) => {
      roles.set(candidate.key, 'accent');
    });

  return roles;
}






function inferAccents(groups: ColorGroup[]): void {
  const candidates = groups.filter((g) => g.role === 'text' || g.role === 'background');

  const roles = inferRoles(
    candidates.map((group, index) => ({
      key: `${index}|${group.key}`,
      color: group.color,
      count: group.count,
    })),
  );
  candidates.forEach((group, index) => {
    group.inferredRole = roles.get(`${index}|${group.key}`) ?? null;
  });
}


function isNonNeutral(color: ColorValue): boolean | null {
  if (color.oklch) {
    const chroma = oklchChroma(color.oklch);
    if (chroma !== null) return chroma > OKLCH_CHROMA_THRESHOLD;
  }
  if (color.hex) {
    const saturation = hexSaturation(color.hex);
    if (saturation !== null) return saturation > HEX_SATURATION_THRESHOLD;
  }
  return null;
}

function oklchChroma(value: string): number | null {
  const inner = value.slice(value.indexOf('(') + 1);
  const parts = inner.replace(/[/)]/g, ' ').trim().split(/[\s,]+/);
  const chroma = parts[1];
  if (chroma === undefined) return null;
  const parsed = Number.parseFloat(chroma);
  return Number.isFinite(parsed) ? parsed : null;
}


function hexSaturation(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  const denominator = 1 - Math.abs(2 * lightness - 1);
  return denominator === 0 ? 0 : (max - min) / denominator;
}













export const CLUSTER_LIGHTNESS = 0.04;
export const CLUSTER_CHROMA = 0.03;
export const CLUSTER_HUE_DEGREES = 8;

export const CLUSTER_GREY_CHROMA = 0.02;

export interface OklchCoords {
  l: number;
  c: number;
  h: number;
}





export type { PaletteCluster };







export function oklchCoords(color: ColorValue): OklchCoords | null {
  const direct = parseOklch(color.oklch);
  if (direct) return direct;
  if (color.hex) {
    const fromHex = parseOklch(parseColor(color.hex).oklch);
    if (fromHex) return fromHex;
  }
  return parseOklch(parseColor(color.raw).oklch);
}


export function colorsAreNear(a: ColorValue, b: ColorValue): boolean {
  const first = oklchCoords(a);
  const second = oklchCoords(b);
  if (!first || !second) return false;
  return coordsAreNear(first, second);
}

function coordsAreNear(a: OklchCoords, b: OklchCoords): boolean {
  if (Math.abs(a.l - b.l) > CLUSTER_LIGHTNESS) return false;
  if (Math.abs(a.c - b.c) > CLUSTER_CHROMA) return false;

  if (a.c < CLUSTER_GREY_CHROMA || b.c < CLUSTER_GREY_CHROMA) return true;
  return hueDistance(a.h, b.h) <= CLUSTER_HUE_DEGREES;
}

function hueDistance(a: number, b: number): number {
  const delta = Math.abs(((a - b) % 360) + 360) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function parseOklch(value: string | null): OklchCoords | null {
  if (!value) return null;
  const open = value.indexOf('(');
  if (open < 0) return null;
  const inner = value.slice(open + 1, matchParen(value, open));
  const [head = ''] = inner.split('/');
  const parts = head
    .trim()
    .split(/[\s,]+/)
    .filter((part) => part !== '');
  const [lightness, chroma, hue] = parts;
  if (lightness === undefined || chroma === undefined) return null;

  const l = percentOrNumber(lightness, 1);
  const c = percentOrNumber(chroma, 0.4);
  if (l === null || c === null) return null;
  const parsedHue = hue === undefined ? 0 : Number.parseFloat(hue);
  return { l, c, h: Number.isFinite(parsedHue) ? parsedHue : 0 };
}


function percentOrNumber(part: string, full: number): number | null {
  const value = Number.parseFloat(part);
  if (!Number.isFinite(value)) return null;
  return part.trim().endsWith('%') ? (value / 100) * full : value;
}

interface MutableCluster {
  key: string;
  coords: OklchCoords | null;
  members: ColorGroup[];
  totalCount: number;
}






export function clusterPalette(colors: ColorGroup[]): PaletteCluster[] {

  const ordered = [...colors].sort((a, b) => b.count - a.count || cmp(a.key, b.key));
  const clusters: MutableCluster[] = [];

  for (const group of ordered) {
    const coords = oklchCoords(group.color);
    const match = clusters.find(
      (cluster) =>
        cluster.key === group.key ||
        (coords !== null && cluster.coords !== null && coordsAreNear(cluster.coords, coords)),
    );
    if (match) {
      match.members.push(group);
      match.totalCount += group.count;
      continue;
    }
    clusters.push({ key: group.key, coords, members: [group], totalCount: group.count });
  }

  const built: PaletteCluster[] = clusters.map((cluster) => {
    const representative = cluster.members[0] as ColorGroup;
    const roles = ROLE_ORDER.filter((role) =>
      cluster.members.some((member) => member.role === role),
    );
    return {
      key: cluster.key,
      representative,
      members: cluster.members,
      totalCount: cluster.totalCount,
      roles,
      inferredRole: null,
    };
  });



  const roles = inferRoles(
    built
      .filter((cluster) => cluster.roles.includes('text') || cluster.roles.includes('background'))
      .map((cluster) => ({
        key: cluster.key,
        color: cluster.representative.color,
        count: cluster.totalCount,
      })),
  );
  for (const cluster of built) {
    cluster.inferredRole = roles.get(cluster.key) ?? null;
  }

  return built.sort((a, b) => b.totalCount - a.totalCount || cmp(a.key, b.key));
}


export function clusterRoleCounts(cluster: PaletteCluster): { role: ColorRole; count: number }[] {
  return ROLE_ORDER.map((role) => ({
    role,
    count: cluster.members
      .filter((member) => member.role === role)
      .reduce((total, member) => total + member.count, 0),
  })).filter((entry) => entry.count > 0);
}




export interface TypographyScaleStep {
  sizePx: number;

  count: number;
  combinations: TypographyGroup[];
}






export function groupTypographyByScale(groups: TypographyGroup[]): TypographyScaleStep[] {
  const steps = new Map<number, TypographyScaleStep>();
  for (const group of groups) {
    const sizePx = round2(group.sizePx);
    let step = steps.get(sizePx);
    if (!step) {
      step = { sizePx, count: 0, combinations: [] };
      steps.set(sizePx, step);
    }
    step.count += group.count;
    step.combinations.push(group);
  }
  return [...steps.values()].sort((a, b) => b.sizePx - a.sizePx);
}




function buildSpacing(records: ElementScanRecord[]): SpacingSummary {
  const padding = new Map<number, ValueCount>();
  const margin = new Map<number, ValueCount>();
  const gap = new Map<number, ValueCount>();

  const add = (target: Map<number, ValueCount>, value: number, record: ElementScanRecord): void => {
    const valuePx = round2(value);
    let entry = target.get(valuePx);
    if (!entry) {
      entry = { valuePx, count: 0, examples: [] };
      target.set(valuePx, entry);
    }
    entry.count += 1;
    pushExample(entry.examples, record);
  };

  for (const record of records) {

    add(padding, record.padding.top, record);
    add(padding, record.padding.right, record);
    add(padding, record.padding.bottom, record);
    add(padding, record.padding.left, record);
    add(margin, record.margin.top, record);
    add(margin, record.margin.right, record);
    add(margin, record.margin.bottom, record);
    add(margin, record.margin.left, record);
    if (record.gap) {
      add(gap, record.gap.row, record);
      add(gap, record.gap.column, record);
    }
  }

  return {
    padding: sortSpacing(padding),
    margin: sortSpacing(margin),
    gap: sortSpacing(gap),
  };
}


function sortSpacing(values: Map<number, ValueCount>): ValueCount[] {
  const bucket = (value: number): number => (value > 0 ? 0 : value === 0 ? 1 : 2);
  return [...values.values()].sort(
    (a, b) =>
      bucket(a.valuePx) - bucket(b.valuePx) ||
      b.count - a.count ||
      b.valuePx - a.valuePx,
  );
}




function buildFonts(declared: FontRecord[], records: ElementScanRecord[]): FontRecord[] {
  const seen = new Map<string, { display: string; weights: Set<number> }>();

  for (const record of records) {
    if (!record.hasOwnText || !record.typography) continue;
    const family = record.typography.familyReading;
    const key = normalizeFamily(family);
    if (key === '') continue;
    let entry = seen.get(key);
    if (!entry) {
      entry = { display: family.trim(), weights: new Set() };
      seen.set(key, entry);
    }
    entry.weights.add(record.typography.weight);
  }

  const fonts: FontRecord[] = declared.map((font) =>
    seen.has(normalizeFamily(font.family)) ? { ...font, matchedToContent: true } : { ...font },
  );

  for (const [key, entry] of seen) {
    if (fonts.some((font) => normalizeFamily(font.family) === key)) continue;
    fonts.push({
      family: entry.display,
      declared: false,
      loaded: null,
      matchedToContent: true,
      source: { kind: 'unknown', url: null, format: null, subset: null },
      weights: [...entry.weights].sort((a, b) => a - b).map((weight) => String(weight)),
      faces: [],
    });
  }

  return fonts;
}

function normalizeFamily(family: string): string {
  return family.trim().replace(/^["']|["']$/g, '').toLowerCase();
}




function buildRadii(records: ElementScanRecord[]): RadiusGroup[] {
  const groups = new Map<string, RadiusGroup>();
  for (const record of records) {
    const value = serializeCorners(record.radius);
    if (value === null) continue;
    let group = groups.get(value);
    if (!group) {
      group = { value, count: 0, examples: [] };
      groups.set(value, group);
    }
    group.count += 1;
    pushExample(group.examples, record);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || cmp(a.value, b.value));
}


function serializeCorners(radius: Corners<string>): string | null {
  const corners = [radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft].map(
    (corner) => collapseWhitespace(corner),
  );
  if (corners.every((corner) => isZeroLength(corner))) return null;
  const first = corners[0] ?? '';
  return corners.every((corner) => corner === first) ? first : corners.join(' ');
}

function buildShadows(records: ElementScanRecord[]): ShadowGroup[] {
  const groups = new Map<string, ShadowGroup>();
  for (const record of records) {
    for (const entry of record.boxShadow) {
      const value = collapseWhitespace(entry);
      if (value === '' || value.toLowerCase() === 'none') continue;
      let group = groups.get(value);
      if (!group) {
        group = { value, count: 0, examples: [] };
        groups.set(value, group);
      }
      group.count += 1;
      pushExample(group.examples, record);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || cmp(a.value, b.value));
}




function buildLimitations(scope: ScanScope): string[] {
  const limitations: string[] = [];

  if (scope.capped) {
    limitations.push(
      `The scan stopped at its ${scope.cap} element cap, so ${scope.scannedElements} of ${scope.eligibleElements} eligible elements were read.`,
    );
  }
  for (const skipped of scope.skipped) {
    limitations.push(`${skipped.count} elements were skipped: ${skipped.reason}.`);
  }
  if (scope.inaccessibleFrames > 0) {
    limitations.push(
      `${scope.inaccessibleFrames} ${scope.inaccessibleFrames === 1 ? 'frame was' : 'frames were'} inaccessible, so their content is not included.`,
    );
  }
  limitations.push('Counts are element and property occurrences, not visual area.');

  return limitations;
}









function colorKey(color: ColorValue): string {
  if (color.hex) {
    const normalized = normalizeHex(color.hex, color.alpha);
    if (normalized !== null) return normalized;
  }
  return collapseWhitespace(color.raw).toLowerCase();
}

function normalizeHex(hex: string, alpha: number): string | null {
  let digits = hex.trim().toLowerCase().replace(/^#/, '');
  if (digits.length === 3 || digits.length === 4) {
    digits = digits
      .split('')
      .map((digit) => digit + digit)
      .join('');
  }
  if (digits.length !== 6 && digits.length !== 8) return null;
  if (!/^[0-9a-f]+$/.test(digits)) return null;

  const rgb = digits.slice(0, 6);
  if (alpha >= 1) return `#${rgb}`;
  const alphaDigits =
    digits.length === 8 ? digits.slice(6, 8) : byteToHex(Math.round(clamp01(alpha) * 255));
  return `#${rgb}${alphaDigits}`;
}


function extractGradientColors(layer: string): ColorValue[] {
  const open = layer.indexOf('(');
  if (open < 0) return [];
  const close = matchParen(layer, open);
  return scanTopLevelColors(layer.slice(open + 1, close));
}






function scanTopLevelColors(source: string): ColorValue[] {
  const colors: ColorValue[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? '';
    if (char === '#') {
      let end = index + 1;
      while (end < source.length && /[0-9a-fA-F]/.test(source[end] ?? '')) end += 1;
      const token = source.slice(index, end);
      const color = hexToken(token);
      if (color) colors.push(color);
      index = end;
      continue;
    }
    if (/[a-zA-Z-]/.test(char)) {
      let end = index;
      while (end < source.length && /[a-zA-Z0-9-]/.test(source[end] ?? '')) end += 1;
      const name = source.slice(index, end).toLowerCase();
      if (source[end] === '(') {
        const close = matchParen(source, end);
        const token = source.slice(index, close + 1);
        if (COLOR_FUNCTIONS.has(name)) {
          const color = functionToken(name, token);
          if (color) colors.push(color);
        }
        index = close + 1;
        continue;
      }
      index = end;
      continue;
    }
    index += 1;
  }

  return colors;
}

function hexToken(token: string): ColorValue | null {
  const digits = token.slice(1);
  if (![3, 4, 6, 8].includes(digits.length)) return null;
  const rgb = hexToRgb(token);
  if (!rgb) return null;
  return {
    raw: token,
    hex: `#${byteToHex(rgb.r)}${byteToHex(rgb.g)}${byteToHex(rgb.b)}`,
    rgb: null,
    oklch: null,
    alpha: rgb.a,
    lossy: false,
  };
}

function functionToken(name: string, token: string): ColorValue | null {
  const args = parseArgs(token);
  const alpha = args.alpha ?? 1;

  if (name === 'rgb' || name === 'rgba') {
    const [r, g, b] = args.numbers;
    if (r === undefined || g === undefined || b === undefined) return null;
    return {
      raw: token,
      hex: `#${byteToHex(channel(r))}${byteToHex(channel(g))}${byteToHex(channel(b))}`,
      rgb: null,
      oklch: null,
      alpha,
      lossy: false,
    };
  }



  return { raw: token, hex: null, rgb: null, oklch: null, alpha, lossy: false };
}

interface ParsedArgs {
  numbers: number[];
  alpha: number | null;
}


function parseArgs(token: string): ParsedArgs {
  const open = token.indexOf('(');
  const inner = open < 0 ? token : token.slice(open + 1, matchParen(token, open));
  const [head, tail] = inner.split('/');
  const numbers = (head ?? '')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => parseChannel(part));

  let alpha: number | null = null;
  if (tail !== undefined) {
    alpha = parseAlpha(tail);
  } else if (numbers.length === 4) {
    alpha = clamp01(numbers[3] ?? 1);
    numbers.length = 3;
  }

  return { numbers, alpha };
}

function parseChannel(part: string): number {
  const value = Number.parseFloat(part);
  if (!Number.isFinite(value)) return 0;
  return part.trim().endsWith('%') ? (value / 100) * 255 : value;
}

function parseAlpha(part: string): number {
  const trimmed = part.trim();
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return 1;
  return clamp01(trimmed.endsWith('%') ? value / 100 : value);
}

function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string): { r: number; g: number; b: number; a: number } | null {
  let digits = hex.trim().toLowerCase().replace(/^#/, '');
  if (digits.length === 3 || digits.length === 4) {
    digits = digits
      .split('')
      .map((digit) => digit + digit)
      .join('');
  }
  if (digits.length !== 6 && digits.length !== 8) return null;
  if (!/^[0-9a-f]+$/.test(digits)) return null;
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  const a = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}


function matchParen(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return source.length;
}









function pushExample(examples: ExampleRef[], record: ElementScanRecord): void {
  if (examples.length >= MAX_EXAMPLES) return;
  if (examples.some((example) => example.locator === record.locator)) return;
  examples.push({ locator: record.locator, label: record.label });
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function byteToHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isZeroLength(value: string): boolean {
  const numbers = value.match(/-?\d*\.?\d+/g);
  if (!numbers) return value === '' || value === '0';
  return numbers.every((token) => Number.parseFloat(token) === 0);
}

function round2(value: number): number {
  return Number.parseFloat(value.toFixed(2));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
