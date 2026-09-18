// Color parsing and conversion (PRD SUR-02). Pure, no DOM access.
//
// Design notes:
// - Every input is normalised into non-linear sRGB floats that may fall
//   outside 0..1, which losslessly represents any CSS color. hex and rgb()
//   output clip that to the sRGB gamut, oklch() does not need to.
// - `raw` always keeps the browser's own serialization. Rounding happens for
//   display only, so a copied value stays faithful (PRD SUR-02).
// - `lossy` is true when the source was not sRGB, or when the color sits
//   outside the sRGB gamut and had to be clipped for hex and rgb().

import type { ColorValue } from '../contracts';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  /** 0..1 */
  a: number;
}

/** CSS named colors we may meet in authored stylesheets. Computed styles use rgb(). */
const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  silver: [192, 192, 192],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  white: [255, 255, 255],
  maroon: [128, 0, 0],
  red: [255, 0, 0],
  purple: [128, 0, 128],
  fuchsia: [255, 0, 255],
  magenta: [255, 0, 255],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  olive: [128, 128, 0],
  yellow: [255, 255, 0],
  navy: [0, 0, 128],
  blue: [0, 0, 255],
  teal: [0, 128, 128],
  aqua: [0, 255, 255],
  cyan: [0, 255, 255],
  orange: [255, 165, 0],
  rebeccapurple: [102, 51, 153],
};

// ---------------------------------------------------------------------------
// Matrices (CSS Color 4 reference values)

type Matrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const SRGB_LINEAR_TO_XYZ: Matrix = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];

const XYZ_TO_SRGB_LINEAR: Matrix = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];

const P3_LINEAR_TO_XYZ: Matrix = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0.0, 0.04511338185890264, 1.043944368900976],
];

const A98_LINEAR_TO_XYZ: Matrix = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];

const PROPHOTO_LINEAR_TO_XYZ_D50: Matrix = [
  [0.7977604896723027, 0.13518583717574031, 0.0313493495815248],
  [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902],
  [0.0, 0.0, 0.8251046025104601],
];

const REC2020_LINEAR_TO_XYZ: Matrix = [
  [0.6369580483012914, 0.14461690358620832, 0.16888097516417208],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0.0, 0.028072693049087428, 1.060985057710791],
];

const D50_TO_D65: Matrix = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];

const XYZ_TO_LMS: Matrix = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.264239531708412, 0.6335478284694309],
];

const LMS_TO_OKLAB: Matrix = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];

const D50_WHITE: readonly [number, number, number] = [
  0.3457 / 0.3585,
  1.0,
  (1.0 - 0.3457 - 0.3585) / 0.3585,
];

function multiply(matrix: Matrix, vector: readonly [number, number, number]): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let row = 0; row < 3; row += 1) {
    const line = matrix[row] as readonly [number, number, number];
    out[row] =
      (line[0] as number) * (vector[0] as number) +
      (line[1] as number) * (vector[1] as number) +
      (line[2] as number) * (vector[2] as number);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transfer functions. All sign preserving so out-of-gamut values survive.

function srgbDecode(value: number): number {
  const abs = Math.abs(value);
  const sign = value < 0 ? -1 : 1;
  return sign * (abs <= 0.04045 ? abs / 12.92 : ((abs + 0.055) / 1.055) ** 2.4);
}

function srgbEncode(value: number): number {
  const abs = Math.abs(value);
  const sign = value < 0 ? -1 : 1;
  return sign * (abs <= 0.0031308 ? abs * 12.92 : 1.055 * abs ** (1 / 2.4) - 0.055);
}

function gammaDecode(value: number, gamma: number): number {
  const abs = Math.abs(value);
  const sign = value < 0 ? -1 : 1;
  return sign * abs ** gamma;
}

function rec2020Decode(value: number): number {
  const alpha = 1.09929682680944;
  const beta = 0.018053968510807;
  const abs = Math.abs(value);
  const sign = value < 0 ? -1 : 1;
  return sign * (abs < beta * 4.5 ? abs / 4.5 : ((abs + alpha - 1) / alpha) ** (1 / 0.45));
}

function prophotoDecode(value: number): number {
  const abs = Math.abs(value);
  const sign = value < 0 ? -1 : 1;
  return sign * (abs <= 16 / 512 ? abs / 16 : abs ** 1.8);
}

// ---------------------------------------------------------------------------
// Token parsing

function parseNumberToken(token: string | undefined, percentBase: number): number {
  const text = (token ?? '').trim().toLowerCase();
  if (!text || text === 'none') return 0;
  if (text.endsWith('%')) {
    const percent = Number.parseFloat(text.slice(0, -1));
    return Number.isFinite(percent) ? (percent / 100) * percentBase : 0;
  }
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : 0;
}

function parseAlphaToken(token: string | null | undefined): number {
  if (token === null || token === undefined) return 1;
  const text = token.trim().toLowerCase();
  if (!text || text === 'none') return 0;
  const value = text.endsWith('%')
    ? Number.parseFloat(text.slice(0, -1)) / 100
    : Number.parseFloat(text);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function parseAngleToken(token: string | undefined): number {
  const text = (token ?? '').trim().toLowerCase();
  if (!text || text === 'none') return 0;
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return 0;
  // `grad` must be tested before `rad`, which is its suffix.
  if (text.endsWith('grad')) return value * 0.9;
  if (text.endsWith('rad')) return (value * 180) / Math.PI;
  if (text.endsWith('turn')) return value * 360;
  return value;
}

interface Args {
  parts: string[];
  alpha: string | null;
}

/**
 * Splits function arguments, accepting modern space syntax with `/ alpha` and
 * the legacy comma syntax where alpha is the fourth value.
 */
function parseArgs(text: string): Args {
  const slash = text.indexOf('/');
  let head = text;
  let alpha: string | null = null;

  if (slash >= 0) {
    head = text.slice(0, slash);
    alpha = text.slice(slash + 1).trim();
  }

  const parts = head
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (alpha === null && parts.length === 4) {
    alpha = parts.pop() ?? null;
  }

  return { parts, alpha };
}

// ---------------------------------------------------------------------------
// Internal representation

interface Parsed {
  /** Non-linear sRGB, 0..1 nominal, may fall outside for wide-gamut sources. */
  rgb: [number, number, number];
  alpha: number;
  /** True when the authored space was not sRGB, so hex and rgb() are a conversion. */
  notSrgb: boolean;
}

function fromXyzD65(xyz: readonly [number, number, number], alpha: number): Parsed {
  const linear = multiply(XYZ_TO_SRGB_LINEAR, xyz);
  return {
    rgb: [srgbEncode(linear[0]), srgbEncode(linear[1]), srgbEncode(linear[2])],
    alpha,
    notSrgb: true,
  };
}

function oklabToXyz(l: number, a: number, b: number): [number, number, number] {
  const lms = multiply(
    [
      [1.0, 0.3963377773761749, 0.2158037573099136],
      [1.0, -0.1055613458156586, -0.0638541728258133],
      [1.0, -0.0894841775298119, -1.2914855480194092],
    ],
    [l, a, b],
  );
  const cubed: [number, number, number] = [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3];
  return multiply(
    [
      [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
      [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
      [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
    ],
    cubed,
  );
}

function labToXyzD50(l: number, a: number, b: number): [number, number, number] {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const x = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa;
  const y = l > kappa * epsilon ? ((l + 16) / 116) ** 3 : l / kappa;
  const z = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa;
  return [x * (D50_WHITE[0] as number), y * (D50_WHITE[1] as number), z * (D50_WHITE[2] as number)];
}

function xyzD65ToOklch(xyz: readonly [number, number, number]): [number, number, number] {
  const lms = multiply(XYZ_TO_LMS, xyz);
  const cubeRoot = (value: number): number => Math.cbrt(value);
  const lab = multiply(LMS_TO_OKLAB, [cubeRoot(lms[0]), cubeRoot(lms[1]), cubeRoot(lms[2])]);
  const l = lab[0] as number;
  const a = lab[1] as number;
  const b = lab[2] as number;
  const chroma = Math.sqrt(a * a + b * b);
  let hue = chroma < 1e-6 ? 0 : (Math.atan2(b, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return [l, chroma, hue];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)];
}

function parseHex(text: string): Parsed | null {
  const body = text.slice(1);
  const valid = /^[0-9a-f]+$/i.test(body);
  if (!valid) return null;

  const expand = (part: string): number => Number.parseInt(part + part, 16) / 255;
  const byte = (part: string): number => Number.parseInt(part, 16) / 255;

  if (body.length === 3 || body.length === 4) {
    const r = expand(body[0] as string);
    const g = expand(body[1] as string);
    const b = expand(body[2] as string);
    const a = body.length === 4 ? expand(body[3] as string) : 1;
    return { rgb: [r, g, b], alpha: a, notSrgb: false };
  }

  if (body.length === 6 || body.length === 8) {
    const r = byte(body.slice(0, 2));
    const g = byte(body.slice(2, 4));
    const b = byte(body.slice(4, 6));
    const a = body.length === 8 ? byte(body.slice(6, 8)) : 1;
    return { rgb: [r, g, b], alpha: a, notSrgb: false };
  }

  return null;
}

function parseColorFunction(space: string, args: Args): Parsed | null {
  const alpha = parseAlphaToken(args.alpha);
  const c = (index: number, base = 1): number => parseNumberToken(args.parts[index], base);

  switch (space) {
    case 'srgb':
      return { rgb: [c(0), c(1), c(2)], alpha, notSrgb: false };
    case 'srgb-linear':
      return {
        rgb: [srgbEncode(c(0)), srgbEncode(c(1)), srgbEncode(c(2))],
        alpha,
        notSrgb: true,
      };
    case 'display-p3':
      return fromXyzD65(
        multiply(P3_LINEAR_TO_XYZ, [srgbDecode(c(0)), srgbDecode(c(1)), srgbDecode(c(2))]),
        alpha,
      );
    case 'a98-rgb':
      return fromXyzD65(
        multiply(A98_LINEAR_TO_XYZ, [
          gammaDecode(c(0), 563 / 256),
          gammaDecode(c(1), 563 / 256),
          gammaDecode(c(2), 563 / 256),
        ]),
        alpha,
      );
    case 'prophoto-rgb':
      return fromXyzD65(
        multiply(
          D50_TO_D65,
          multiply(PROPHOTO_LINEAR_TO_XYZ_D50, [
            prophotoDecode(c(0)),
            prophotoDecode(c(1)),
            prophotoDecode(c(2)),
          ]),
        ),
        alpha,
      );
    case 'rec2020':
      return fromXyzD65(
        multiply(REC2020_LINEAR_TO_XYZ, [
          rec2020Decode(c(0)),
          rec2020Decode(c(1)),
          rec2020Decode(c(2)),
        ]),
        alpha,
      );
    case 'xyz':
    case 'xyz-d65':
      return fromXyzD65([c(0), c(1), c(2)], alpha);
    case 'xyz-d50':
      return fromXyzD65(multiply(D50_TO_D65, [c(0), c(1), c(2)]), alpha);
    default:
      return null;
  }
}

function parseInternal(text: string): Parsed | null {
  const lower = text.toLowerCase();

  if (lower === 'transparent') return { rgb: [0, 0, 0], alpha: 0, notSrgb: false };
  if (lower in NAMED_COLORS) {
    const named = NAMED_COLORS[lower] as [number, number, number];
    return {
      rgb: [named[0] / 255, named[1] / 255, named[2] / 255],
      alpha: 1,
      notSrgb: false,
    };
  }
  if (lower.startsWith('#')) return parseHex(lower);

  const call = /^([a-z][a-z0-9-]*)\((.*)\)$/s.exec(lower);
  if (!call) return null;

  const name = call[1] as string;
  const body = call[2] as string;

  if (name === 'color') {
    const trimmed = body.trim();
    const spaceEnd = trimmed.search(/[\s,]/);
    if (spaceEnd < 0) return null;
    const space = trimmed.slice(0, spaceEnd).trim();
    return parseColorFunction(space, parseArgs(trimmed.slice(spaceEnd)));
  }

  const args = parseArgs(body);
  const alpha = parseAlphaToken(args.alpha);

  switch (name) {
    case 'rgb':
    case 'rgba': {
      const isPercent = (args.parts[0] ?? '').endsWith('%');
      const base = isPercent ? 1 : 255;
      const scale = isPercent ? 1 : 1 / 255;
      return {
        rgb: [
          parseNumberToken(args.parts[0], base) * scale,
          parseNumberToken(args.parts[1], base) * scale,
          parseNumberToken(args.parts[2], base) * scale,
        ],
        alpha,
        notSrgb: false,
      };
    }
    case 'hsl':
    case 'hsla': {
      const rgb = hslToRgb(
        parseAngleToken(args.parts[0]),
        parseNumberToken(args.parts[1], 1),
        parseNumberToken(args.parts[2], 1),
      );
      return { rgb, alpha, notSrgb: false };
    }
    case 'oklch': {
      const l = parseNumberToken(args.parts[0], 1);
      const chroma = parseNumberToken(args.parts[1], 0.4);
      const hue = parseAngleToken(args.parts[2]);
      const radians = (hue * Math.PI) / 180;
      return fromXyzD65(
        oklabToXyz(l, chroma * Math.cos(radians), chroma * Math.sin(radians)),
        alpha,
      );
    }
    case 'oklab':
      return fromXyzD65(
        oklabToXyz(
          parseNumberToken(args.parts[0], 1),
          parseNumberToken(args.parts[1], 0.4),
          parseNumberToken(args.parts[2], 0.4),
        ),
        alpha,
      );
    case 'lch': {
      const l = parseNumberToken(args.parts[0], 100);
      const chroma = parseNumberToken(args.parts[1], 150);
      const hue = parseAngleToken(args.parts[2]);
      const radians = (hue * Math.PI) / 180;
      return fromXyzD65(
        multiply(
          D50_TO_D65,
          labToXyzD50(l, chroma * Math.cos(radians), chroma * Math.sin(radians)),
        ),
        alpha,
      );
    }
    case 'lab':
      return fromXyzD65(
        multiply(
          D50_TO_D65,
          labToXyzD50(
            parseNumberToken(args.parts[0], 100),
            parseNumberToken(args.parts[1], 125),
            parseNumberToken(args.parts[2], 125),
          ),
        ),
        alpha,
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Output formatting

const GAMUT_EPSILON = 1e-4;

function isOutOfGamut(rgb: readonly [number, number, number]): boolean {
  return rgb.some((channel) => channel < -GAMUT_EPSILON || channel > 1 + GAMUT_EPSILON);
}

function clampChannel(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toByte(value: number): number {
  return Math.round(clampChannel(value) * 255);
}

function hexByte(value: number): string {
  return toByte(value).toString(16).padStart(2, '0');
}

function formatAlpha(alpha: number): string {
  const text = alpha.toFixed(3);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

function build(raw: string, parsed: Parsed): ColorValue {
  const outOfGamut = isOutOfGamut(parsed.rgb);
  const alpha = Math.min(1, Math.max(0, parsed.alpha));
  const r = parsed.rgb[0];
  const g = parsed.rgb[1];
  const b = parsed.rgb[2];

  const hex =
    alpha < 1
      ? `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${hexByte(alpha)}`
      : `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;

  const rgbText = `rgb(${toByte(r)} ${toByte(g)} ${toByte(b)} / ${formatAlpha(alpha)})`;

  const linear: [number, number, number] = [srgbDecode(r), srgbDecode(g), srgbDecode(b)];
  const [lightness, chroma, hue] = xyzD65ToOklch(multiply(SRGB_LINEAR_TO_XYZ, linear));
  const oklchText = `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)} / ${formatAlpha(alpha)})`;

  return {
    raw,
    hex,
    rgb: rgbText,
    oklch: oklchText,
    alpha,
    lossy: parsed.notSrgb || outOfGamut,
  };
}

function unparseable(raw: string): ColorValue {
  return { raw, hex: null, rgb: null, oklch: null, alpha: 1, lossy: false };
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Parses any computed or authored CSS color into a ColorValue. Unknown syntax
 * keeps `raw` and reports null conversions rather than guessing.
 */
export function parseColor(raw: string): ColorValue {
  const text = (raw ?? '').trim();
  if (!text) return unparseable(raw ?? '');

  const parsed = parseInternal(text);
  if (!parsed) return unparseable(text);
  return build(text, parsed);
}

/**
 * Parses a color to 0..255 sRGB channels for math such as contrast. Returns
 * null when the value cannot be parsed or declares no color (`none`).
 */
export function parseRgba(raw: string): Rgba | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'none' || lower === 'currentcolor') return null;
  if (lower === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const parsed = parseInternal(text);
  if (!parsed) return null;
  return {
    r: toByte(parsed.rgb[0]),
    g: toByte(parsed.rgb[1]),
    b: toByte(parsed.rgb[2]),
    a: Math.min(1, Math.max(0, parsed.alpha)),
  };
}

/** A stable comparison key for grouping colors (PRD SUM-03). */
export function colorKey(color: ColorValue): string {
  return (color.hex ?? color.raw).toLowerCase();
}

export function rgbToHex(rgb: Rgb): string {
  const byte = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
}
