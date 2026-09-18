// Page asset list (PRD AST-04).
//
// Discovery is passive: nothing is scrolled, clicked, or fetched, so a lazy
// image that has not loaded is reported as such instead of being forced into
// existence. Repeated resources collapse into one row that carries its usage
// count.

import type { AssetCandidate, AssetReading } from '../contracts';
import { extractUrls, splitCssList } from '../readings/units';
import { HOST_TAG } from './overlay';
import { readAssets } from './readings';
import { serializeInlineSvg } from './svg-export';

const MAX_ELEMENTS_SCANNED = 8000;
/** A rendered box of zero width or height means nothing is actually visible. */
const NOT_VISIBLE = 'Not rendered at a visible size';
/** PRD AST-01: a blob: or MediaSource-backed video has no file to offer. */
export const STREAMED_VIDEO = 'Streamed video, no downloadable file';
/** The poster is a real image asset, listed separately from the video. */
export const POSTER_IMAGE = 'Poster image';

/** Extensions that make a URL path look like an addressable video file. */
const VIDEO_EXTENSION = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|avi)$/i;

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16);
}

function keyFor(asset: AssetReading): string {
  if (asset.kind === 'svg-inline') return `svg:${hash(asset.svgMarkup ?? '')}`;
  if (asset.url) return `url:${asset.url}`;
  return `unloaded:${asset.candidates.map((candidate) => candidate.url).join('|') || hash(asset.alt ?? '')}`;
}

function isExtensionUi(element: Element): boolean {
  return element.tagName.toLowerCase() === HOST_TAG || !!element.closest(HOST_TAG);
}

function resolveUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * True for a URL we could actually hand to a download: an http(s) address whose
 * path looks like a file, or one whose declared type says it is video. A
 * playlist (`.m3u8`, `.mpd`) is deliberately excluded: it is a manifest, not a
 * file, and offering it as a download would be a promise we cannot keep
 * (PRD AST-01).
 */
export function isAddressableVideoUrl(url: string, type: string | null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (/\.(m3u8|mpd)$/i.test(parsed.pathname)) return false;
  if (VIDEO_EXTENSION.test(parsed.pathname)) return true;
  return (type ?? '').trim().toLowerCase().startsWith('video/');
}

/**
 * Assets for one `<video>`: the video itself, plus its poster as a separate
 * image row (PRD AST-01 Phase 2). A blob: or MediaSource-backed video is listed
 * with `url: null` and says so rather than pretending a file exists.
 */
export function readVideoAssets(element: Element): AssetReading[] {
  const video = element as HTMLVideoElement;
  const baseUrl = element.ownerDocument?.baseURI ?? '';
  const rect = element.getBoundingClientRect();

  const candidates: AssetCandidate[] = [];
  const seen = new Set<string>();
  const consider = (raw: string | null, type: string | null): void => {
    const resolved = resolveUrl((raw ?? '').trim(), baseUrl);
    if (resolved === '' || seen.has(resolved)) return;
    if (!isAddressableVideoUrl(resolved, type)) return;
    seen.add(resolved);
    candidates.push({ url: resolved, descriptor: type && type.trim() !== '' ? type.trim() : null });
  };

  // The declared sources come first so each candidate keeps its own type,
  // then currentSrc is added if the browser chose something else entirely.
  consider(element.getAttribute('src'), element.getAttribute('type'));
  for (const source of Array.from(element.querySelectorAll('source'))) {
    consider(source.getAttribute('src'), source.getAttribute('type'));
  }
  const currentSrc = typeof video.currentSrc === 'string' ? video.currentSrc : '';
  consider(currentSrc, null);
  // What the browser actually plays leads the list (PRD AST-01).
  const chosen = candidates.findIndex((candidate) => candidate.url === currentSrc);
  if (chosen > 0) candidates.unshift(...candidates.splice(chosen, 1));

  const limitations: string[] = [];
  // currentSrc is empty until the browser selects a source (and always in
  // jsdom), so the declared src attribute is checked as well.
  const declaredSrc = (element.getAttribute('src') ?? '').trim();
  const streamed = [currentSrc, declaredSrc].some(
    (value) => value.startsWith('blob:') || value.startsWith('mediastream:'),
  );
  if (streamed) limitations.push(STREAMED_VIDEO);

  const selected = candidates.find((candidate) => candidate.url === currentSrc) ?? candidates[0];
  const url = streamed ? null : (selected?.url ?? null);
  if (!streamed && url === null && (currentSrc !== '' || element.querySelector('source'))) {
    limitations.push('No directly addressable video file was discovered for this element.');
  }

  const intrinsicWidth = Number.isFinite(video.videoWidth) && video.videoWidth > 0 ? video.videoWidth : null;
  const intrinsicHeight =
    Number.isFinite(video.videoHeight) && video.videoHeight > 0 ? video.videoHeight : null;

  const assets: AssetReading[] = [
    {
      kind: 'video',
      url,
      candidates,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      intrinsicWidth,
      intrinsicHeight,
      fileSize: null,
      mimeType: selected?.descriptor ?? null,
      svgMarkup: null,
      alt: element.getAttribute('aria-label'),
      limitations,
    },
  ];

  const poster = resolveUrl((element.getAttribute('poster') ?? '').trim(), baseUrl);
  if (poster !== '') {
    assets.push({
      kind: 'img',
      url: poster,
      candidates: [{ url: poster, descriptor: null }],
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      // The poster is never decoded by the video element, so its own pixel
      // dimensions are not observable from here.
      intrinsicWidth: null,
      intrinsicHeight: null,
      fileSize: null,
      mimeType: null,
      svgMarkup: null,
      alt: null,
      limitations: [POSTER_IMAGE],
    });
  }

  return assets;
}

/**
 * Every discoverable image, inline SVG, and CSS background on the page,
 * deduplicated by resolved URL (inline SVG by serialized markup).
 */
export function listAssets(doc: Document = document): AssetReading[] {
  const byKey = new Map<string, { asset: AssetReading; count: number }>();

  const add = (asset: AssetReading, keyOverride?: string): void => {
    const key = keyOverride ?? keyFor(asset);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    byKey.set(key, { asset, count: 1 });
  };

  let videoIndex = 0;
  let elements: Element[] = [];
  try {
    elements = Array.from(doc.querySelectorAll('*')).slice(0, MAX_ELEMENTS_SCANNED);
  } catch {
    elements = [];
  }

  for (const element of elements) {
    if (isExtensionUi(element)) continue;
    const tag = element.tagName.toLowerCase();

    if (tag === 'img') {
      let style: CSSStyleDeclaration;
      try {
        style = getComputedStyle(element);
      } catch {
        continue;
      }
      readAssets(element, style, { deep: false }).forEach((asset) => add(asset));
      continue;
    }

    if (tag === 'video') {
      // A streamed video has no URL to key on, and two of them on one page are
      // still two assets, so the element's position keeps them apart.
      videoIndex += 1;
      const readings = readVideoAssets(element);
      readings.forEach((asset, offset) => {
        const streamed = asset.kind === 'video' && asset.url === null;
        add(asset, streamed ? `video:${videoIndex}:${offset}` : undefined);
      });
      continue;
    }

    // A <source> is read through its parent <video> or <picture>.
    if (tag === 'source' || tag === 'track') continue;
    if (tag === 'symbol' || tag === 'defs' || tag === 'use') continue;

    if (tag === 'svg') {
      // Top level only: a nested svg is part of its parent's markup.
      if (element.parentElement?.closest('svg')) continue;
      const rect = element.getBoundingClientRect();
      // A zero sized svg is a <symbol> holder, not an asset on the page.
      if (rect.width === 0 && rect.height === 0) continue;
      const exported = serializeInlineSvg(element as SVGElement);
      const viewBox = (element.getAttribute('viewBox') ?? '').trim().split(/\s+/).map(Number);
      add({
        kind: 'svg-inline',
        url: null,
        candidates: [],
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        intrinsicWidth: viewBox.length === 4 && Number.isFinite(viewBox[2]) ? (viewBox[2] as number) : null,
        intrinsicHeight: viewBox.length === 4 && Number.isFinite(viewBox[3]) ? (viewBox[3] as number) : null,
        fileSize: null,
        mimeType: null,
        svgMarkup: exported.markup,
        alt: element.getAttribute('aria-label'),
        limitations: exported.limitations,
      });
      continue;
    }

    let style: CSSStyleDeclaration;
    try {
      style = getComputedStyle(element);
    } catch {
      continue;
    }
    const layers = splitCssList(style.backgroundImage);
    if (layers.length === 0) continue;
    if (!layers.some((layer) => layer.includes('url('))) continue;
    const hasUrl = layers.some((layer) => extractUrls(layer).length > 0);
    if (!hasUrl) continue;
    readAssets(element, style, { deep: false })
      .filter((asset) => asset.kind === 'css-background')
      .forEach((asset) => add(asset));
  }

  return Array.from(byKey.values()).map(({ asset, count }) => {
    const limitations = [...asset.limitations];
    // A streamed video already explains why it has no URL, and an inline SVG
    // never has one, so neither is "not loaded yet".
    const explained = limitations.length > 0 && asset.kind === 'video';
    const unloaded = !asset.url && asset.kind !== 'svg-inline' && !explained;
    if (unloaded && !limitations.some((note) => note.startsWith('Not loaded yet'))) {
      limitations.push('Not loaded yet');
    }
    // A repeat reference is a fact about the page, not a caveat about the
    // reading, so it travels in usageCount instead of the limitation list
    // (PRD AST-04).
    if (
      !unloaded &&
      (asset.renderedWidth === 0 || asset.renderedHeight === 0) &&
      !limitations.includes(NOT_VISIBLE)
    ) {
      limitations.push(NOT_VISIBLE);
    }
    return { ...asset, usageCount: count, limitations };
  });
}
