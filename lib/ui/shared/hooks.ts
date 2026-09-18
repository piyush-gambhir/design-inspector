// Hooks shared by the popup and the side panel.
//
// Chrome APIs are guarded because these modules are also rendered by jsdom in
// unit tests, where `chrome` does not exist.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/contracts';
import type {
  ContentEvent,
  InspectorMode,
  InspectorState,
  OutlineMode,
  PageTools,
  StorageEvent,
} from '@/lib/messages';
import { isMessage, sendToBackground } from '@/lib/messages';
import { SIDEPANEL_PORT } from '@/lib/ports';
import { getSettings, onSettingsChanged, setSettings } from '@/lib/storage/settings';
import { applyTheme } from './theme';

function hasChrome(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

// ---------------------------------------------------------------------------
// Active tab

export interface ActiveTab {
  id: number;
  url: string;
  title: string;
}

export interface ActiveTabInfo {
  tab: ActiveTab | null;
  /** Increments whenever the panel should drop page-derived data. */
  navigationToken: number;
  /**
   * Increments when the URL changed but the document did not, so readings are
   * stale rather than wrong to show (PRD INS-01).
   */
  staleToken: number;
  loading: boolean;
}

function describeTab(tab: chrome.tabs.Tab | undefined): ActiveTab | null {
  if (!tab || typeof tab.id !== 'number') return null;
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
}

/**
 * What a tab update means for page-derived data. A bare url change is an
 * application route change, and only a load that ran to completion can have
 * replaced the document, which is then confirmed by pinging the content
 * script.
 */
export type TabUpdateKind = 'ignore' | 'same-document' | 'load-complete';

export function classifyTabUpdate(
  changeInfo: { status?: string; url?: string },
  state: { sawLoading: boolean },
): TabUpdateKind {
  if (changeInfo.status === 'loading') return 'ignore';
  if (changeInfo.status === 'complete') return state.sawLoading ? 'load-complete' : 'ignore';
  return changeInfo.url ? 'same-document' : 'ignore';
}

/** A content script that answers is still the one that was there before. */
export async function contentScriptAlive(tabId: number): Promise<boolean> {
  if (!hasChrome() || !chrome.tabs?.sendMessage) return false;
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: 'content.ping' })) as
      | { ok?: boolean }
      | undefined;
    return !!response?.ok;
  } catch {
    return false;
  }
}

/** The active tab of the current window, kept current across switches and loads. */
export function useActiveTab(): ActiveTabInfo {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [navigationToken, setNavigationToken] = useState(0);
  const [staleToken, setStaleToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const sawLoading = useRef(false);

  useEffect(() => {
    if (!hasChrome() || !chrome.tabs?.query) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const read = async () => {
      try {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!cancelled) setTab(describeTab(active));
      } catch {
        if (!cancelled) setTab(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void read();

    const onActivated = () => {
      setNavigationToken(token => token + 1);
      void read();
    };
    const onUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
      updated: chrome.tabs.Tab,
    ) => {
      if (!updated.active) return;
      if (changeInfo.status === 'loading') sawLoading.current = true;

      const kind = classifyTabUpdate(changeInfo, { sawLoading: sawLoading.current });
      if (kind === 'same-document') {
        // The document is still there: the readings are stale, not invalid.
        setStaleToken(token => token + 1);
        void read();
        return;
      }
      if (kind === 'load-complete') {
        sawLoading.current = false;
        void (async () => {
          const alive = await contentScriptAlive(updatedTabId);
          if (cancelled) return;
          // A script that still answers rode out the load, so its page data is
          // only stale. Silence means a new document and nothing to keep.
          if (alive) setStaleToken(token => token + 1);
          else setNavigationToken(token => token + 1);
          void read();
        })();
        return;
      }
      if (changeInfo.title || changeInfo.url) void read();
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      try {
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.tabs.onUpdated.removeListener(onUpdated);
      } catch {
        // The page is going away; an unavailable API is not an error here.
      }
    };
  }, []);

  return { tab, navigationToken, staleToken, loading };
}

// ---------------------------------------------------------------------------
// Runtime events

export type RuntimeEventHandler = (
  event: ContentEvent | StorageEvent,
  tabId: number | null,
) => void;

/**
 * Subscribe to broadcasts. Forwarded content events carry their tab in
 * `state.tabId`; anything sent straight from a tab carries `sender.tab.id`.
 */
export function useRuntimeEvents(handler: RuntimeEventHandler): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!hasChrome() || !chrome.runtime?.onMessage) return;
    const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (!isMessage(message)) return;
      if (!message.type.startsWith('event.')) return;
      const event = message as ContentEvent | StorageEvent;
      // Prefer the tab id the background stamped on the event; a message that
      // arrived straight from a tab (not re-broadcast) carries sender.tab.
      let stamped: number | null = null;
      if (event.type === 'event.state' && typeof event.state?.tabId === 'number') {
        stamped = event.state.tabId;
      } else if ('tabId' in event && typeof event.tabId === 'number') {
        stamped = event.tabId;
      }
      const tabId = stamped !== null && stamped >= 0 ? stamped : (sender.tab?.id ?? null);
      ref.current(event, tabId);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(listener);
      } catch {
        // See above: teardown must not throw.
      }
    };
  }, []);
}

// ---------------------------------------------------------------------------
// Inspector state

export interface InspectorStateInfo {
  state: InspectorState | null;
  busy: boolean;
  error: string | null;
  refresh: () => void;
  toggle: () => void;
  /** Layout outlines for this tab. 'off' removes them. */
  setOutlines: (mode: OutlineMode) => void;
  /** A partial update of the page tools the badge also carries (W3). */
  setTools: (tools: Partial<PageTools>) => void;
  /** 'paused' hands the page back to the user without leaving the inspector. */
  setMode: (mode: InspectorMode) => void;
}

export function useInspectorState(tabId: number | null): InspectorStateInfo {
  const [state, setState] = useState<InspectorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (tabId === null || !hasChrome()) return;
    const response = await sendToBackground({ type: 'inspector.getState', tabId });
    if ('state' in response && response.ok) setState(response.state);
    else if (!response.ok) setError(response.error);
  }, [tabId]);

  useEffect(() => {
    setState(null);
    setError(null);
    void load();
  }, [load]);

  useRuntimeEvents((event, eventTabId) => {
    if (event.type !== 'event.state') return;
    if (tabId !== null && eventTabId !== null && eventTabId !== tabId) return;
    setState(event.state);
  });

  const toggle = useCallback(() => {
    if (tabId === null || !hasChrome()) return;
    setBusy(true);
    setError(null);
    void (async () => {
      const response = await sendToBackground({ type: 'inspector.toggle', tabId });
      if (response.ok && 'state' in response) setState(response.state);
      else if (!response.ok) setError(response.error);
      setBusy(false);
    })();
  }, [tabId]);

  const setOutlines = useCallback(
    (mode: OutlineMode) => {
      if (tabId === null || !hasChrome()) return;
      setBusy(true);
      setError(null);
      void (async () => {
        const response = await sendToBackground({ type: 'outlines.set', tabId, mode });
        if (response.ok && 'state' in response) setState(response.state);
        else if (!response.ok) setError(response.error);
        setBusy(false);
      })();
    },
    [tabId],
  );

  const setTools = useCallback(
    (tools: Partial<PageTools>) => {
      if (tabId === null || !hasChrome()) return;
      setError(null);
      void (async () => {
        // The content script answers with `ok` alone and then broadcasts the
        // new state, which the subscription above is already listening for, so
        // nothing is set here on success.
        const response = await sendToBackground({ type: 'tools.set', tabId, tools });
        if (!response.ok) setError(response.error);
      })();
    },
    [tabId],
  );

  const setMode = useCallback(
    (mode: InspectorMode) => {
      if (tabId === null || !hasChrome()) return;
      setBusy(true);
      setError(null);
      void (async () => {
        const response = await sendToBackground({ type: 'inspector.setMode', tabId, mode });
        if (response.ok && 'state' in response) setState(response.state);
        else if (!response.ok) setError(response.error);
        setBusy(false);
      })();
    },
    [tabId],
  );

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { state, busy, error, refresh, toggle, setOutlines, setTools, setMode };
}

// ---------------------------------------------------------------------------
// Side panel presence

/**
 * Tell the background worker that a side panel is open for this tab, so the
 * page badge can step aside while it is (W1). Three things are reported: the
 * mount, every tab switch (the tab being left goes first), and the unmount.
 *
 * The port carries nothing. It exists because a page that is closing cannot be
 * relied on to deliver its last message, while its port always disconnects.
 */
export function useSidePanelPresence(tabId: number | null): void {
  useEffect(() => {
    if (!hasChrome() || !chrome.runtime?.connect) return;
    let port: chrome.runtime.Port | null = null;
    try {
      port = chrome.runtime.connect({ name: SIDEPANEL_PORT });
    } catch {
      // No port means the worker falls back to the unmount message below.
      port = null;
    }
    return () => {
      try {
        port?.disconnect();
      } catch {
        // Teardown must not throw: the page is going away either way.
      }
    };
  }, []);

  useEffect(() => {
    if (tabId === null || !hasChrome()) return;
    void sendToBackground({ type: 'sidepanel.presence', tabId, open: true });
    return () => {
      void sendToBackground({ type: 'sidepanel.presence', tabId, open: false });
    };
  }, [tabId]);
}

// ---------------------------------------------------------------------------
// Settings

export interface SettingsInfo {
  settings: Settings;
  ready: boolean;
  update: (partial: Partial<Settings>) => void;
}

/** Reads settings, applies the theme, and follows writes from the other surface. */
export function useSettings(): SettingsInfo {
  const [settings, setLocal] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!hasChrome() || !chrome.storage?.local) {
      applyTheme(DEFAULT_SETTINGS.theme);
      setReady(true);
      return;
    }
    void getSettings().then(loaded => {
      if (cancelled) return;
      setLocal(loaded);
      setReady(true);
    });
    const unsubscribe = onSettingsChanged(next => {
      if (!cancelled) setLocal(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  const update = useCallback((partial: Partial<Settings>) => {
    setLocal(current => ({ ...current, ...partial }));
    if (!hasChrome() || !chrome.storage?.local) return;
    void setSettings(partial).then(next => setLocal(next));
  }, []);

  return { settings, ready, update };
}

// ---------------------------------------------------------------------------
// Keyboard shortcut

/** The real binding for the toggle command, or null when the user cleared it. */
export function useCommandShortcut(commandName: string): string | null {
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    if (!hasChrome() || !chrome.commands?.getAll) return;
    void chrome.commands.getAll().then(commands => {
      const found = commands.find(command => command.name === commandName);
      setShortcut(found?.shortcut ? found.shortcut : null);
    });
  }, [commandName]);
  return shortcut;
}
