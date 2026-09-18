import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The same in-memory stand-in for idb that storage-references.test.ts uses:
// fake-indexeddb is not a dependency, so the store logic is exercised against
// this instead, upgrade path included.
const fake = vi.hoisted(() => {
  interface FakeStore {
    keyPath?: string;
    records: Map<string, unknown>;
  }

  const state: {
    /** Every database the fake has handed out, by name. */
    dbs: Map<string, FakeDb>;
    opens: number;
    names: string[];
    /** Names passed to indexedDB.deleteDatabase. */
    deleted: string[];
    /** What indexedDB.databases() reports, or null for no such API. */
    existing: string[] | null;
  } = { dbs: new Map(), opens: 0, names: [], deleted: [], existing: [] };

  class FakeDb {
    stores = new Map<string, FakeStore>();
    closed = false;

    objectStoreNames = {
      contains: (name: string) => this.stores.has(name),
    };

    createObjectStore(name: string, options?: { keyPath?: string }) {
      this.stores.set(name, { keyPath: options?.keyPath, records: new Map() });
      return { createIndex: () => undefined };
    }

    close() {
      this.closed = true;
    }

    private store(name: string): FakeStore {
      const found = this.stores.get(name);
      if (!found) throw new Error(`Unknown store ${name}`);
      return found;
    }

    async get(name: string, key: string) {
      return this.store(name).records.get(key);
    }

    async getAll(name: string) {
      return [...this.store(name).records.values()];
    }

    async put(name: string, value: unknown, key?: string) {
      const store = this.store(name);
      const resolved =
        key ?? (store.keyPath ? (value as Record<string, string>)[store.keyPath] : undefined);
      if (resolved === undefined) throw new Error('No key for put');
      store.records.set(String(resolved), value);
    }

    async delete(name: string, key: string) {
      this.store(name).records.delete(key);
    }

    async clear(name: string) {
      this.store(name).records.clear();
    }
  }

  return { state, FakeDb };
});

vi.mock('idb', () => ({
  openDB: async (
    name: string,
    _version: number,
    options?: { upgrade?: (db: unknown) => void },
  ) => {
    fake.state.opens += 1;
    fake.state.names.push(name);
    // Reopening the same name hands back the same records, as a real database
    // would, which is what makes the migration observable.
    const db = fake.state.dbs.get(name) ?? new fake.FakeDb();
    fake.state.dbs.set(name, db);
    options?.upgrade?.(db);
    return db;
  },
}));

/** The fake IDBFactory the migration asks about the old database through. */
function installIndexedDB(): void {
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    databases:
      fake.state.existing === null
        ? undefined
        : async () => (fake.state.existing ?? []).map((name) => ({ name, version: 1 })),
    deleteDatabase: (name: string) => {
      fake.state.deleted.push(name);
      fake.state.dbs.delete(name);
      const request: Record<string, unknown> = {};
      queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
      return request;
    },
  };
}

const {
  DEFAULT_MOCKUP_STATE,
  LEGACY_MOCKUP_DB_NAME,
  MAX_MOCKUP_BYTES,
  MOCKUP_STORE,
  checkMockupSize,
  deleteMockup,
  getMockup,
  normalizeMockupState,
  originOf,
  putMockup,
  resetMockupDatabaseForTests,
  updateMockupState,
} = await import('@/lib/storage/mockups');

const { DB_NAME, DB_VERSION, REFERENCE_STORE } = await import('@/lib/storage/references');

const ORIGIN = 'https://example.com';

function blobOf(size: number, type = 'image/png'): Blob {
  return { size, type } as Blob;
}

beforeEach(() => {
  resetMockupDatabaseForTests();
  fake.state.dbs = new Map();
  fake.state.opens = 0;
  fake.state.names = [];
  fake.state.deleted = [];
  fake.state.existing = [];
  installIndexedDB();
});

afterEach(() => {
  delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
});

describe('originOf', () => {
  it('keys on the origin, not the path or the query', () => {
    expect(originOf('https://example.com/a/b?c=1#d')).toBe(ORIGIN);
    expect(originOf('http://127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080');
  });

  it('returns null for anything without a usable origin', () => {
    expect(originOf('')).toBeNull();
    expect(originOf(undefined)).toBeNull();
    expect(originOf('not a url')).toBeNull();
    expect(originOf('data:text/html,hi')).toBeNull();
  });
});

describe('normalizeMockupState', () => {
  it('fills in the defaults for an empty or unusable value', () => {
    expect(normalizeMockupState(undefined)).toEqual(DEFAULT_MOCKUP_STATE);
    expect(normalizeMockupState('nonsense')).toEqual(DEFAULT_MOCKUP_STATE);
  });

  it('clamps opacity and refuses a scale that would render nothing', () => {
    expect(normalizeMockupState({ opacity: 4 }).opacity).toBe(1);
    expect(normalizeMockupState({ opacity: -2 }).opacity).toBe(0);
    expect(normalizeMockupState({ scale: 0 }).scale).toBe(0.05);
    expect(normalizeMockupState({ scale: 1000 }).scale).toBe(10);
  });

  it('rounds the offset and only accepts a known blend', () => {
    expect(normalizeMockupState({ x: 12.6, y: -3.2 })).toMatchObject({ x: 13, y: -3 });
    expect(normalizeMockupState({ blend: 'difference' }).blend).toBe('difference');
    expect(normalizeMockupState({ blend: 'multiply' }).blend).toBe('normal');
  });
});

describe('checkMockupSize', () => {
  it('allows anything up to the cap', () => {
    expect(checkMockupSize(0)).toBeNull();
    expect(checkMockupSize(MAX_MOCKUP_BYTES)).toBeNull();
  });

  it('names the limit and the actual size when it refuses', () => {
    const message = checkMockupSize(MAX_MOCKUP_BYTES + 1);
    expect(message).toContain('20 MB');
    expect(message).toMatch(/capped/);
  });
});

describe('mockup records', () => {
  it('lives in the main database, in the store version 2 adds', async () => {
    await getMockup(ORIGIN);
    expect(fake.state.names).toEqual([DB_NAME]);
    expect(DB_VERSION).toBe(2);
    const db = fake.state.dbs.get(DB_NAME);
    expect(db?.objectStoreNames.contains(MOCKUP_STORE)).toBe(true);
    // The stores it shares the database with are still there and untouched.
    expect(db?.objectStoreNames.contains(REFERENCE_STORE)).toBe(true);
  });

  it('round-trips a record keyed by origin', async () => {
    await putMockup(ORIGIN, blobOf(1024), { ...DEFAULT_MOCKUP_STATE, opacity: 0.4 });
    const record = await getMockup(ORIGIN);
    expect(record?.origin).toBe(ORIGIN);
    expect(record?.state.opacity).toBe(0.4);
    expect(record?.blob.size).toBe(1024);
    expect(record?.updatedAt).toBeTypeOf('string');
    expect(await getMockup('https://other.test')).toBeNull();
  });

  it('refuses an image over the cap with a readable error', async () => {
    await expect(putMockup(ORIGIN, blobOf(MAX_MOCKUP_BYTES + 1), DEFAULT_MOCKUP_STATE)).rejects.toThrow(
      /capped at 20 MB/,
    );
    expect(await getMockup(ORIGIN)).toBeNull();
  });

  it('normalizes the state it stores', async () => {
    await putMockup(ORIGIN, blobOf(10), { ...DEFAULT_MOCKUP_STATE, opacity: 9, x: 4.7 });
    const record = await getMockup(ORIGIN);
    expect(record?.state).toMatchObject({ opacity: 1, x: 5 });
  });

  it('updates the state without rewriting the image', async () => {
    const blob = blobOf(2048);
    await putMockup(ORIGIN, blob, DEFAULT_MOCKUP_STATE);
    const updated = await updateMockupState(ORIGIN, {
      ...DEFAULT_MOCKUP_STATE,
      x: 120,
      y: -40,
      locked: true,
    });
    expect(updated?.state).toMatchObject({ x: 120, y: -40, locked: true });
    expect(updated?.blob).toBe(blob);
  });

  it('reports null rather than inventing a record to update', async () => {
    expect(await updateMockupState(ORIGIN, DEFAULT_MOCKUP_STATE)).toBeNull();
  });

  it('deletes a record, and deleting an absent one is not an error', async () => {
    await putMockup(ORIGIN, blobOf(64), DEFAULT_MOCKUP_STATE);
    await deleteMockup(ORIGIN);
    expect(await getMockup(ORIGIN)).toBeNull();
    await expect(deleteMockup(ORIGIN)).resolves.toBeUndefined();
  });
});

describe('migration out of the old mockup database', () => {
  /** Seed the legacy database the way version 1 left it. */
  function seedLegacy(record: { origin: string; blob: Blob; state: unknown; updatedAt: string }) {
    const legacy = new fake.FakeDb();
    legacy.createObjectStore(MOCKUP_STORE, { keyPath: 'origin' });
    void legacy.put(MOCKUP_STORE, record);
    fake.state.dbs.set(LEGACY_MOCKUP_DB_NAME, legacy);
    fake.state.existing = [DB_NAME, LEGACY_MOCKUP_DB_NAME];
    return legacy;
  }

  const legacyRecord = {
    origin: ORIGIN,
    blob: blobOf(512),
    state: { ...DEFAULT_MOCKUP_STATE, opacity: 0.3 },
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  it('moves an existing mockup across and deletes the old database', async () => {
    const legacy = seedLegacy(legacyRecord);

    const record = await getMockup(ORIGIN);
    expect(record?.state.opacity).toBe(0.3);
    expect(record?.updatedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(fake.state.deleted).toEqual([LEGACY_MOCKUP_DB_NAME]);
    expect(legacy.closed).toBe(true);
    expect(fake.state.names).toEqual([DB_NAME, LEGACY_MOCKUP_DB_NAME]);
  });

  it('runs the move once, not on every read', async () => {
    seedLegacy(legacyRecord);
    await getMockup(ORIGIN);
    await getMockup(ORIGIN);
    await putMockup('https://other.test', blobOf(8), DEFAULT_MOCKUP_STATE);
    expect(fake.state.names).toEqual([DB_NAME, LEGACY_MOCKUP_DB_NAME]);
    expect(fake.state.deleted).toEqual([LEGACY_MOCKUP_DB_NAME]);
  });

  it('never opens the old database when it is not there', async () => {
    fake.state.existing = [DB_NAME];
    await getMockup(ORIGIN);
    expect(fake.state.names).toEqual([DB_NAME]);
    expect(fake.state.deleted).toEqual([]);
  });

  it('keeps a record already written under the new roof', async () => {
    seedLegacy(legacyRecord);
    // Something the user saved after the move: it is the newer of the two.
    const main = new fake.FakeDb();
    main.createObjectStore(MOCKUP_STORE, { keyPath: 'origin' });
    void main.put(MOCKUP_STORE, {
      origin: ORIGIN,
      blob: blobOf(64),
      state: { ...DEFAULT_MOCKUP_STATE, opacity: 0.9 },
      updatedAt: '2026-09-18T00:00:00.000Z',
    });
    fake.state.dbs.set(DB_NAME, main);

    expect((await getMockup(ORIGIN))?.state.opacity).toBe(0.9);
    expect(fake.state.deleted).toEqual([LEGACY_MOCKUP_DB_NAME]);
  });

  it('does nothing at all when the page has no indexedDB', async () => {
    delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
    await putMockup(ORIGIN, blobOf(16), DEFAULT_MOCKUP_STATE);
    expect(await getMockup(ORIGIN)).not.toBeNull();
    expect(fake.state.names).toEqual([DB_NAME]);
  });
});
