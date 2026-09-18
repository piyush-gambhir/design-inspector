import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, type Settings } from '@/lib/contracts';
import { INSPECTOR_KEY, bootInspector } from '@/lib/inspector/boot';

// The content script reads Settings.preferSemanticParents for itself, so the
// harness needs chrome.storage.local as well as chrome.runtime.

type Listener = (message: unknown, sender: unknown, send: (value: unknown) => void) => unknown;
type ChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;

interface Harness {
  /** Write settings the way any extension surface would, listeners included. */
  write(settings: Settings): void;
}

function installChrome(initial: Partial<Settings> = {}): Harness {
  const stored: Record<string, unknown> = {
    settings: { ...DEFAULT_SETTINGS, ...initial },
  };
  const changeListeners: ChangeListener[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'design-inspector-test',
      onMessage: { addListener: (_listener: Listener) => undefined, removeListener: () => undefined },
      sendMessage: () => Promise.resolve({ ok: true }),
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async () => undefined,
      },
      onChanged: {
        addListener: (listener: ChangeListener) => changeListeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          const index = changeListeners.indexOf(listener);
          if (index >= 0) changeListeners.splice(index, 1);
        },
      },
    },
  };

  return {
    write(settings) {
      const oldValue = stored.settings;
      stored.settings = settings;
      for (const listener of changeListeners) {
        listener({ settings: { oldValue, newValue: settings } }, 'local');
      }
    },
  };
}

/** Lets the boot-time getSettings promise resolve. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function reset(): void {
  const container = globalThis as unknown as Record<symbol, unknown>;
  delete container[INSPECTOR_KEY];
  document.body.innerHTML = '';
  document.querySelectorAll('design-inspector-host').forEach((node) => node.remove());
}

/** The badge button, once the overlay exists. */
function badge(): HTMLButtonElement | null {
  const host = document.querySelector('design-inspector-host');
  return (host?.shadowRoot?.getElementById('badge-semantic') as HTMLButtonElement | null) ?? null;
}

beforeEach(() => {
  reset();
  document.body.innerHTML = '<h2 id="head"><span id="text">Wrapped</span></h2>';
});

afterEach(() => {
  reset();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('preferSemanticParents from settings', () => {
  it('starts from the stored preference when it is off', async () => {
    installChrome({ preferSemanticParents: false });
    const api = bootInspector();
    await settle();
    expect(api.semanticParents()).toBe(false);
  });

  it('starts from the stored preference when it is on', async () => {
    installChrome({ preferSemanticParents: true });
    const api = bootInspector();
    await settle();
    expect(api.semanticParents()).toBe(true);
  });

  it('follows a later settings change in both directions', async () => {
    const harness = installChrome({ preferSemanticParents: true });
    const api = bootInspector();
    await settle();

    harness.write({ ...DEFAULT_SETTINGS, preferSemanticParents: false });
    expect(api.semanticParents()).toBe(false);

    harness.write({ ...DEFAULT_SETTINGS, preferSemanticParents: true });
    expect(api.semanticParents()).toBe(true);
  });

  it('keeps the contract default when storage cannot be read', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        id: 'design-inspector-test',
        onMessage: { addListener: () => undefined, removeListener: () => undefined },
        sendMessage: () => Promise.resolve({ ok: true }),
      },
    };
    const api = bootInspector();
    await settle();
    expect(api.semanticParents()).toBe(DEFAULT_SETTINGS.preferSemanticParents);
  });

  it('shows the stored preference on the badge and lets the badge override it', async () => {
    const harness = installChrome({ preferSemanticParents: false });
    const api = bootInspector();
    await settle();
    api.setMode('active');

    const button = badge();
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    button?.click();
    expect(api.semanticParents()).toBe(true);
    expect(badge()?.getAttribute('aria-pressed')).toBe('true');

    // The per-session override stands until the page reloads, so a settings
    // write no longer moves it back.
    harness.write({ ...DEFAULT_SETTINGS, preferSemanticParents: false });
    expect(api.semanticParents()).toBe(true);
  });
});
