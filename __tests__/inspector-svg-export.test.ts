import { beforeEach, describe, expect, it } from 'vitest';

import { serializeInlineSvg, svgDataUrl } from '../lib/inspector/svg-export';

/** Fake computed paint, since jsdom does not resolve SVG presentation styles. */
function paint(values: Record<string, string>) {
  return (): CSSStyleDeclaration =>
    ({
      getPropertyValue: (property: string) => values[property] ?? '',
    }) as unknown as CSSStyleDeclaration;
}

function svg(): SVGElement {
  return document.querySelector('#icon') as unknown as SVGElement;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('serializeInlineSvg', () => {
  it('adds both namespaces once', () => {
    document.body.innerHTML = '<svg id="icon" viewBox="0 0 10 10"><path d="M0 0 L10 10" /></svg>';
    const { markup } = serializeInlineSvg(svg(), { getStyle: paint({}) });
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(markup.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
  });

  it('removes script elements, on* handlers, and javascript hrefs', () => {
    document.body.innerHTML = `
      <svg id="icon" viewBox="0 0 10 10" onload="alert(1)">
        <script>alert(2)</script>
        <a href="javascript:alert(3)"><rect width="10" height="10" onclick="alert(4)" /></a>
      </svg>`;
    const { markup } = serializeInlineSvg(svg(), { getStyle: paint({}) });
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('onload');
    expect(markup).not.toContain('onclick');
    expect(markup).not.toContain('javascript:');
    expect(markup).toContain('<rect');
  });

  it('copies a <use> target from the document into the clone', () => {
    document.body.innerHTML = `
      <svg id="library" aria-hidden="true">
        <symbol id="logo-mark" viewBox="0 0 48 48"><path d="M8 40 L24 8 L40 40 Z" /></symbol>
      </svg>
      <svg id="icon" viewBox="0 0 48 48"><use href="#logo-mark" /></svg>`;
    const { markup, limitations } = serializeInlineSvg(svg(), { getStyle: paint({}) });
    expect(markup).toContain('<defs');
    expect(markup).toContain('id="logo-mark"');
    expect(markup).toContain('M8 40 L24 8 L40 40 Z');
    expect(limitations).toEqual([]);
  });

  it('reports a missing <use> target instead of claiming a complete export', () => {
    document.body.innerHTML = '<svg id="icon"><use href="#absent" /></svg>';
    const { limitations } = serializeInlineSvg(svg(), { getStyle: paint({}) });
    expect(limitations.join(' ')).toContain('#absent');
  });

  it('reports references that still point outside the document', () => {
    document.body.innerHTML =
      '<svg id="icon"><image href="https://cdn.example.com/photo.png" /></svg>';
    const { limitations } = serializeInlineSvg(svg(), { getStyle: paint({}) });
    expect(limitations.join(' ')).toContain('https://cdn.example.com/photo.png');
  });

  it('inlines computed paint when it differs from the attribute', () => {
    document.body.innerHTML =
      '<svg id="icon" viewBox="0 0 10 10"><path d="M0 0" fill="red" /></svg>';
    const { markup } = serializeInlineSvg(svg(), {
      getStyle: paint({
        fill: 'rgb(56, 116, 203)',
        stroke: 'rgb(16, 24, 40)',
        'stroke-width': '2px',
        opacity: '1',
      }),
    });
    expect(markup).toContain('fill="rgb(56, 116, 203)"');
    expect(markup).toContain('stroke="rgb(16, 24, 40)"');
    expect(markup).toContain('stroke-width="2px"');
  });

  it('keeps an attribute that already matches the computed value', () => {
    document.body.innerHTML = '<svg id="icon"><path d="M0 0" fill="none" /></svg>';
    const { markup } = serializeInlineSvg(svg(), { getStyle: paint({ fill: 'none' }) });
    expect(markup).toContain('fill="none"');
  });
});

describe('svgDataUrl', () => {
  it('encodes the markup for a download', () => {
    expect(svgDataUrl('<svg><g/></svg>')).toBe(
      'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3Cg%2F%3E%3C%2Fsvg%3E',
    );
  });
});
