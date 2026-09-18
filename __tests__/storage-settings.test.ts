import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/contracts';
import {
  SCAN_CAP_MAX,
  SCAN_CAP_MIN,
  getSettings,
  normalizeSettings,
  onSettingsChanged,
  setSettings,
} from '@/lib/storage/settings';

interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void;

function installChrome(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const listeners: ChangeListener[] = [];
  const fake = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            const oldValue = store[key];
            store[key] = value;
            for (const listener of listeners) {
              listener({ [key]: { oldValue, newValue: value } }, 'local');
            }
          }
        }),
      },
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
  return { store, listeners };
}

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('normalizeSettings', () => {
  it('falls back to the defaults for junk input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: 'neon', hoverCard: 'yes' })).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps the scan cap into the supported range', () => {
    expect(normalizeSettings({ summaryScanCap: 1 }).summaryScanCap).toBe(SCAN_CAP_MIN);
    expect(normalizeSettings({ summaryScanCap: 999_999 }).summaryScanCap).toBe(SCAN_CAP_MAX);
    expect(normalizeSettings({ summaryScanCap: 2500.6 }).summaryScanCap).toBe(2501);
  });

  it('keeps valid values', () => {
    const settings: Settings = {
      theme: 'dark',
      hoverCard: false,
      summaryScanCap: 1200,
      outlineColoring: 'depth',
      preferSemanticParents: false,
    };
    expect(normalizeSettings(settings)).toEqual(settings);
  });
});

describe('settings storage', () => {
  it('reads defaults when nothing is stored', async () => {
    installChrome();
    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial write and returns the normalized result', async () => {
    const { store } = installChrome({ settings: { theme: 'dark', hoverCard: true, summaryScanCap: 800 } });
    const next = await setSettings({ summaryScanCap: 30_000 });
    expect(next).toEqual({
      theme: 'dark',
      hoverCard: true,
      summaryScanCap: SCAN_CAP_MAX,
      outlineColoring: 'tag',
      preferSemanticParents: true,
    });
    expect(store.settings).toEqual(next);
  });

  it('never writes to a synced area', async () => {
    installChrome();
    await setSettings({ theme: 'light' });
    const fake = (globalThis as unknown as { chrome: { storage: { sync?: unknown } } }).chrome;
    expect(fake.storage.sync).toBeUndefined();
  });

  it('notifies subscribers and unsubscribes cleanly', async () => {
    const { listeners } = installChrome();
    const seen: Settings[] = [];
    const unsubscribe = onSettingsChanged(settings => seen.push(settings));
    await setSettings({ theme: 'dark' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.theme).toBe('dark');
    unsubscribe();
    expect(listeners).toHaveLength(0);
    await setSettings({ theme: 'light' });
    expect(seen).toHaveLength(1);
  });

  it('survives a storage read that throws', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async () => {
            throw new Error('storage unavailable');
          }),
        },
        onChanged: { addListener: () => undefined, removeListener: () => undefined },
      },
    };
    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });
});
