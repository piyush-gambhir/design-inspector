import { describe, expect, it } from 'vitest';

import {
  extractUrls,
  formatNumber,
  formatPx,
  isDeclared,
  parsePx,
  pxToRem,
  roundTo,
  splitCssList,
  splitTopLevel,
} from '../lib/readings/units';

describe('splitTopLevel', () => {
  it('ignores commas inside parentheses', () => {
    expect(
      splitTopLevel('rgb(0, 0, 0) 0px 1px 2px, rgba(255, 255, 255, 0.4) 0px 0px 0px 1px'),
    ).toEqual(['rgb(0, 0, 0) 0px 1px 2px', 'rgba(255, 255, 255, 0.4) 0px 0px 0px 1px']);
  });

  it('ignores commas inside quotes', () => {
    expect(splitTopLevel('"Helvetica, Neue", Arial')).toEqual(['"Helvetica, Neue"', 'Arial']);
  });

  it('handles nested functions', () => {
    expect(
      splitTopLevel('linear-gradient(90deg, rgb(1, 2, 3), rgb(4, 5, 6)), url(a.png)'),
    ).toEqual(['linear-gradient(90deg, rgb(1, 2, 3), rgb(4, 5, 6))', 'url(a.png)']);
  });

  it('drops empty items', () => {
    expect(splitTopLevel('a, , b,')).toEqual(['a', 'b']);
  });
});

describe('splitCssList', () => {
  it('returns an empty list for keywords that declare nothing', () => {
    expect(splitCssList('none')).toEqual([]);
    expect(splitCssList('')).toEqual([]);
    expect(splitCssList(null)).toEqual([]);
  });

  it('keeps shadow order', () => {
    expect(splitCssList('rgb(0, 0, 0) 0px 1px 2px, rgb(0, 0, 0) 0px 12px 32px')).toEqual([
      'rgb(0, 0, 0) 0px 1px 2px',
      'rgb(0, 0, 0) 0px 12px 32px',
    ]);
  });
});

describe('parsePx', () => {
  it('reads lengths and treats keywords as zero', () => {
    expect(parsePx('12.5px')).toBe(12.5);
    expect(parsePx('-18px')).toBe(-18);
    expect(parsePx('normal')).toBe(0);
    expect(parsePx('auto')).toBe(0);
    expect(parsePx(undefined)).toBe(0);
  });
});

describe('pxToRem', () => {
  it('uses the inspected document root size', () => {
    expect(pxToRem(44, 16)).toBe(2.75);
    expect(pxToRem(40, 20)).toBe(2);
  });

  it('never divides by an impossible root size', () => {
    expect(pxToRem(40, 0)).toBe(0);
    expect(pxToRem(40, Number.NaN)).toBe(0);
  });
});

describe('formatting', () => {
  it('rounds for display only', () => {
    expect(roundTo(2.74999, 3)).toBe(2.75);
    expect(formatNumber(12.5, 2)).toBe('12.5');
    expect(formatNumber(12, 2)).toBe('12');
    expect(formatPx(12.004)).toBe('12px');
    expect(formatPx(-0.88)).toBe('-0.88px');
  });
});

describe('extractUrls', () => {
  it('reads quoted and bare urls from every layer', () => {
    expect(
      extractUrls('url("a.png"), linear-gradient(red, blue), url(b.svg), url(\'c.webp\')'),
    ).toEqual(['a.png', 'b.svg', 'c.webp']);
  });

  it('returns nothing when there is no url', () => {
    expect(extractUrls('linear-gradient(red, blue)')).toEqual([]);
  });
});

describe('isDeclared', () => {
  it('treats none and empty as undeclared', () => {
    expect(isDeclared('none')).toBe(false);
    expect(isDeclared('')).toBe(false);
    expect(isDeclared('blur(4px)')).toBe(true);
  });
});
