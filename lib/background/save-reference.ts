// Saving a reference (PRD SAV-01, SAV-03).
//
// Order matters: persist first, respond second, broadcast third. Success is
// never reported before IndexedDB accepted the record.
import type { ElementSnapshot, PageSummary, SavedReference } from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';
import type { BackgroundResponse } from '@/lib/messages';
import { broadcast, sendToTab } from '@/lib/messages';
import { listReferences, putReference, putScreenshot } from '@/lib/storage/references';
import { captureElementScreenshot, dataUrlToBlob } from './screenshot';

/** A snapshot with an `element` is an element capture; one with a `scope` is a summary. */
export function inferKind(snapshot: ElementSnapshot | PageSummary): 'element' | 'summary' {
  if ('element' in snapshot) return 'element';
  if ('scope' in snapshot) return 'summary';
  return 'element';
}

export function buildReference(
  snapshot: ElementSnapshot | PageSummary,
  title: string,
  note: string,
  nowIso: string,
  id: string,
): SavedReference {
  const base = {
    id,
    schemaVersion: SCHEMA_VERSION,
    title: title.trim() || 'Untitled reference',
    note,
    createdAt: nowIso,
    updatedAt: nowIso,
    screenshotId: null,
    screenshotIsCrop: null,
  };
  return 'element' in snapshot
    ? { ...base, kind: 'element', snapshot }
    : { ...base, kind: 'summary', snapshot };
}

export interface SaveRequest {
  snapshot: ElementSnapshot | PageSummary;
  title: string;
  note: string;
  captureScreenshot: boolean;
  tabId: number | null;
}

export async function saveReference(request: SaveRequest): Promise<BackgroundResponse> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  let reference = buildReference(request.snapshot, request.title, request.note, now, id);
  let warning: string | undefined;
  let screenshotBlob: Blob | null = null;

  // Screenshot capture is optional and best-effort: the measurements are the
  // reference, the image is context (PRD SAV-02). The user is told when it
  // failed instead of silently getting a reference without an image.
  if (request.captureScreenshot && reference.kind === 'element') {
    if (request.tabId === null) {
      warning = 'Screenshot skipped: no tab to capture.';
    } else {
      const pinned = await sendToTab(request.tabId, { type: 'content.getPinnedRect' });
      if (!pinned.ok) {
        warning = `Screenshot skipped: ${pinned.error}`;
      } else if (!('rect' in pinned) || !pinned.rect) {
        warning = 'Screenshot skipped: no element is pinned on the page.';
      } else {
        const shot = await captureElementScreenshot(
          request.tabId,
          pinned.rect,
          pinned.devicePixelRatio,
        );
        if (shot.ok) {
          try {
            screenshotBlob = await dataUrlToBlob(shot.screenshotDataUrl);
            reference = { ...reference, screenshotId: id, screenshotIsCrop: shot.isCrop };
          } catch (error) {
            warning = `Screenshot skipped: ${error instanceof Error ? error.message : 'could not decode image'}`;
          }
        } else {
          warning = `Screenshot skipped: ${shot.error}`;
        }
      }
    }
  }

  // Persist the reference first so a screenshot never outlives a failed save.
  try {
    await putReference(reference);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The reference could not be saved.',
    };
  }
  if (screenshotBlob) {
    try {
      await putScreenshot(id, screenshotBlob);
    } catch (error) {
      warning = `Screenshot skipped: ${error instanceof Error ? error.message : 'storage failed'}`;
      reference = { ...reference, screenshotId: null, screenshotIsCrop: null };
      try {
        await putReference(reference);
      } catch {
        // The reference already exists with a dangling screenshotId; the panel
        // treats a missing blob as "no image".
      }
    }
  }

  try {
    broadcast({ type: 'event.savedChanged', references: await listReferences() });
  } catch {
    // A broadcast failure does not undo a successful save.
  }
  return warning ? { ok: true, reference, warning } : { ok: true, reference };
}
