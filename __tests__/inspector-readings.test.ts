import { beforeEach, describe, expect, it } from 'vitest';

import type { ElementScanRecord, FontConfidence } from '../lib/contracts';
import { gatherEvidence } from '../lib/inspector/evidence';
import {
  buildSnapshot,
  findSourceExpressions,
  parseSrcset,
  readSourceContext,
  rendersOwnText,
  resolveUrl,
} from '../lib/inspector/readings';
import { buildFontRecords, buildScanRecord } from '../lib/inspector/scan';
import { resetRenderCheckCache, type DocumentFontsResult } from '../lib/readings/fonts';

function pick(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`fixture is missing ${selector}`);
  return element;
}

const identify = (family: string): { reading: string; confidence: FontConfidence } => ({
  reading: family || 'Unknown',
  confidence: 'declared',
});

function record(element: Element): ElementScanRecord {
  return buildScanRecord(element, getComputedStyle(element), identify);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('readSourceContext', () => {
  it('records the viewport and the inspected root font size', () => {
    const source = readSourceContext(document);
    expect(source.rootFontSize).toBeGreaterThan(0);
    expect(source.viewport.width).toBe(window.innerWidth);
    expect(source.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('parseSrcset', () => {
  it('reads candidates with their descriptors and resolves them', () => {
    expect(parseSrcset('a.png 240w, b.png 2x', 'https://example.com/page/')).toEqual([
      { url: 'https://example.com/page/a.png', descriptor: '240w' },
      { url: 'https://example.com/page/b.png', descriptor: '2x' },
    ]);
  });

  it('accepts a bare candidate', () => {
    expect(parseSrcset('a.png', 'https://example.com/')).toEqual([
      { url: 'https://example.com/a.png', descriptor: null },
    ]);
  });

  it('returns nothing for an absent attribute', () => {
    expect(parseSrcset(null, 'https://example.com/')).toEqual([]);
  });

  it('keeps an unparseable url as written', () => {
    expect(resolveUrl('::::', 'not a base')).toBe('::::');
  });
});

describe('rendersOwnText', () => {
  it('is true for direct text and for controls with text', () => {
    document.body.innerHTML = `
      <div id="wrap"><p id="text">Hello</p></div>
      <button id="cta">Go</button>
      <input id="filled" value="typed" />
      <input id="empty" />
      <input id="hidden" type="hidden" value="x" />`;
    expect(rendersOwnText(pick('#text'))).toBe(true);
    expect(rendersOwnText(pick('#wrap'))).toBe(false);
    expect(rendersOwnText(pick('#cta'))).toBe(true);
    expect(rendersOwnText(pick('#filled'))).toBe(true);
    expect(rendersOwnText(pick('#empty'))).toBe(false);
    expect(rendersOwnText(pick('#hidden'))).toBe(false);
  });
});

describe('buildSnapshot', () => {
  it('describes the element, its ancestors, and its layout', () => {
    document.body.innerHTML =
      '<main><section id="hero"><h1 id="hero-heading">Hi</h1></section></main>';
    const snapshot = buildSnapshot(pick('#hero-heading'), { deep: false });

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.element).toMatchObject({ tag: 'h1', label: 'h1#hero-heading', locator: '#hero-heading' });
    expect(snapshot.ancestors.map((ancestor) => ancestor.label)).toEqual([
      'section#hero',
      'main',
      'body',
    ]);
    expect(snapshot.layout.display).toBeTypeOf('string');
    expect(snapshot.typography).not.toBeNull();
    expect(snapshot.typography?.familyConfidence).not.toBe('verified');
  });

  it('upgrades a matched family to verified only when the canvas says it rendered (TYP-02)', () => {
    // The weight is set explicitly: jsdom's default stylesheet makes an h1
    // bold, and a 400 face does not cover 700.
    document.body.innerHTML =
      '<h1 id="heading" style="font-family: Satoshi, serif; font-weight: 400">Hi</h1>';
    const fonts: DocumentFontsResult = {
      faces: [
        {
          family: 'Satoshi',
          weight: '400',
          style: 'normal',
          urls: ['https://cdn.example.invalid/satoshi.woff2'],
          format: 'woff2',
          unicodeRange: null,
          status: 'loaded',
        },
      ],
      providerUrls: [],
      limitations: [],
    };

    // A canvas that says the family paints at a different width than either
    // fallback. That measurement is the whole of the evidence for `verified`.
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function stub(this: HTMLCanvasElement) {
      return {
        font: '',
        measureText(this: { font: string }) {
          return { width: this.font.includes('Satoshi') ? 300 : 500 };
        },
      } as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;

    try {
      resetRenderCheckCache();
      const shallow = buildSnapshot(pick('#heading'), { deep: false, fonts });
      // Hover never pays for the measurement, so it never claims verified.
      expect(shallow.typography?.renderCheck ?? null).toBeNull();
      expect(shallow.typography?.familyConfidence).toBe('matched');

      resetRenderCheckCache();
      const deep = buildSnapshot(pick('#heading'), { deep: true, fonts });
      expect(deep.typography?.renderCheck).toBe('rendered');
      expect(deep.typography?.familyConfidence).toBe('verified');
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
      resetRenderCheckCache();
    }
  });

  it('never reaches verified for a family with no loaded face, however it measures', () => {
    document.body.innerHTML = '<h1 id="heading" style="font-family: Ghost, serif">Hi</h1>';
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function stub(this: HTMLCanvasElement) {
      return {
        font: '',
        measureText(this: { font: string }) {
          return { width: this.font.includes('Ghost') ? 300 : 500 };
        },
      } as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;

    try {
      resetRenderCheckCache();
      const deep = buildSnapshot(pick('#heading'), { deep: true });
      expect(deep.typography?.familyConfidence).toBe('declared');
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
      resetRenderCheckCache();
    }
  });

  it('reads typography for an element whose text sits in a child', () => {
    document.body.innerHTML = '<h1 id="wrapped"><span>Wrapped</span></h1>';
    const snapshot = buildSnapshot(pick('#wrapped'), { deep: false });
    expect(snapshot.typography).not.toBeNull();
  });

  it('discloses a text child that is styled differently from the container', () => {
    document.body.innerHTML =
      '<h1 id="wrapped" style="font-size: 40px"><span id="inner" style="font-size: 12px">Wrapped</span></h1>';
    const snapshot = buildSnapshot(pick('#wrapped'), { deep: false });
    // The reading is the container's own computed style, as selected.
    expect(snapshot.typography?.sizePx).toBe(40);
    expect(
      snapshot.limitations.some(
        (note) =>
          note.startsWith('Text inside this element is styled by span#inner') &&
          note.includes("container's inherited values"),
      ),
    ).toBe(true);
  });

  it('omits typography for an element that renders no text at all', () => {
    document.body.innerHTML = '<section id="wrap"><span>   </span></section>';
    expect(buildSnapshot(pick('#wrap'), { deep: false }).typography).toBeNull();
  });

  it('skips text that is not rendered', () => {
    document.body.innerHTML =
      '<section id="wrap"><span style="display: none">Hidden</span></section>';
    expect(buildSnapshot(pick('#wrap'), { deep: false }).typography).toBeNull();
  });

  it('keeps line-height normal instead of inventing a measurement', () => {
    document.body.innerHTML = '<p id="p" style="line-height: normal">Hello</p>';
    const typography = buildSnapshot(pick('#p'), { deep: false }).typography;
    expect(typography?.lineHeightRaw).toBe('normal');
    expect(typography?.lineHeightPx).toBeNull();
    expect(typography?.lineHeightRatio).toBeNull();
  });

  it('derives rem from the inspected root font size', () => {
    document.documentElement.style.fontSize = '20px';
    document.body.innerHTML = '<p id="p" style="font-size: 40px">Hello</p>';
    const snapshot = buildSnapshot(pick('#p'), { deep: false });
    expect(snapshot.source.rootFontSize).toBe(20);
    expect(snapshot.typography?.sizePx).toBe(40);
    expect(snapshot.typography?.sizeRem).toBe(2);
    document.documentElement.style.fontSize = '';
  });

  it('reads letter spacing as 0 for normal and em against the size', () => {
    document.body.innerHTML =
      '<p id="a" style="font-size: 20px; letter-spacing: normal">A</p><p id="b" style="font-size: 20px; letter-spacing: -0.4px">B</p>';
    const a = buildSnapshot(pick('#a'), { deep: false }).typography;
    expect(a?.letterSpacingPx).toBe(0);
    const b = buildSnapshot(pick('#b'), { deep: false }).typography;
    expect(b?.letterSpacingPx).toBe(-0.4);
    expect(b?.letterSpacingEm).toBeCloseTo(-0.02, 6);
  });

  it('collects an image asset with its candidates', () => {
    document.body.innerHTML =
      '<img id="hero-img" alt="Hero" src="https://example.com/a.png" srcset="https://example.com/a.png 240w, https://example.com/b.png 480w" />';
    const snapshot = buildSnapshot(pick('#hero-img'), { deep: false });
    const asset = snapshot.assets[0];
    expect(asset?.kind).toBe('img');
    expect(asset?.alt).toBe('Hero');
    expect(asset?.candidates.map((candidate) => candidate.descriptor)).toEqual(['240w', '480w', null]);
    expect(asset?.fileSize).toBeNull();
    expect(asset?.mimeType).toBeNull();
  });

  it('reports a css background layer as an asset', () => {
    document.body.innerHTML =
      '<div id="bg" style="background-image: url(pattern.png)">content</div>';
    const snapshot = buildSnapshot(pick('#bg'), { deep: false });
    expect(snapshot.assets.some((asset) => asset.kind === 'css-background')).toBe(true);
  });

  it('marks contrast as not yet calculated on a shallow reading', () => {
    document.body.innerHTML = '<p id="p">Hello</p>';
    const contrast = buildSnapshot(pick('#p'), { deep: false }).typography?.contrast;
    expect(contrast?.ratio).toBeNull();
    expect(contrast?.status).toBe('unavailable');
  });
});

describe('findSourceExpressions', () => {
  function fakeRule(selectorText: string, declarations: Record<string, string>) {
    const properties = Object.keys(declarations);
    return {
      selectorText,
      style: {
        length: properties.length,
        item: (index: number) => properties[index] ?? null,
        getPropertyValue: (property: string) => declarations[property] ?? '',
      },
      // Modern engines expose cssRules on style rules too, for CSS nesting.
      cssRules: { length: 0 },
    };
  }

  function withSheets<T>(sheets: unknown[], run: () => T): T {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'styleSheets');
    Object.defineProperty(document, 'styleSheets', { value: sheets, configurable: true });
    try {
      return run();
    } finally {
      delete (document as unknown as Record<string, unknown>).styleSheets;
      if (original) Object.defineProperty(Document.prototype, 'styleSheets', original);
    }
  }

  it('reads an authored expression that matches the element', () => {
    document.body.innerHTML = '<main id="m">Hi</main>';
    const rule = fakeRule('main', {
      'max-width': 'clamp(320px, 90vw, 960px)',
      color: 'rgb(0, 0, 0)',
    });
    const expressions = withSheets([{ cssRules: [rule], href: null }], () =>
      findSourceExpressions(pick('#m')),
    );
    expect(expressions).toEqual({ 'max-width': 'clamp(320px, 90vw, 960px)' });
  });

  it('ignores rules that do not match the element', () => {
    document.body.innerHTML = '<main id="m">Hi</main>';
    const rule = fakeRule('aside', { padding: 'calc(1rem + 2px)' });
    const expressions = withSheets([{ cssRules: [rule], href: null }], () =>
      findSourceExpressions(pick('#m')),
    );
    expect(expressions).toEqual({});
  });

  it('descends into grouping rules such as media queries', () => {
    document.body.innerHTML = '<main id="m">Hi</main>';
    const inner = fakeRule('main', { 'font-size': 'clamp(1rem, 2vw, 2rem)' });
    const media = { cssRules: { length: 1, 0: inner } };
    const expressions = withSheets([{ cssRules: [media], href: null }], () =>
      findSourceExpressions(pick('#m')),
    );
    expect(expressions).toEqual({ 'font-size': 'clamp(1rem, 2vw, 2rem)' });
  });

  it('skips a stylesheet whose rules cannot be read', () => {
    document.body.innerHTML = '<main id="m">Hi</main>';
    const blocked = {
      get cssRules(): never {
        throw new Error('cross origin');
      },
    };
    const expressions = withSheets([blocked], () => findSourceExpressions(pick('#m')));
    expect(expressions).toEqual({});
  });
});

describe('buildScanRecord', () => {
  it('sets hasOwnText only for the element that owns the text', () => {
    document.body.innerHTML = '<section id="wrap"><p id="text">Hello</p></section>';
    expect(record(pick('#text')).hasOwnText).toBe(true);
    expect(record(pick('#text')).typography).not.toBeNull();
    expect(record(pick('#wrap')).hasOwnText).toBe(false);
    expect(record(pick('#wrap')).typography).toBeNull();
  });

  it('reports a fully transparent background as null', () => {
    document.body.innerHTML = '<div id="d">x</div>';
    expect(record(pick('#d')).backgroundColor).toBeNull();
  });

  it('keeps a painted background', () => {
    document.body.innerHTML = '<div id="d" style="background-color: rgb(255, 0, 0)">x</div>';
    expect(record(pick('#d')).backgroundColor?.hex).toBe('#ff0000');
  });

  it('only lists border colors for visible sides', () => {
    document.body.innerHTML =
      '<div id="d" style="border-top-width: 2px; border-top-style: solid; border-top-color: rgb(1, 2, 3); border-left-width: 2px; border-left-style: none; border-left-color: rgb(9, 9, 9)">x</div>';
    const colors = record(pick('#d')).borderColors;
    expect(colors).toHaveLength(1);
    expect(colors[0]?.hex).toBe('#010203');
  });

  it('records the gap for flex and grid containers only', () => {
    document.body.innerHTML =
      '<div id="flex" style="display: flex; row-gap: 12px; column-gap: 20px">x</div><div id="block">y</div>';
    expect(record(pick('#flex')).gap).toEqual({ row: 12, column: 20 });
    expect(record(pick('#block')).gap).toBeNull();
  });

  it('carries a locator and a label for traceability', () => {
    document.body.innerHTML = '<section id="hero"><h1>Hi</h1></section>';
    const row = record(pick('h1'));
    expect(row.locator).toBe('#hero > h1:nth-of-type(1)');
    expect(row.label).toBe('h1 "Hi"');
  });
});

describe('buildFontRecords', () => {
  const fonts: DocumentFontsResult = {
    faces: [
      {
        family: 'Satoshi',
        weight: '400',
        style: 'normal',
        urls: ['https://example.com/satoshi.woff2'],
        format: 'woff2',
        unicodeRange: null,
        status: 'loaded',
      },
      {
        family: 'Unused Face',
        weight: '400',
        style: 'normal',
        urls: ['https://example.com/unused.woff2'],
        format: 'woff2',
        unicodeRange: null,
        status: 'unloaded',
      },
    ],
    providerUrls: [],
    limitations: [],
  };

  const records = [
    {
      typography: { familyReading: 'Satoshi', weight: 400 },
    },
    {
      typography: { familyReading: 'Georgia', weight: 700 },
    },
  ] as unknown as ElementScanRecord[];

  it('separates declarations, load status, and content matches', () => {
    const out = buildFontRecords(fonts, records, 'https://example.com');
    const satoshi = out.find((font) => font.family === 'Satoshi');
    expect(satoshi).toMatchObject({ declared: true, loaded: true, matchedToContent: true });
    const unused = out.find((font) => font.family === 'Unused Face');
    expect(unused).toMatchObject({ declared: true, loaded: false, matchedToContent: false });
  });

  it('adds a system family seen in content as not declared', () => {
    const out = buildFontRecords(fonts, records, 'https://example.com');
    const georgia = out.find((font) => font.family === 'Georgia');
    expect(georgia).toMatchObject({ declared: false, loaded: null, matchedToContent: true });
    expect(georgia?.source.kind).toBe('system');
    expect(georgia?.weights).toEqual(['700']);
  });
});

describe('gatherEvidence', () => {
  it('collects urls, meta, markers, inline script ids, and html attributes', () => {
    document.documentElement.setAttribute('data-framer-hydrate-v2', '1');
    document.head.innerHTML =
      '<meta name="generator" content="Next.js" /><link rel="stylesheet" href="https://cdn.example.com/bootstrap.min.css" /><link rel="preconnect" href="https://fonts.gstatic.com" />';
    document.body.innerHTML =
      '<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{}</script>';

    const evidence = gatherEvidence(['next'], document);
    expect(evidence.meta).toEqual([{ name: 'generator', content: 'Next.js' }]);
    expect(evidence.stylesheetUrls.join(' ')).toContain('bootstrap.min.css');
    expect(evidence.linkUrls.join(' ')).toContain('fonts.gstatic.com');
    expect(evidence.domMarkers).toContain('#__next');
    expect(evidence.domMarkers).toContain('link[href*="bootstrap"]');
    expect(evidence.inlineScriptIds).toContain('__NEXT_DATA__');
    expect(evidence.htmlAttributes).toContain('data-framer-hydrate-v2');
    expect(evidence.globals).toEqual(['next']);
    expect(evidence.headers).toEqual([]);

    document.documentElement.removeAttribute('data-framer-hydrate-v2');
    document.head.innerHTML = '';
  });

  it('never throws on an empty document', () => {
    expect(() => gatherEvidence([], document)).not.toThrow();
  });
});
