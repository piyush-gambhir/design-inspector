// Pixel-perfect mockup overlays, in IndexedDB, keyed by page origin
// (competitive Tier 2 item 1, PRD 17.1: local only, never synced).
//
// Mockups live in the `design-inspector` database alongside saved references,
// as the `mockups` store that database version 2 adds. They used to have a
// database of their own; the first open after this change moves whatever that
// one holds across and then deletes it, so an existing overlay survives the
// move and no profile is left carrying two databases.
//
// A mockup is still scratch data with its own lifetime: it shares the database,
// not the lifecycle, and clearing the reference collection does not touch it.
//
// The blob is the record. The data URL the content script needs is derived on
// demand, because a data URL is roughly a third larger than the bytes it
// carries and there is no reason to store both.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MockupState } from '@/lib/messages';
import {
  MOCKUP_STORE,
  database,
  describeStorageError,
  resetDatabaseForTests,
  type DesignInspectorDB,
} from './references';

export { MOCKUP_STORE };

/** The database mockups lived in before they moved. Read once, then deleted. */
export const LEGACY_MOCKUP_DB_NAME = 'design-inspector-mockups';
export const LEGACY_MOCKUP_DB_VERSION = 1;

/** Above this the image is refused by name rather than stored and then failing. */
export const MAX_MOCKUP_BYTES = 20 * 1024 * 1024;

/** The image types a comparison overlay is offered for. */
export const MOCKUP_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/** The persisted half of a mockup: everything except the image data URL. */
export type StoredMockupState = Omit<MockupState, 'dataUrl'>;

export interface MockupRecord {
  /** Page origin, e.g. `https://example.com`. One mockup per origin. */
  origin: string;
  blob: Blob;
  state: StoredMockupState;
  updatedAt: string;
}

/**
 * A fresh mockup starts locked. An unlocked comp is a thing the pointer can
 * move by accident, and the common case is laying it down and reading the page
 * through it (tester finding F4). Unlocking is one switch away.
 */
export const DEFAULT_MOCKUP_STATE: StoredMockupState = {
  opacity: 0.5,
  x: 0,
  y: 0,
  scale: 1,
  visible: true,
  blend: 'normal',
  locked: true,
};

/** The legacy database's shape, which is the same store under another roof. */
interface LegacyMockupDB extends DBSchema {
  mockups: {
    key: string;
    value: MockupRecord;
  };
}

let ready: Promise<IDBPDatabase<DesignInspectorDB>> | null = null;

/** The shared database, with the one-time move out of the old one done. */
function mockupDatabase(): Promise<IDBPDatabase<DesignInspectorDB>> {
  ready ??= (async () => {
    const db = await database();
    await migrateLegacyMockups(db);
    return db;
  })();
  return ready;
}

/**
 * Move anything the old database still holds into the new store and delete it.
 * A record that already exists under the new roof wins, because it is the newer
 * one. Any failure leaves the old database exactly as it was, so the next open
 * can try again rather than losing the image.
 */
async function migrateLegacyMockups(db: IDBPDatabase<DesignInspectorDB>): Promise<void> {
  const factory = globalThis.indexedDB;
  if (!factory) return;
  try {
    // Opening a database that does not exist would create it, so ask first
    // wherever the browser can answer.
    if (typeof factory.databases === 'function') {
      const names = (await factory.databases()).map((entry) => entry.name);
      if (!names.includes(LEGACY_MOCKUP_DB_NAME)) return;
    }

    const legacy = await openDB<LegacyMockupDB>(LEGACY_MOCKUP_DB_NAME, LEGACY_MOCKUP_DB_VERSION, {
      upgrade(legacyDb) {
        if (!legacyDb.objectStoreNames.contains(MOCKUP_STORE)) {
          legacyDb.createObjectStore(MOCKUP_STORE, { keyPath: 'origin' });
        }
      },
    });
    const records = await legacy.getAll(MOCKUP_STORE);
    for (const record of records) {
      if (await db.get(MOCKUP_STORE, record.origin)) continue;
      await db.put(MOCKUP_STORE, record);
    }
    legacy.close?.();
    await deleteLegacyDatabase(factory);
  } catch {
    // The old data stays where it is; the mockup simply does not reappear yet.
  }
}

function deleteLegacyDatabase(factory: IDBFactory): Promise<void> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(LEGACY_MOCKUP_DB_NAME);
    } catch {
      resolve();
      return;
    }
    // A delete blocked by another tab is not worth waiting on: the store it
    // would remove is already empty of anything we still read.
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Test seam: drop the cached connection so a fresh openDB runs. */
export function resetMockupDatabaseForTests(): void {
  ready = null;
  resetDatabaseForTests();
}

function fail(error: unknown): never {
  throw new Error(describeStorageError(error));
}

/**
 * The origin a mockup is remembered against. A URL we cannot parse has no
 * origin to key on, so it gets no mockup rather than a shared one.
 */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}

/** Clamp an arbitrary stored value into a usable overlay state. */
export function normalizeMockupState(value: unknown): StoredMockupState {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<MockupState>;
  const number = (input: unknown, fallback: number): number =>
    typeof input === 'number' && Number.isFinite(input) ? input : fallback;
  const opacity = Math.min(1, Math.max(0, number(raw.opacity, DEFAULT_MOCKUP_STATE.opacity)));
  // A scale of zero would render nothing and read as a bug, not a setting.
  const scale = Math.min(10, Math.max(0.05, number(raw.scale, DEFAULT_MOCKUP_STATE.scale)));
  return {
    opacity,
    x: Math.round(number(raw.x, 0)),
    y: Math.round(number(raw.y, 0)),
    scale,
    visible: typeof raw.visible === 'boolean' ? raw.visible : DEFAULT_MOCKUP_STATE.visible,
    blend: raw.blend === 'difference' ? 'difference' : 'normal',
    locked: typeof raw.locked === 'boolean' ? raw.locked : DEFAULT_MOCKUP_STATE.locked,
  };
}

/** Human-readable size, used by the cap message. */
function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Refuse an oversized image with a sentence that says the limit and the actual
 * size, so the next action is obvious (PRD 19.3).
 */
export function checkMockupSize(bytes: number): string | null {
  if (bytes <= MAX_MOCKUP_BYTES) return null;
  return `That image is ${megabytes(bytes)}. Mockup overlays are capped at ${megabytes(MAX_MOCKUP_BYTES)}; export a smaller copy and try again.`;
}

export async function getMockup(origin: string): Promise<MockupRecord | null> {
  try {
    const db = await mockupDatabase();
    const record = await db.get(MOCKUP_STORE, origin);
    if (!record) return null;
    return { ...record, state: normalizeMockupState(record.state) };
  } catch (error) {
    return fail(error);
  }
}

export async function putMockup(
  origin: string,
  blob: Blob,
  state: StoredMockupState,
): Promise<MockupRecord> {
  const tooBig = checkMockupSize(blob.size);
  if (tooBig) throw new Error(tooBig);
  const record: MockupRecord = {
    origin,
    blob,
    state: normalizeMockupState(state),
    updatedAt: new Date().toISOString(),
  };
  try {
    const db = await mockupDatabase();
    await db.put(MOCKUP_STORE, record);
    return record;
  } catch (error) {
    return fail(error);
  }
}

/**
 * Update only the overlay settings. The image is left exactly as it was, so a
 * drag or a nudge never rewrites the stored bytes.
 */
export async function updateMockupState(
  origin: string,
  state: StoredMockupState,
): Promise<MockupRecord | null> {
  try {
    const db = await mockupDatabase();
    const existing = await db.get(MOCKUP_STORE, origin);
    if (!existing) return null;
    const next: MockupRecord = {
      ...existing,
      state: normalizeMockupState(state),
      updatedAt: new Date().toISOString(),
    };
    await db.put(MOCKUP_STORE, next);
    return next;
  } catch (error) {
    return fail(error);
  }
}

export async function deleteMockup(origin: string): Promise<void> {
  try {
    const db = await mockupDatabase();
    await db.delete(MOCKUP_STORE, origin);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Read a blob as a data URL for the message channel. Structured clone can carry
 * a Blob between extension pages, but not into a content script, so the image
 * travels as text.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () =>
      reject(new Error('That image could not be read. Try exporting it again.'));
    reader.readAsDataURL(blob);
  });
}
