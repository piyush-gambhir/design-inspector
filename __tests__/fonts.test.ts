import { beforeEach, describe, expect, it } from 'vitest';

import type { FontFaceRecord, FontIdentity } from '../lib/contracts';
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
  aliasDiffers,
  axisChipText,
  confidenceEvidence,
  designerLine,
  displayFamily,
  firstSentence,
  fontSourceLine,
  formatFileSize,
  identityDescription,
  providerLink,
  renderCheck,
  resetRenderCheckCache,
  type TextMeasurer,
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
    // The host itself is named by the source line; the note carries the part
    // that line cannot say, which is that the CDN is not the page's origin.
    expect(source.note).toContain("not this page's own origin");
    expect(fontSourceLine(source)).toContain('cdn.other.com');
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

// ---------------------------------------------------------------------------
// Verified rendering (PRD TYP-02)

/**
 * A canvas context that only knows how to measure. Widths are looked up by
 * whether the font shorthand names the family, which is exactly the signal the
 * real check reads.
 */
function fakeMeasurer(widths: {
  withFamily: number;
  mono: number;
  serif: number;
}): TextMeasurer & { calls: number } {
  return {
    font: '',
    calls: 0,
    measureText(): { width: number } {
      this.calls += 1;
      if (this.font.includes('Satoshi')) return { width: widths.withFamily };
      return { width: this.font.includes('monospace') ? widths.mono : widths.serif };
    },
  };
}

function fakeDoc(check: boolean | null): Document {
  return {
    fonts: check === null ? undefined : { check: () => check },
  } as unknown as Document;
}

describe('renderCheck', () => {
  beforeEach(() => {
    resetRenderCheckCache();
  });

  it('reports rendered when the family measures differently from both fallbacks', () => {
    const measurer = fakeMeasurer({ withFamily: 420, mono: 500, serif: 480 });
    expect(renderCheck('Satoshi', 400, 'normal', fakeDoc(true), measurer)).toBe('rendered');
  });

  it('reports fallback when both widths match and the font set says the face is missing', () => {
    // Every measurement comes back the same width, so the family added nothing.
    // The font set is the second witness that it is genuinely absent.
    const equal = {
      font: '',
      measureText(): { width: number } {
        return { width: 500 };
      },
    } as TextMeasurer;
    expect(renderCheck('Satoshi', 400, 'normal', fakeDoc(false), equal)).toBe('fallback');
  });

  it('stays inconclusive when the widths match but the font set says the face is there', () => {
    const equal = {
      font: '',
      measureText(): { width: number } {
        return { width: 500 };
      },
    } as TextMeasurer;
    // A family whose metrics happen to match the fallback is a real case, and
    // it is never reported as a fallback on that evidence alone.
    expect(renderCheck('Satoshi', 400, 'normal', fakeDoc(true), equal)).toBe('inconclusive');
  });

  it('stays inconclusive with no canvas at all', () => {
    expect(renderCheck('Satoshi', 400, 'normal', fakeDoc(false), null)).toBe('inconclusive');
  });

  it('treats a generic family as rendered by definition, without measuring', () => {
    const measurer = fakeMeasurer({ withFamily: 1, mono: 2, serif: 3 });
    expect(renderCheck('monospace', 400, 'normal', fakeDoc(true), measurer)).toBe('rendered');
    expect(measurer.calls).toBe(0);
  });

  it('measures a family, weight, and style combination once per page session', () => {
    const measurer = fakeMeasurer({ withFamily: 420, mono: 500, serif: 480 });
    renderCheck('Satoshi', 700, 'italic', fakeDoc(true), measurer);
    const afterFirst = measurer.calls;
    renderCheck('Satoshi', 700, 'italic', fakeDoc(true), measurer);
    expect(measurer.calls).toBe(afterFirst);
    // A different weight is a different question and is measured again.
    renderCheck('Satoshi', 400, 'italic', fakeDoc(true), measurer);
    expect(measurer.calls).toBeGreaterThan(afterFirst);
  });
});

// ---------------------------------------------------------------------------
// Presenting an identity

function identity(overrides: Partial<FontIdentity> = {}): FontIdentity {
  return {
    family: 'NB International Pro',
    subfamily: 'Regular',
    fullName: 'NB International Pro Regular',
    postscriptName: 'NBInternationalPro-Regular',
    designer: 'Stefan Gandl',
    manufacturer: 'Neubau Berlin',
    version: '1.004',
    license: 'Licensed for web use. Redistribution is not permitted.',
    licenseUrl: 'https://example.invalid/eula',
    axes: [],
    container: 'woff2',
    fileSize: 49152,
    evidence: 'name-table',
    url: 'https://cdn.prod.website-files.com/abc/nb.woff2',
    ...overrides,
  };
}

describe('formatFileSize', () => {
  it('reads in whole units', () => {
    // No font is under a kilobyte, so KB is the smallest unit worth printing.
    expect(formatFileSize(512)).toBe('1 KB');
    expect(formatFileSize(49152)).toBe('48 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('is null rather than zero when the size is unknown', () => {
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize(undefined)).toBeNull();
  });
});

describe('fontSourceLine', () => {
  it('names the host, the format, and the size, and never the URL', () => {
    const source = {
      kind: 'self-hosted' as const,
      url: 'https://cdn.prod.website-files.com/abc/nb.woff2',
      format: 'woff2',
      subset: null,
    };
    const line = fontSourceLine(source, 49152);
    expect(line).toBe('Self-hosted on cdn.prod.website-files.com · woff2 · 48 KB');
    expect(line).not.toContain('/abc/');
  });

  it('says a system font was never downloaded', () => {
    expect(
      fontSourceLine({ kind: 'system', url: null, format: null, subset: null }),
    ).toBe('System font, nothing was downloaded');
  });

  it('omits the size when the file has not been read', () => {
    expect(
      fontSourceLine({ kind: 'google', url: 'https://fonts.gstatic.com/s/inter/x.woff2', format: 'woff2', subset: null }),
    ).toBe('Google Fonts · fonts.gstatic.com · woff2');
  });
});

describe('providerLink', () => {
  it('points at the specimen page for each provider', () => {
    expect(providerLink('google', 'Playfair Display')?.url).toBe(
      'https://fonts.google.com/specimen/Playfair+Display',
    );
    expect(providerLink('adobe', 'Brandon Grotesque')?.url).toBe(
      'https://fonts.adobe.com/search?query=Brandon%20Grotesque',
    );
    expect(providerLink('fontshare', 'General Sans')?.url).toBe(
      'https://www.fontshare.com/fonts/general-sans',
    );
  });

  it('has nowhere to send a self-hosted or system family', () => {
    expect(providerLink('self-hosted', 'NB International Pro')).toBeNull();
    expect(providerLink('system', 'Georgia')).toBeNull();
  });
});

describe('identity presentation', () => {
  it('shows the typeface name over the CSS alias, and keeps the alias', () => {
    expect(displayFamily('Nb international pro webfont', identity())).toBe('NB International Pro');
    expect(aliasDiffers('Nb international pro webfont', identity())).toBe(true);
    // A site that names the family correctly has nothing extra to say.
    expect(aliasDiffers('NB International Pro', identity())).toBe(false);
    expect(displayFamily('Nb international pro webfont', null)).toBe('Nb international pro webfont');
  });

  it('credits the designer and the foundry when they differ', () => {
    expect(designerLine(identity())).toBe('by Stefan Gandl for Neubau Berlin');
    expect(designerLine(identity({ designer: null }))).toBe('by Neubau Berlin');
    expect(designerLine(identity({ designer: null, manufacturer: null }))).toBeNull();
  });

  it('writes one line for an export', () => {
    expect(
      identityDescription('Nb international pro webfont', identity(), 'self-hosted'),
    ).toBe(
      "NB International Pro Regular by Stefan Gandl for Neubau Berlin (declared as 'Nb international pro webfont'), self-hosted",
    );
    expect(identityDescription('Inter', null, 'google')).toBeNull();
  });

  it('describes a variable axis as a range', () => {
    expect(axisChipText({ tag: 'wght', name: 'Weight', min: 100, max: 900, default: 400 })).toBe(
      'wght 100 to 900',
    );
  });

  it('takes the first sentence of a licence description', () => {
    expect(firstSentence('Licensed for web use. Redistribution is not permitted.')).toBe(
      'Licensed for web use.',
    );
    expect(firstSentence(null)).toBeNull();
  });

  it('says what each confidence label is claiming', () => {
    expect(confidenceEvidence('verified')).toContain('Measured');
    expect(confidenceEvidence('matched')).toContain('Not proof');
    expect(confidenceEvidence('matched', 'fallback')).toContain('the fallback painted this');
    expect(confidenceEvidence('declared')).toContain('first family in the CSS stack');
  });
});
