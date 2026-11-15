





import type { AssetReading, SavedReference } from '@/lib/contracts';
import type { AssetBundleOptions, AssetBundleResult } from '@/lib/exports/asset-bundle';
import { AssetBundleCancelled, buildAssetBundle } from '@/lib/exports/asset-bundle';
import type { BundleResult } from '@/lib/exports/bundle';
import { buildReferenceBundle } from '@/lib/exports/bundle';
import { sanitizeFilename } from '@/lib/background/downloads';

export type ExportAttempt<T> = { ok: true; value: T } | { ok: false; error: string };

export function runExport<T>(run: () => T): ExportAttempt<T> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The export adapter failed.',
    };
  }
}

export function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}


export function exportDateStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}


export function jsonDataUrl(text: string): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
}

export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}


export function filenameFromUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : fallback;
  } catch {
    return fallback;
  }
}









export async function downloadBlob(
  blob: Blob,
  filename: string,
): Promise<{ ok: true; downloadId: number } | { ok: false; error: string }> {
  let url: string;
  try {
    url = URL.createObjectURL(blob);
  } catch (error) {
    return { ok: false, error: describe(error, 'The file could not be prepared for download.') };
  }

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: sanitizeFilename(filename),
      saveAs: false,
      conflictAction: 'uniquify',
    });
    if (typeof downloadId !== 'number') {
      revoke(url);
      return { ok: false, error: 'The download did not start.' };
    }
    revokeWhenSettled(url, downloadId);
    return { ok: true, downloadId };
  } catch (error) {
    revoke(url);
    return { ok: false, error: describe(error, 'The download could not be started.') };
  }
}


const REVOKE_TIMEOUT_MS = 60_000;

function revokeWhenSettled(url: string, downloadId: number): void {
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    try {
      chrome.downloads.onChanged.removeListener(listener);
    } catch {

    }
    revoke(url);
  };
  const listener = (delta: chrome.downloads.DownloadDelta): void => {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') finish();
  };
  try {
    chrome.downloads.onChanged.addListener(listener);
  } catch {

  }
  setTimeout(finish, REVOKE_TIMEOUT_MS);
}

function revoke(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {

  }
}





export async function downloadBundle(
  references: SavedReference[],
  screenshots: Map<string, Blob>,
  options: { includeLedger?: boolean; extensionVersion?: string } = {},
): Promise<
  | { ok: true; filename: string; manifest: BundleResult['manifest'] }
  | { ok: false; error: string }
> {
  let bundle: BundleResult;
  try {
    bundle = await buildReferenceBundle(references, {
      screenshots,
      extensionVersion: options.extensionVersion ?? extensionVersion(),
      includeLedger: options.includeLedger,
    });
  } catch (error) {
    return { ok: false, error: describe(error, 'The bundle could not be built.') };
  }

  const started = await downloadBlob(bundle.blob, bundle.filename);
  if (!started.ok) return started;
  return { ok: true, filename: bundle.filename, manifest: bundle.manifest };
}






export async function downloadAssetBundle(
  assets: AssetReading[],
  options: Omit<AssetBundleOptions, 'extensionVersion'> & { extensionVersion?: string } = {},
): Promise<
  | { ok: true; filename: string; result: AssetBundleResult }
  | { ok: false; error: string; cancelled?: boolean }
> {
  let result: AssetBundleResult;
  try {
    result = await buildAssetBundle(assets, {
      ...options,
      extensionVersion: options.extensionVersion ?? extensionVersion(),
    });
  } catch (error) {
    if (error instanceof AssetBundleCancelled) {
      return { ok: false, error: error.message, cancelled: true };
    }
    return { ok: false, error: describe(error, 'The archive could not be built.') };
  }

  if (result.writtenCount === 0) {
    return {
      ok: false,
      error: 'No selected asset could be downloaded. Copy the URLs and open them directly.',
    };
  }

  const started = await downloadBlob(result.blob, result.filename);
  if (!started.ok) return started;
  return { ok: true, filename: result.filename, result };
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback;
}

export async function copyText(text: string): Promise<string | null> {
  try {
    await navigator.clipboard.writeText(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Copy to clipboard failed.';
  }
}
