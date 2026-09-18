// Element screenshots (PRD SAV-02).
//
// Only ever taken as part of an explicit save. The overlay is hidden first so
// the capture shows the page, not the inspector. Nothing scrolls or stitches:
// an element taller than the viewport yields a labelled visible crop.
import type { Rect } from '@/lib/contracts';
import { sendToTab } from '@/lib/messages';

export interface CropResult {
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the requested rect reached outside the captured image. */
  isCrop: boolean;
}

/**
 * Device-pixel crop box for a CSS-pixel viewport rect, clamped to the captured
 * image. Chrome captures at the device pixel ratio, so the rect scales first.
 */
export function computeCrop(
  rect: Rect,
  devicePixelRatio: number,
  imageWidth: number,
  imageHeight: number,
): CropResult {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const scaledX = rect.x * ratio;
  const scaledY = rect.y * ratio;
  const scaledRight = (rect.x + rect.width) * ratio;
  const scaledBottom = (rect.y + rect.height) * ratio;

  const left = Math.max(0, Math.floor(scaledX));
  const top = Math.max(0, Math.floor(scaledY));
  const right = Math.min(imageWidth, Math.ceil(scaledRight));
  const bottom = Math.min(imageHeight, Math.ceil(scaledBottom));

  const epsilon = 0.5;
  const isCrop =
    scaledX < -epsilon ||
    scaledY < -epsilon ||
    scaledRight > imageWidth + epsilon ||
    scaledBottom > imageHeight + epsilon;

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    isCrop,
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/** Decode a PNG data URL, crop it, and re-encode as a PNG data URL. */
export async function cropDataUrl(
  dataUrl: string,
  rect: Rect,
  devicePixelRatio: number,
): Promise<{ dataUrl: string; isCrop: boolean }> {
  const source = await fetch(dataUrl).then(response => response.blob());
  const bitmap = await createImageBitmap(source);
  try {
    const crop = computeCrop(rect, devicePixelRatio, bitmap.width, bitmap.height);
    if (crop.width < 1 || crop.height < 1) {
      throw new Error('The element is not visible in the current viewport.');
    }
    const canvas = new OffscreenCanvas(crop.width, crop.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the screenshot canvas.');
    context.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { dataUrl: await blobToDataUrl(blob), isCrop: crop.isCrop };
  } finally {
    bitmap.close();
  }
}

export type CaptureResult =
  | { ok: true; screenshotDataUrl: string; isCrop: boolean }
  | { ok: false; error: string };

/**
 * Capture the tab and crop to `rect`. A failure here never blocks a save: the
 * caller keeps the measurements and reports the reason.
 */
export async function captureElementScreenshot(
  tabId: number,
  rect: Rect,
  devicePixelRatio: number,
): Promise<CaptureResult> {
  let hidden = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    const overlayOff = await sendToTab(tabId, { type: 'content.setOverlayVisible', visible: false });
    hidden = overlayOff.ok;
    const captured = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!captured) return { ok: false, error: 'Chrome returned no image for this tab.' };
    const cropped = await cropDataUrl(captured, rect, devicePixelRatio);
    return { ok: true, screenshotDataUrl: cropped.dataUrl, isCrop: cropped.isCrop };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The screenshot could not be captured.',
    };
  } finally {
    if (hidden) {
      await sendToTab(tabId, { type: 'content.setOverlayVisible', visible: true });
    }
  }
}

/** Turn a PNG data URL back into a Blob for IndexedDB. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then(response => response.blob());
}
