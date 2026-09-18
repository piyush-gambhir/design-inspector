// Bulk asset export (PRD AST-05).
//
// The bytes are fetched by whoever calls this, in an extension page that has
// `chrome.downloads`, and every request goes out with `credentials: 'omit'` so
// a bulk download never carries the user's cookies to an asset host (PRD 17.1
// tells the user that downloading contacts each host; it must not do more).
//
// Three promises AST-05 makes and this module keeps: one failed asset never
// loses the batch, every skipped item carries a reason, and the size cap stops
// the run instead of exhausting memory.
import type { AssetReading } from '@/lib/contracts';
import { ZIP_MAX_ENTRY_BYTES, ZipWriter } from './zip';

const MIB = 1024 * 1024;

/** PRD AST-05 documented per-batch limit. */
export const ASSET_BATCH_MAX_BYTES = 200 * MIB;

/** Longest filename we put in the archive, extension included. */
const MAX_BASENAME_LENGTH = 80;

export interface AssetBundleManifest {
  written: { path: string; source: string; bytes: number }[];
  skipped: { path: string; source: string; reason: string }[];
  generatedAt: string;
  extensionVersion: string;
}

export interface AssetBundleResult {
  blob: Blob;
  filename: string;
  manifest: AssetBundleManifest;
  /** True when the batch cap stopped the run before every asset was tried. */
  stoppedAtCap: boolean;
  /** How many assets actually went into the archive. */
  writtenCount: number;
}

export interface AssetBundleOptions {
  extensionVersion: string;
  signal?: AbortSignal;
  /** Called after each asset is handled, successfully or not. */
  onProgress?: (done: number, total: number) => void;
  /** Injected by tests. Defaults to the global fetch. */
  fetchAsset?: (url: string, init: RequestInit) => Promise<Response>;
  /** Lower than ASSET_BATCH_MAX_BYTES only. */
  maxBytes?: number;
  now?: Date;
}

/** Thrown when the caller's AbortController fires. Callers show it as a cancel. */
export class AssetBundleCancelled extends Error {
  constructor() {
    super('The download was cancelled.');
    this.name = 'AssetBundleCancelled';
  }
}

/**
 * One archive path per asset: `<index>-<basename>`, so the order in the panel
 * survives into the ZIP and two assets that share a basename never collide.
 * The numeric suffix is a second guard for the case where sanitizing two
 * different names produces the same text.
 */
export function assetFilenames(assets: AssetReading[]): string[] {
  const used = new Set<string>();
  return assets.map((asset, index) => {
    const base = `${index + 1}-${basenameFor(asset)}`;
    let candidate = base;
    let counter = 2;
    while (used.has(candidate)) {
      candidate = withSuffix(base, counter);
      counter += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

export async function buildAssetBundle(
  assets: AssetReading[],
  options: AssetBundleOptions,
): Promise<AssetBundleResult> {
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const maxBytes = Math.min(options.maxBytes ?? ASSET_BATCH_MAX_BYTES, ASSET_BATCH_MAX_BYTES);
  const fetchAsset =
    options.fetchAsset ?? ((url: string, init: RequestInit) => fetch(url, init));
  const paths = assetFilenames(assets);
  const zip = new ZipWriter();
  const written: AssetBundleManifest['written'] = [];
  const skipped: AssetBundleManifest['skipped'] = [];
  let usedBytes = 0;
  let stoppedAtCap = false;

  for (let index = 0; index < assets.length; index += 1) {
    if (options.signal?.aborted) throw new AssetBundleCancelled();
    const asset = assets[index] as AssetReading;
    const path = paths[index] as string;
    const source = sourceLabel(asset);

    if (stoppedAtCap) {
      skipped.push({ path, source, reason: capReason(maxBytes) });
      options.onProgress?.(index + 1, assets.length);
      continue;
    }

    let bytes: Uint8Array | null = null;
    try {
      bytes = await bytesFor(asset, fetchAsset, options.signal);
    } catch (error) {
      if (error instanceof AssetBundleCancelled) throw error;
      if (options.signal?.aborted) throw new AssetBundleCancelled();
      skipped.push({ path, source, reason: failureReason(error) });
      options.onProgress?.(index + 1, assets.length);
      continue;
    }

    if (bytes === null) {
      skipped.push({ path, source, reason: noSourceReason(asset) });
      options.onProgress?.(index + 1, assets.length);
      continue;
    }
    if (bytes.byteLength > ZIP_MAX_ENTRY_BYTES) {
      skipped.push({ path, source, reason: 'The file is larger than the per-file limit.' });
      options.onProgress?.(index + 1, assets.length);
      continue;
    }
    if (usedBytes + bytes.byteLength > maxBytes) {
      // Stop rather than drop this one and carry on: the user asked for a
      // batch, and a cap that silently skipped the big files would be a lie.
      stoppedAtCap = true;
      skipped.push({ path, source, reason: capReason(maxBytes) });
      options.onProgress?.(index + 1, assets.length);
      continue;
    }

    try {
      zip.add(path, bytes, { mtime: now });
      usedBytes += bytes.byteLength;
      written.push({ path, source, bytes: bytes.byteLength });
    } catch (error) {
      skipped.push({ path, source, reason: failureReason(error) });
    }
    options.onProgress?.(index + 1, assets.length);
  }

  const manifest: AssetBundleManifest = {
    written,
    skipped,
    generatedAt,
    extensionVersion: options.extensionVersion,
  };
  zip.add('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, { mtime: now });

  return {
    blob: zip.finish(),
    filename: `design-inspector-assets-${generatedAt.slice(0, 10)}.zip`,
    manifest,
    stoppedAtCap,
    writtenCount: written.length,
  };
}

// ---------------------------------------------------------------------------

async function bytesFor(
  asset: AssetReading,
  fetchAsset: (url: string, init: RequestInit) => Promise<Response>,
  signal: AbortSignal | undefined,
): Promise<Uint8Array | null> {
  if (asset.kind === 'svg-inline') {
    if (!asset.svgMarkup) return null;
    return new TextEncoder().encode(asset.svgMarkup);
  }
  if (!asset.url) return null;

  const init: RequestInit = { credentials: 'omit' };
  if (signal) init.signal = signal;
  const response = await fetchAsset(asset.url, init);
  if (!response.ok) {
    throw new HttpStatusError(response.status, response.statusText);
  }
  return new Uint8Array(await response.arrayBuffer());
}

class HttpStatusError extends Error {
  constructor(status: number, statusText: string) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}.`);
    this.name = 'HttpStatusError';
  }
}

function noSourceReason(asset: AssetReading): string {
  if (asset.kind === 'svg-inline') return 'The inline SVG markup was not captured.';
  const limitation = asset.limitations[0];
  return limitation ?? 'This asset has no downloadable URL.';
}

function failureReason(error: unknown): string {
  if (error instanceof HttpStatusError) return error.message;
  if (error instanceof Error && error.message !== '') return error.message;
  return 'The request failed. The host may refuse cross-origin reads.';
}

function capReason(maxBytes: number): string {
  const size = maxBytes >= MIB ? `${Math.round(maxBytes / MIB)} MiB` : `${maxBytes} byte`;
  return `Stopped at the ${size} batch limit.`;
}

function sourceLabel(asset: AssetReading): string {
  if (asset.url) return asset.url;
  return asset.kind === 'svg-inline' ? 'inline SVG' : `inline ${asset.kind}`;
}

function basenameFor(asset: AssetReading): string {
  if (asset.kind === 'svg-inline') return 'inline.svg';
  const fromUrl = asset.url ? lastSegment(asset.url) : '';
  const cleaned = sanitize(fromUrl);
  if (cleaned !== '') return cleaned;
  return asset.kind === 'video' ? 'video' : 'asset';
}

function lastSegment(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:') return '';
    const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

/** Page-supplied text becomes one safe path segment, never a directory. */
function sanitize(name: string): string {
  const flat = name.split(/[\\/]/).pop() ?? '';
  const cleaned = flat
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '');
  if (cleaned === '') return '';
  if (cleaned.length <= MAX_BASENAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_BASENAME_LENGTH - extension.length) + extension;
}

function withSuffix(name: string, counter: number): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}-${counter}`;
  return `${name.slice(0, dot)}-${counter}${name.slice(dot)}`;
}
