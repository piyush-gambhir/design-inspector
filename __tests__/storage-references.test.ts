import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedReference } from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';

// A tiny in-memory stand-in for idb. fake-indexeddb is not a dependency, so the
// store logic is exercised against this instead, including the upgrade path.
const fake = vi.hoisted(() => {
  interface FakeStore {
    keyPath?: string;
    records: Map<string, unknown>;
    indexes: { name: string; keyPath: string }[];
  }

  const state: { db: FakeDb | null; opens: number } = { db: null, opens: 0 };

  class FakeDb {
    stores = new Map<string, FakeStore>();

    objectStoreNames = {
      contains: (name: string) => this.stores.has(name),
    };

    createObjectStore(name: string, options?: { keyPath?: string }) {
      const store: FakeStore = {
        keyPath: options?.keyPath,
        records: new Map(),
        indexes: [],
      };
      this.stores.set(name, store);
      return {
        createIndex: (indexName: string, keyPath: string) => {
          store.indexes.push({ name: indexName, keyPath });
        },
      };
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
        key ??
        (store.keyPath ? (value as Record<string, string>)[store.keyPath] : undefined);
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
    _name: string,
    _version: number,
    options?: { upgrade?: (db: unknown) => void },
  ) => {
    fake.state.opens += 1;
    const db = new fake.FakeDb();
    options?.upgrade?.(db);
    fake.state.db = db;
    return db;
  },
}));

const {
  DB_NAME,
  DB_VERSION,
  MOCKUP_STORE,
  REFERENCE_STORE,
  SCREENSHOT_STORE,
  applyMetaPatch,
  clearReferences,
  deleteReference,
  describeStorageError,
  exportReferences,
  formatBytes,
  getReference,
  listReferences,
  putReference,
  putScreenshot,
  resetDatabaseForTests,
  screenshotIsOrphaned,
  sortNewestFirst,
  updateReferenceMeta,
} = await import('@/lib/storage/references');

function makeReference(overrides: Partial<SavedReference> = {}): SavedReference {
  const id = overrides.id ?? 'ref-1';
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    kind: 'element',
    title: `Reference ${id}`,
    note: '',
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
    screenshotId: null,
    screenshotIsCrop: null,
    ...overrides,
    snapshot: (overrides.snapshot ?? {
      id: `snap-${id}`,
      schemaVersion: SCHEMA_VERSION,
      source: {
        url: 'https://example.com/pricing',
        title: 'Pricing',
        capturedAt: '2026-09-18T10:00:00.000Z',
        viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
        rootFontSize: 16,
        scrollX: 0,
        scrollY: 0,
      },
      element: { tag: 'h1', id: null, classes: [], role: null, label: 'h1', textSample: null, locator: 'h1' },
    }) as SavedReference['snapshot'],
  } as SavedReference;
}

beforeEach(() => {
  resetDatabaseForTests();
  fake.state.db = null;
  fake.state.opens = 0;
});

describe('database shape', () => {
  it('creates every store with its keys and indexes on upgrade', async () => {
    await listReferences();
    const db = fake.state.db;
    expect(DB_NAME).toBe('design-inspector');
    // 2 added the mockups store, which used to be a database of its own.
    expect(DB_VERSION).toBe(2);
    const references = db?.stores.get(REFERENCE_STORE);
    expect(references?.keyPath).toBe('id');
    expect(references?.indexes).toEqual([
      { name: 'createdAt', keyPath: 'createdAt' },
      { name: 'sourceUrl', keyPath: 'snapshot.source.url' },
    ]);
    const screenshots = db?.stores.get(SCREENSHOT_STORE);
    expect(screenshots?.keyPath).toBeUndefined();
    expect(db?.stores.get(MOCKUP_STORE)?.keyPath).toBe('origin');
  });

  it('clearing the collection leaves the mockups store alone', async () => {
    await listReferences();
    const db = fake.state.db;
    db?.stores.get(MOCKUP_STORE)?.records.set('https://example.com', { origin: 'https://example.com' });
    await clearReferences();
    expect(db?.stores.get(MOCKUP_STORE)?.records.size).toBe(1);
  });

  it('opens the database once and reuses the connection', async () => {
    await listReferences();
    await listReferences();
    expect(fake.state.opens).toBe(1);
  });
});

describe('pure rules', () => {
  it('applyMetaPatch only touches the supplied fields and advances updatedAt', () => {
    const reference = makeReference({ title: 'Old', note: 'Old note' });
    const next = applyMetaPatch(reference, { note: 'New note' }, '2026-09-19T00:00:00.000Z');
    expect(next.title).toBe('Old');
    expect(next.note).toBe('New note');
    expect(next.updatedAt).toBe('2026-09-19T00:00:00.000Z');
    expect(next.createdAt).toBe(reference.createdAt);
    expect(next.snapshot).toBe(reference.snapshot);
  });

  it('applyMetaPatch accepts an empty note without falling back', () => {
    const reference = makeReference({ note: 'something' });
    expect(applyMetaPatch(reference, { note: '' }, 'now').note).toBe('');
  });

  it('sortNewestFirst puts the most recent capture first', () => {
    const older = makeReference({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = makeReference({ id: 'b', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(sortNewestFirst([older, newer]).map(entry => entry.id)).toEqual(['b', 'a']);
  });

  it('screenshotIsOrphaned ignores the reference being deleted', () => {
    const one = makeReference({ id: 'a', screenshotId: 'shot' });
    const two = makeReference({ id: 'b', screenshotId: 'shot' });
    expect(screenshotIsOrphaned([one], 'shot', 'a')).toBe(true);
    expect(screenshotIsOrphaned([one, two], 'shot', 'a')).toBe(false);
  });

  it('describeStorageError explains a quota failure in plain language', () => {
    const error = Object.assign(new Error('boom'), { name: 'QuotaExceededError' });
    expect(describeStorageError(error)).toMatch(/Local storage is full/);
    expect(describeStorageError(new Error('plain failure'))).toBe('plain failure');
  });

  it('formatBytes reports Unknown rather than zero', () => {
    expect(formatBytes(null)).toBe('Unknown');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
});

describe('reference records', () => {
  it('round-trips a reference and lists newest first', async () => {
    await putReference(makeReference({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }));
    await putReference(makeReference({ id: 'new', createdAt: '2026-09-01T00:00:00.000Z' }));
    expect((await listReferences()).map(entry => entry.id)).toEqual(['new', 'old']);
    expect(await getReference('old')).not.toBeNull();
    expect(await getReference('missing')).toBeNull();
  });

  it('updateReferenceMeta persists the edit without rewriting the snapshot', async () => {
    const original = makeReference({ id: 'ref-2' });
    await putReference(original);
    const updated = await updateReferenceMeta('ref-2', { title: 'Hero typography' });
    expect(updated.title).toBe('Hero typography');
    expect(updated.snapshot).toEqual(original.snapshot);
    expect(updated.updatedAt).not.toBe(original.updatedAt);
    expect((await getReference('ref-2'))?.title).toBe('Hero typography');
  });

  it('updateReferenceMeta reports a reference that is already gone', async () => {
    await expect(updateReferenceMeta('nope', { note: 'x' })).rejects.toThrow(/no longer exists/);
  });

  it('deleteReference removes an orphaned screenshot but keeps a shared one', async () => {
    await putReference(makeReference({ id: 'a', screenshotId: 'shot-a' }));
    await putScreenshot('shot-a', new Blob(['a']));
    await putReference(makeReference({ id: 'b', screenshotId: 'shared' }));
    await putReference(makeReference({ id: 'c', screenshotId: 'shared' }));
    await putScreenshot('shared', new Blob(['s']));

    await deleteReference('a');
    expect(fake.state.db?.stores.get(SCREENSHOT_STORE)?.records.has('shot-a')).toBe(false);

    await deleteReference('b');
    expect(fake.state.db?.stores.get(SCREENSHOT_STORE)?.records.has('shared')).toBe(true);
  });

  it('clearReferences empties both stores', async () => {
    await putReference(makeReference({ id: 'a', screenshotId: 'shot' }));
    await putScreenshot('shot', new Blob(['a']));
    await clearReferences();
    expect(await listReferences()).toEqual([]);
    expect(fake.state.db?.stores.get(SCREENSHOT_STORE)?.records.size).toBe(0);
  });

  it('exportReferences preserves the requested order and skips unknown ids', async () => {
    await putReference(makeReference({ id: 'a' }));
    await putReference(makeReference({ id: 'b' }));
    const exported = await exportReferences(['b', 'missing', 'a']);
    expect(exported.map(entry => entry.id)).toEqual(['b', 'a']);
  });
});
