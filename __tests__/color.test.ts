import { describe, expect, it } from 'vitest';

import { colorKey, parseColor, parseRgba, rgbToHex } from '../lib/readings/color';

describe('parseColor', () => {
  it('reads modern space separated rgb', () => {
    const color = parseColor('rgb(16 24 40)');
    expect(color.hex).toBe('#101828');
    expect(color.rgb).toBe('rgb(16 24 40 / 1)');
    expect(color.alpha).toBe(1);
    expect(color.lossy).toBe(false);
    expect(color.raw).toBe('rgb(16 24 40)');
  });

  it('reads legacy comma syntax with alpha', () => {
    const color = parseColor('rgba(255, 0, 0, 0.5)');
    expect(color.hex).toBe('#ff000080');
    expect(color.rgb).toBe('rgb(255 0 0 / 0.5)');
    expect(color.alpha).toBe(0.5);
    expect(color.lossy).toBe(false);
  });

  it('reads legacy comma syntax without alpha', () => {
    expect(parseColor('rgb(0, 128, 255)').hex).toBe('#0080ff');
  });

  it('reads slash alpha in percent', () => {
    const color = parseColor('rgb(0 0 0 / 40%)');
    expect(color.alpha).toBeCloseTo(0.4, 5);
    expect(color.hex).toBe('#00000066');
  });

  it('keeps alpha in the 8 digit hex', () => {
    const color = parseColor('rgba(17, 24, 39, 0.8)');
    expect(color.hex).toHaveLength(9);
    expect(color.hex?.endsWith('cc')).toBe(true);
  });

  it('reads transparent as a zero alpha color', () => {
    const color = parseColor('transparent');
    expect(color.alpha).toBe(0);
    expect(color.hex).toBe('#00000000');
    expect(color.lossy).toBe(false);
  });

  it('reads hex input in short and long form', () => {
    expect(parseColor('#abc').hex).toBe('#aabbcc');
    expect(parseColor('#AABBCC').hex).toBe('#aabbcc');
    expect(parseColor('#11223344').alpha).toBeCloseTo(0x44 / 255, 5);
  });

  it('reads named colors', () => {
    expect(parseColor('white').hex).toBe('#ffffff');
    expect(parseColor('rebeccapurple').hex).toBe('#663399');
  });

  it('reads hsl', () => {
    expect(parseColor('hsl(0 100% 50%)').hex).toBe('#ff0000');
    expect(parseColor('hsl(120, 100%, 25%)').hex).toBe('#008000');
  });

  it('converts sRGB to oklch with 3, 3, 1 decimals', () => {
    const color = parseColor('rgb(255 255 255)');
    expect(color.oklch).toBe('oklch(1.000 0.000 0.0 / 1)');
    const accent = parseColor('rgb(56 116 203)');
    expect(accent.oklch).toMatch(/^oklch\(0\.\d{3} 0\.\d{3} \d+\.\d \/ 1\)$/);
  });

  it('round trips an oklch input back to sRGB', () => {
    const color = parseColor('oklch(0.62 0.17 255)');
    expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(color.lossy).toBe(true);
    const again = parseColor(color.rgb as string);
    // The oklch lightness of the clipped sRGB value stays close to the source.
    expect(again.oklch?.slice(0, 10)).toBe(color.oklch?.slice(0, 10));
  });

  it('flags a non sRGB source as lossy even when it is in gamut', () => {
    const color = parseColor('color(display-p3 0.2 0.3 0.4)');
    expect(color.lossy).toBe(true);
    expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('flags an out of gamut wide colour as lossy and clips it', () => {
    const color = parseColor('color(display-p3 1 0 0)');
    expect(color.lossy).toBe(true);
    expect(color.hex).toBe('#ff0000');
  });

  it('does not flag color(srgb ...) as a non sRGB source', () => {
    const color = parseColor('color(srgb 1 0 0)');
    expect(color.lossy).toBe(false);
    expect(color.hex).toBe('#ff0000');
  });

  it('reads lab and lch', () => {
    const white = parseColor('lab(100% 0 0)');
    expect(white.hex).toBe('#ffffff');
    const lch = parseColor('lch(50% 40 30)');
    expect(lch.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(lch.lossy).toBe(true);
  });

  it('reads oklab', () => {
    expect(parseColor('oklab(0 0 0)').hex).toBe('#000000');
  });

  it('keeps unknown syntax without inventing conversions', () => {
    const color = parseColor('color-mix(in oklch, red, blue)');
    expect(color.hex).toBeNull();
    expect(color.rgb).toBeNull();
    expect(color.oklch).toBeNull();
    expect(color.raw).toBe('color-mix(in oklch, red, blue)');
  });
});

describe('parseRgba', () => {
  it('returns 0 to 255 channels with alpha', () => {
    expect(parseRgba('rgba(1, 2, 3, 0.25)')).toEqual({ r: 1, g: 2, b: 3, a: 0.25 });
  });

  it('returns null for none and currentcolor', () => {
    expect(parseRgba('none')).toBeNull();
    expect(parseRgba('currentcolor')).toBeNull();
    expect(parseRgba('')).toBeNull();
  });
});

describe('helpers', () => {
  it('builds a stable grouping key', () => {
    expect(colorKey(parseColor('rgb(255 0 0)'))).toBe('#ff0000');
    expect(colorKey(parseColor('weird-value'))).toBe('weird-value');
  });

  it('formats rounded rgb as hex', () => {
    expect(rgbToHex({ r: 254.6, g: 0, b: 17.2 })).toBe('#ff0011');
  });
});
