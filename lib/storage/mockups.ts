














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


export const LEGACY_MOCKUP_DB_NAME = 'design-inspector-mockups';
export const LEGACY_MOCKUP_DB_VERSION = 1;


export const MAX_MOCKUP_BYTES = 20 * 1024 * 1024;


export const MOCKUP_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];


export type StoredMockupState = Omit<MockupState, 'dataUrl'>;

export interface MockupRecord {

  origin: string;
  blob: Blob;
  state: StoredMockupState;
  updatedAt: string;
}






export const DEFAULT_MOCKUP_STATE: StoredMockupState = {
  opacity: 0.5,
  x: 0,
  y: 0,
  scale: 1,
  visible: true,
  blend: 'normal',
  locked: true,
};


interface LegacyMockupDB extends DBSchema {
  mockups: {
    key: string;
    value: MockupRecord;
  };
}

let ready: Promise<IDBPDatabase<DesignInspectorDB>> | null = null;


function mockupDatabase(): Promise<IDBPDatabase<DesignInspectorDB>> {
  ready ??= (async () => {
    const db = await database();
    await migrateLegacyMockups(db);
    return db;
  })();
  return ready;
}







async function migrateLegacyMockups(db: IDBPDatabase<DesignInspectorDB>): Promise<void> {
  const factory = globalThis.indexedDB;
  if (!factory) return;
  try {


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


    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}


export function resetMockupDatabaseForTests(): void {
  ready = null;
  resetDatabaseForTests();
}

function fail(error: unknown): never {
  throw new Error(describeStorageError(error));
}





export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}


export function normalizeMockupState(value: unknown): StoredMockupState {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<MockupState>;
  const number = (input: unknown, fallback: number): number =>
    typeof input === 'number' && Number.isFinite(input) ? input : fallback;
  const opacity = Math.min(1, Math.max(0, number(raw.opacity, DEFAULT_MOCKUP_STATE.opacity)));

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


function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}





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






export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () =>
      reject(new Error('That image could not be read. Try exporting it again.'));
    reader.readAsDataURL(blob);
  });
}
