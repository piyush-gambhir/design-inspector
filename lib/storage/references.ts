



import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SavedReference } from '@/lib/contracts';


import type { MockupRecord } from './mockups';

export const DB_NAME = 'design-inspector';

export const DB_VERSION = 2;
export const REFERENCE_STORE = 'references';
export const SCREENSHOT_STORE = 'screenshots';
export const MOCKUP_STORE = 'mockups';

export interface DesignInspectorDB extends DBSchema {
  references: {
    key: string;
    value: SavedReference;
    indexes: { createdAt: string; sourceUrl: string };
  };
  screenshots: {
    key: string;
    value: Blob;
  };
  mockups: {
    key: string;
    value: MockupRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<DesignInspectorDB>> | null = null;






export function database(): Promise<IDBPDatabase<DesignInspectorDB>> {
  dbPromise ??= openDB<DesignInspectorDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(REFERENCE_STORE)) {
        const store = db.createObjectStore(REFERENCE_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('sourceUrl', 'snapshot.source.url');
      }
      if (!db.objectStoreNames.contains(SCREENSHOT_STORE)) {


        db.createObjectStore(SCREENSHOT_STORE);
      }
      if (!db.objectStoreNames.contains(MOCKUP_STORE)) {
        db.createObjectStore(MOCKUP_STORE, { keyPath: 'origin' });
      }
    },
  });
  return dbPromise;
}


export function resetDatabaseForTests(): void {
  dbPromise = null;
}





export function describeStorageError(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'QuotaExceededError' || /quota/i.test(message)) {
    return 'Local storage is full. Delete some saved references or clear the collection, then try again.';
  }
  if (name === 'InvalidStateError' || /closing|closed/i.test(message)) {
    return 'The local database is not available right now. Reload the extension and try again.';
  }
  return message || 'Local storage failed.';
}

function fail(error: unknown): never {
  throw new Error(describeStorageError(error));
}




export interface ReferenceMetaPatch {
  title?: string;
  note?: string;
}






export function applyMetaPatch(
  reference: SavedReference,
  patch: ReferenceMetaPatch,
  nowIso: string,
): SavedReference {
  const meta = {
    title: patch.title === undefined ? reference.title : patch.title,
    note: patch.note === undefined ? reference.note : patch.note,
    createdAt: reference.createdAt,
    updatedAt: nowIso,
  };

  if (reference.kind === 'summary') return { ...reference, ...meta };
  return {
    ...reference,
    ...meta,
  };
}


export function sortNewestFirst(references: SavedReference[]): SavedReference[] {
  return [...references].sort((a, b) => {
    if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}


export function screenshotIsOrphaned(
  references: SavedReference[],
  screenshotId: string,
  excludeId: string,
): boolean {
  return !references.some(ref => ref.id !== excludeId && ref.screenshotId === screenshotId);
}




export async function listReferences(): Promise<SavedReference[]> {
  try {
    const db = await database();
    return sortNewestFirst(await db.getAll(REFERENCE_STORE));
  } catch (error) {
    return fail(error);
  }
}

export async function getReference(id: string): Promise<SavedReference | null> {
  try {
    const db = await database();
    return (await db.get(REFERENCE_STORE, id)) ?? null;
  } catch (error) {
    return fail(error);
  }
}

export async function putReference(reference: SavedReference): Promise<SavedReference> {
  try {
    const db = await database();
    await db.put(REFERENCE_STORE, reference);
    return reference;
  } catch (error) {
    return fail(error);
  }
}

export async function updateReferenceMeta(
  id: string,
  patch: ReferenceMetaPatch,
): Promise<SavedReference> {
  try {
    const db = await database();
    const existing = await db.get(REFERENCE_STORE, id);
    if (!existing) throw new Error(`Saved reference ${id} no longer exists.`);
    const next = applyMetaPatch(existing, patch, new Date().toISOString());
    await db.put(REFERENCE_STORE, next);
    return next;
  } catch (error) {
    return fail(error);
  }
}

export async function deleteReference(id: string): Promise<void> {
  try {
    const db = await database();
    const existing = await db.get(REFERENCE_STORE, id);
    await db.delete(REFERENCE_STORE, id);
    const screenshotId = existing?.screenshotId ?? null;
    if (!screenshotId) return;
    const remaining = await db.getAll(REFERENCE_STORE);
    if (screenshotIsOrphaned(remaining, screenshotId, id)) {
      await db.delete(SCREENSHOT_STORE, screenshotId);
    }
  } catch (error) {
    return fail(error);
  }
}

export async function clearReferences(): Promise<void> {
  try {
    const db = await database();
    await db.clear(REFERENCE_STORE);
    await db.clear(SCREENSHOT_STORE);
  } catch (error) {
    return fail(error);
  }
}


export async function exportReferences(ids: string[]): Promise<SavedReference[]> {
  try {
    const db = await database();
    const found: SavedReference[] = [];
    for (const id of ids) {
      const reference = await db.get(REFERENCE_STORE, id);
      if (reference) found.push(reference);
    }
    return found;
  } catch (error) {
    return fail(error);
  }
}




export async function putScreenshot(id: string, blob: Blob): Promise<void> {
  try {
    const db = await database();
    await db.put(SCREENSHOT_STORE, blob, id);
  } catch (error) {
    return fail(error);
  }
}

export async function getScreenshot(id: string): Promise<Blob | null> {
  try {
    const db = await database();
    return (await db.get(SCREENSHOT_STORE, id)) ?? null;
  } catch (error) {
    return fail(error);
  }
}


export async function getScreenshotUrl(id: string): Promise<string | null> {
  const blob = await getScreenshot(id);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export async function deleteScreenshot(id: string): Promise<void> {
  try {
    const db = await database();
    await db.delete(SCREENSHOT_STORE, id);
  } catch (error) {
    return fail(error);
  }
}




export interface UsageEstimate {
  usageBytes: number | null;
  quotaBytes: number | null;
}

export async function estimateUsage(): Promise<UsageEstimate> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return {
      usageBytes: typeof estimate?.usage === 'number' ? estimate.usage : null,
      quotaBytes: typeof estimate?.quota === 'number' ? estimate.quota : null,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
