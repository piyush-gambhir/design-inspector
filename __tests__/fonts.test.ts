import { describe, expect, it } from 'vitest';

import type { FontFaceRecord } from '../lib/contracts';
import {
  classifyFontSource,
  formatFromSrcHint,
  formatFromUrl,
  identifyFamily,
  isSubsetRange,
  isSystemFamily,
  normalizeFamily,
  parseWeightRange,
  splitFontFamilyStack,
  srcUrls,
  weightCovered,
  urlNamesFamily,
} from '../lib/readings/fonts';

function face(overrides: Partial<FontFaceRecord> = {}): FontFaceRecord {
  return {
    family: 'Satoshi',
    weight: '400',
    style: 'normal',
    urls: [],
    format: null,
    unicodeRange: null,
    status: 'loaded',
    ...overrides,
  };
}

describe('splitFontFamilyStack', () => {
  it('splits and unquotes a stack', () => {
    expect(splitFontFamilyStack('"Satoshi", Georgia, serif')).toEqual([
      'Satoshi',
      'Georgia',
      'serif',
    ]);
  });

  it('keeps a quoted family that contains a comma', () => {
    expect(splitFontFamilyStack('"Helvetica, Neue", Arial')).toEqual(['Helvetica, Neue', 'Arial']);
  });

  it('returns an empty stack for an empty value', () => {
    expect(splitFontFamilyStack('')).toEqual([]);
    expect(splitFontFamilyStack(null)).toEqual([]);
  });

  it('unquotes single quotes too', () => {
    expect(normalizeFamily("'Times New Roman'")).toBe('Times New Roman');
  });
});

describe('isSystemFamily', () => {
  it('accepts generics and preinstalled families', () => {
    expect(isSystemFamily('sans-serif')).toBe(true);
    expect(isSystemFamily('system-ui')).toBe(true);
    expect(isSystemFamily('-apple-system')).toBe(true);
    expect(isSystemFamily('Segoe UI')).toBe(true);
    expect(isSystemFamily('Times New Roman')).toBe(true);
  });

  it('rejects web fonts', () => {
    expect(isSystemFamily('Satoshi')).toBe(false);
    expect(isSystemFamily('Nonexistent Display')).toBe(false);
  });
});

describe('classifyFontSource', () => {
  it('recognises the providers by host', () => {
    expect(classifyFontSource('Inter', ['https://fonts.gstatic.com/s/inter/v1/a.woff2']).kind).toBe(
      'google',
    );
    expect(classifyFontSource('Ivy', ['https://use.typekit.net/af/abc/x.woff2']).kind).toBe('adobe');
    expect(classifyFontSource('Satoshi', ['https://cdn.fontshare.com/wf/x.woff2']).kind).toBe(
      'fontshare',
    );
  });

  it('calls a font file on another path self-hosted', () => {
    const source = classifyFontSource('Satoshi', ['https://example.com/fonts/satoshi.woff2'], {
      pageOrigin: 'https://example.com',
    });
    expect(source.kind).toBe('self-hosted');
    expect(source.format).toBe('woff2');
  });

  it('notes a third party host for a self-hosted file', () => {
    const source = classifyFontSource('Satoshi', ['https://cdn.other.com/satoshi.woff'], {
      pageOrigin: 'https://example.com',
    });
    expect(source.kind).toBe('self-hosted');
    expect(source.note).toContain('cdn.other.com');
  });

  it('falls back to system for a generic family with no file', () => {
    expect(classifyFontSource('Georgia', []).kind).toBe('system');
    expect(classifyFontSource('sans-serif', []).kind).toBe('system');
  });

  it('falls back to unknown for a web font with no discoverable file', () => {
    const source = classifyFontSource('Satoshi', []);
    expect(source.kind).toBe('unknown');
    expect(source.note).toContain('No @font-face source');
  });

  it('attributes a provider only when its stylesheet names this family', () => {
    const source = classifyFontSource('Inter', [], {
      providerUrls: ['https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap'],
    });
    expect(source.kind).toBe('google');
    expect(source.note).toContain('provider stylesheet');
  });

  it('never attributes a provider to a family its stylesheet does not name', () => {
    const source = classifyFontSource('EB Garamond', [], {
      providerUrls: ['https://fonts.googleapis.com/css?family=Inconsolata:400,700'],
    });
    expect(source.kind).toBe('unknown');
    expect(source.url).toBeNull();
    expect(source.note).toContain('may or may not');
  });

  it('prefers a readable self-hosted file over a provider on the page', () => {
    const source = classifyFontSource(
      'EB Garamond',
      ['https://wordpress.org/wp-content/fonts/EBGaramond-latin.woff2'],
      { pageOrigin: 'https://wordpress.org', providerUrls: ['https://fonts.googleapis.com/css?family=EB+Garamond'] },
    );
    expect(source.kind).toBe('self-hosted');
  });

  it('matches family names inside provider query strings', () => {
    expect(urlNamesFamily('https://fonts.googleapis.com/css2?family=EB+Garamond:ital@0;1&family=Inter', 'EB Garamond')).toBe(true);
    expect(urlNamesFamily('https://api.fontshare.com/v2/css?f[]=satoshi@400,700', 'Satoshi')).toBe(true);
    expect(urlNamesFamily('https://fonts.googleapis.com/css2?family=Inter', 'Inter Display')).toBe(false);
    expect(urlNamesFamily('https://use.typekit.net/abc123.css', 'Proxima Nova')).toBe(false);
  });
});

describe('format and subset detection', () => {
  it('reads the format from the extension or the hint', () => {
    expect(formatFromUrl('/f/a.woff2?v=3')).toBe('woff2');
    expect(formatFromUrl('/f/a.ttf')).toBe('ttf');
    expect(formatFromUrl('/f/a')).toBeNull();
    expect(formatFromSrcHint("url(a.bin) format('woff2')")).toBe('woff2');
  });

  it('reads src urls in declared order', () => {
    expect(srcUrls("url('a.woff2') format('woff2'), url(b.woff) format('woff')")).toEqual([
      'a.woff2',
      'b.woff',
    ]);
  });

  it('treats a narrowed unicode range as a subset', () => {
    expect(isSubsetRange('U+0-10FFFF')).toBe(false);
    expect(isSubsetRange('U+0000-00FF, U+0131')).toBe(true);
    expect(isSubsetRange(null)).toBeNull();
  });
});

describe('parseWeightRange', () => {
  it('reads single weights, keywords, and variable ranges', () => {
    expect(parseWeightRange('400')).toEqual([400, 400]);
    expect(parseWeightRange('normal')).toEqual([400, 400]);
    expect(parseWeightRange('bold')).toEqual([700, 700]);
    expect(parseWeightRange('100 900')).toEqual([100, 900]);
    expect(parseWeightRange(undefined)).toEqual([400, 400]);
  });

  it('decides whether a computed weight is covered', () => {
    expect(weightCovered('100 900', 650)).toBe(true);
    expect(weightCovered('400', 700)).toBe(false);
  });
});

describe('identifyFamily', () => {
  it('never returns verified', () => {
    const identification = identifyFamily(['Satoshi'], 400, [face()]);
    expect(identification.familyConfidence).not.toBe('verified');
    expect(identification.familyConfidence).toBe('matched');
  });

  it('reports declared when the first choice font is missing', () => {
    const identification = identifyFamily(
      ['Nonexistent Display', 'Georgia', 'serif'],
      700,
      [face({ family: 'Georgia' })],
    );
    expect(identification.familyReading).toBe('Nonexistent Display');
    expect(identification.familyConfidence).toBe('declared');
  });

  it('reports declared when the face exists but has not loaded', () => {
    const identification = identifyFamily(['Satoshi'], 400, [face({ status: 'unloaded' })]);
    expect(identification.familyConfidence).toBe('declared');
  });

  it('reports declared when no loaded face covers the computed weight', () => {
    const identification = identifyFamily(['Satoshi'], 800, [face({ weight: '400' })]);
    expect(identification.familyConfidence).toBe('declared');
  });

  it('matches a variable face that covers the weight', () => {
    const identification = identifyFamily(['Satoshi'], 800, [face({ weight: '300 900' })]);
    expect(identification.familyConfidence).toBe('matched');
  });

  it('matches a system family without any face', () => {
    const identification = identifyFamily(['Georgia', 'serif'], 400, []);
    expect(identification.familyConfidence).toBe('matched');
    expect(identification.source.kind).toBe('system');
  });

  it('carries the subset flag through to the source', () => {
    const identification = identifyFamily(['Satoshi'], 400, [
      face({ urls: ['https://example.com/satoshi.woff2'], unicodeRange: 'U+0000-00FF' }),
    ]);
    expect(identification.source.subset).toBe(true);
    expect(identification.source.note).toContain('subset');
  });

  it('handles an empty stack without inventing a family', () => {
    const identification = identifyFamily([], 400, []);
    expect(identification.familyReading).toBe('Unknown');
    expect(identification.familyConfidence).toBe('declared');
  });
});
