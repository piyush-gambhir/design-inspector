import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isAddressableVideoUrl, listAssets, readVideoAssets } from '../lib/inspector/assets';

const original = Element.prototype.getBoundingClientRect;

function domRect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** jsdom measures everything as zero, so sizes are stated per element here. */
function sizeBy(sizes: (element: Element) => [number, number]): void {
  Element.prototype.getBoundingClientRect = function stub(this: Element) {
    const [width, height] = sizes(this);
    return domRect(width, height);
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = original;
});

describe('listAssets', () => {
  it('counts repeat references in usageCount instead of a limitation', () => {
    document.body.innerHTML = `
      <img id="a" src="https://cdn.example.com/icon.png" />
      <img id="b" src="https://cdn.example.com/icon.png" />
      <img id="c" src="https://cdn.example.com/icon.png" />`;
    sizeBy(() => [24, 24]);

    const assets = listAssets(document);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.usageCount).toBe(3);
    expect(assets[0]?.limitations.some((note) => note.startsWith('Used '))).toBe(false);
  });

  it('gives a unique asset a usage count of one', () => {
    document.body.innerHTML = '<img id="a" src="https://cdn.example.com/hero.png" />';
    sizeBy(() => [400, 200]);
    expect(listAssets(document)[0]?.usageCount).toBe(1);
  });

  it('says when an asset renders at no visible size', () => {
    document.body.innerHTML = '<img id="a" src="https://cdn.example.com/hero.png" />';
    sizeBy(() => [0, 120]);

    const asset = listAssets(document)[0];
    expect(asset?.limitations).toContain('Not rendered at a visible size');
  });

  it('keeps the not-loaded wording when the browser picked no source at all', () => {
    document.body.innerHTML = '<img id="a" alt="Lazy" />';
    sizeBy(() => [0, 0]);

    const asset = listAssets(document)[0];
    expect(asset?.limitations.some((note) => note.startsWith('Not loaded yet'))).toBe(true);
    expect(asset?.limitations).not.toContain('Not rendered at a visible size');
  });

  it('leaves a rendered asset without either note', () => {
    document.body.innerHTML = '<img id="a" src="https://cdn.example.com/hero.png" />';
    sizeBy(() => [400, 200]);

    const asset = listAssets(document)[0];
    expect(asset?.limitations).not.toContain('Not rendered at a visible size');
    expect(asset?.limitations).not.toContain('Not loaded yet');
  });
});

/** jsdom has no media pipeline, so currentSrc and the intrinsic size are set. */
function media(element: Element, values: { currentSrc?: string; width?: number; height?: number }): void {
  if (values.currentSrc !== undefined) {
    Object.defineProperty(element, 'currentSrc', { value: values.currentSrc, configurable: true });
  }
  if (values.width !== undefined) {
    Object.defineProperty(element, 'videoWidth', { value: values.width, configurable: true });
  }
  if (values.height !== undefined) {
    Object.defineProperty(element, 'videoHeight', { value: values.height, configurable: true });
  }
}

describe('isAddressableVideoUrl', () => {
  it('accepts an http(s) URL whose path looks like a video file', () => {
    expect(isAddressableVideoUrl('https://cdn.example.com/clip.mp4', null)).toBe(true);
    expect(isAddressableVideoUrl('http://cdn.example.com/a/b/clip.webm', null)).toBe(true);
  });

  it('accepts an extensionless URL when the declared type says video', () => {
    expect(isAddressableVideoUrl('https://cdn.example.com/stream', 'video/mp4')).toBe(true);
    expect(isAddressableVideoUrl('https://cdn.example.com/stream', 'application/json')).toBe(false);
  });

  it('refuses a playlist, a blob and anything that is not http', () => {
    expect(isAddressableVideoUrl('https://cdn.example.com/master.m3u8', 'video/mp4')).toBe(false);
    expect(isAddressableVideoUrl('https://cdn.example.com/manifest.mpd', null)).toBe(false);
    expect(isAddressableVideoUrl('blob:https://example.com/abc', 'video/mp4')).toBe(false);
    expect(isAddressableVideoUrl('data:video/mp4;base64,AAAA', 'video/mp4')).toBe(false);
    expect(isAddressableVideoUrl('not a url', null)).toBe(false);
  });
});

describe('readVideoAssets', () => {
  it('reads the selected file, its candidates and both sizes', () => {
    document.body.innerHTML = `
      <video id="v">
        <source src="https://cdn.example.com/clip.webm" type="video/webm" />
        <source src="https://cdn.example.com/clip.mp4" type="video/mp4" />
      </video>`;
    sizeBy(() => [640, 360]);
    const element = document.querySelector('#v') as Element;
    media(element, { currentSrc: 'https://cdn.example.com/clip.mp4', width: 1920, height: 1080 });

    const [video] = readVideoAssets(element);
    expect(video?.kind).toBe('video');
    expect(video?.url).toBe('https://cdn.example.com/clip.mp4');
    expect(video?.mimeType).toBe('video/mp4');
    expect(video?.renderedWidth).toBe(640);
    expect(video?.intrinsicWidth).toBe(1920);
    expect(video?.intrinsicHeight).toBe(1080);
    expect(video?.candidates.map((candidate) => candidate.url)).toEqual([
      'https://cdn.example.com/clip.mp4',
      'https://cdn.example.com/clip.webm',
    ]);
    expect(video?.limitations).toEqual([]);
  });

  it('never promises a file for a blob-backed or MediaSource video', () => {
    document.body.innerHTML = '<video id="v"></video>';
    sizeBy(() => [640, 360]);
    const element = document.querySelector('#v') as Element;
    media(element, { currentSrc: 'blob:https://example.com/9f2a', width: 1280, height: 720 });

    const [video] = readVideoAssets(element);
    expect(video?.url).toBeNull();
    expect(video?.candidates).toEqual([]);
    expect(video?.limitations).toContain('Streamed video, no downloadable file');
  });

  it('lists the poster as its own image asset', () => {
    document.body.innerHTML =
      '<video id="v" poster="https://cdn.example.com/poster.jpg" src="https://cdn.example.com/clip.mp4"></video>';
    sizeBy(() => [640, 360]);
    const element = document.querySelector('#v') as Element;
    media(element, { currentSrc: 'https://cdn.example.com/clip.mp4' });

    const assets = readVideoAssets(element);
    expect(assets).toHaveLength(2);
    expect(assets[1]).toMatchObject({
      kind: 'img',
      url: 'https://cdn.example.com/poster.jpg',
      limitations: ['Poster image'],
    });
  });

  it('says so when a video declares sources but none is addressable', () => {
    document.body.innerHTML = `
      <video id="v"><source src="https://cdn.example.com/master.m3u8" type="application/x-mpegURL" /></video>`;
    sizeBy(() => [640, 360]);
    const element = document.querySelector('#v') as Element;
    media(element, { currentSrc: 'https://cdn.example.com/master.m3u8' });

    const [video] = readVideoAssets(element);
    expect(video?.url).toBeNull();
    expect(video?.limitations).toEqual([
      'No directly addressable video file was discovered for this element.',
    ]);
  });
});

describe('listAssets with video', () => {
  it('lists a video and its poster, and reads no <source> on its own', () => {
    document.body.innerHTML = `
      <video id="v" poster="https://cdn.example.com/poster.jpg">
        <source src="https://cdn.example.com/clip.mp4" type="video/mp4" />
      </video>`;
    sizeBy(() => [640, 360]);
    media(document.querySelector('#v') as Element, {
      currentSrc: 'https://cdn.example.com/clip.mp4',
    });

    const assets = listAssets(document);
    expect(assets.map((asset) => asset.kind)).toEqual(['video', 'img']);
    expect(assets[0]?.url).toBe('https://cdn.example.com/clip.mp4');
    expect(assets[1]?.limitations).toEqual(['Poster image']);
  });

  it('keeps two streamed videos apart instead of folding them into one row', () => {
    document.body.innerHTML = '<video id="a"></video><video id="b"></video>';
    sizeBy(() => [320, 180]);
    media(document.querySelector('#a') as Element, { currentSrc: 'blob:https://example.com/1' });
    media(document.querySelector('#b') as Element, { currentSrc: 'blob:https://example.com/2' });

    const assets = listAssets(document);
    expect(assets).toHaveLength(2);
    expect(assets.every((asset) => asset.url === null)).toBe(true);
    // A streamed video explains itself, so it is never also "not loaded yet".
    for (const asset of assets) {
      expect(asset.limitations).toEqual(['Streamed video, no downloadable file']);
    }
  });

  it('counts a poster shared by two videos once', () => {
    document.body.innerHTML = `
      <video id="a" poster="https://cdn.example.com/p.jpg" src="https://cdn.example.com/a.mp4"></video>
      <video id="b" poster="https://cdn.example.com/p.jpg" src="https://cdn.example.com/b.mp4"></video>`;
    sizeBy(() => [320, 180]);
    media(document.querySelector('#a') as Element, { currentSrc: 'https://cdn.example.com/a.mp4' });
    media(document.querySelector('#b') as Element, { currentSrc: 'https://cdn.example.com/b.mp4' });

    const posters = listAssets(document).filter((asset) => asset.kind === 'img');
    expect(posters).toHaveLength(1);
    expect(posters[0]?.usageCount).toBe(2);
  });
});
