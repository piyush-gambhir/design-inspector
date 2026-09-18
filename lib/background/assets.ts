// Page asset list plus best-effort metadata (PRD AST-04).
//
// The content script reports what the page rendered. File size and MIME type
// are only knowable from the network, so the worker tries one cheap HEAD per
// asset. A failure leaves the fields null: "Unknown" must never become 0.
import type { AssetReading } from '@/lib/contracts';
import type { BackgroundResponse } from '@/lib/messages';
import { sendToTab } from '@/lib/messages';
import { ensureContentScript } from './inspector-control';

const HEAD_TIMEOUT_MS = 3000;
const MAX_IN_FLIGHT = 6;

/** data: and blob: URLs carry no headers worth a request. */
export function isFetchableAssetUrl(url: string | null): url is string {
  if (!url) return false;
  return !/^(data|blob|filesystem):/i.test(url);
}

function parseSize(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseMime(value: string | null): string | null {
  if (!value) return null;
  const mime = value.split(';')[0]?.trim();
  return mime ? mime : null;
}

/** Fill fileSize and mimeType from response headers. Never throws. */
export async function enrichAsset(asset: AssetReading): Promise<AssetReading> {
  if (!isFetchableAssetUrl(asset.url)) return asset;
  if (asset.fileSize !== null && asset.mimeType !== null) return asset;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    const response = await fetch(asset.url, {
      method: 'HEAD',
      signal: controller.signal,
      credentials: 'omit',
      cache: 'force-cache',
    });
    if (!response.ok) return asset;
    return {
      ...asset,
      fileSize: asset.fileSize ?? parseSize(response.headers.get('content-length')),
      mimeType: asset.mimeType ?? parseMime(response.headers.get('content-type')),
    };
  } catch {
    return asset;
  } finally {
    clearTimeout(timer);
  }
}

/** Enrich in original order, at most MAX_IN_FLIGHT requests at a time. */
export async function enrichAssets(assets: AssetReading[]): Promise<AssetReading[]> {
  const result: AssetReading[] = [...assets];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(MAX_IN_FLIGHT, assets.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= assets.length) return;
      const asset = assets[index];
      if (!asset) continue;
      result[index] = await enrichAsset(asset);
    }
  });
  await Promise.all(workers);
  return result;
}

/**
 * The page's own asset list. Enrichment is opt-in because it contacts every
 * asset's host, which the user is told about before they ask for it
 * (PRD 17.1).
 */
export async function requestAssets(tabId: number, enrich = false): Promise<BackgroundResponse> {
  const ready = await ensureContentScript(tabId);
  if (!ready.ok) return { ok: false, error: ready.reason };
  const response = await sendToTab(tabId, { type: 'content.listAssets' });
  if (!response.ok) return { ok: false, error: response.error };
  if (!('assets' in response)) return { ok: false, error: 'The asset scan returned no list.' };
  return { ok: true, assets: enrich ? await enrichAssets(response.assets) : response.assets };
}
