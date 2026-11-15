



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




export interface ActiveTab {
  id: number;
  url: string;
  title: string;
}

export interface ActiveTabInfo {
  tab: ActiveTab | null;

  navigationToken: number;




  staleToken: number;
  loading: boolean;
}

function describeTab(tab: chrome.tabs.Tab | undefined): ActiveTab | null {
  if (!tab || typeof tab.id !== 'number') return null;
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
}







export type TabUpdateKind = 'ignore' | 'same-document' | 'load-complete';

export function classifyTabUpdate(
  changeInfo: { status?: string; url?: string },
  state: { sawLoading: boolean },
): TabUpdateKind {
  if (changeInfo.status === 'loading') return 'ignore';
  if (changeInfo.status === 'complete') return state.sawLoading ? 'load-complete' : 'ignore';
  return changeInfo.url ? 'same-document' : 'ignore';
}


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

        setStaleToken(token => token + 1);
        void read();
        return;
      }
      if (kind === 'load-complete') {
        sawLoading.current = false;
        void (async () => {
          const alive = await contentScriptAlive(updatedTabId);
          if (cancelled) return;


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

      }
    };
  }, []);

  return { tab, navigationToken, staleToken, loading };
}




export type RuntimeEventHandler = (
  event: ContentEvent | StorageEvent,
  tabId: number | null,
) => void;





export function useRuntimeEvents(handler: RuntimeEventHandler): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!hasChrome() || !chrome.runtime?.onMessage) return;
    const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (!isMessage(message)) return;
      if (!message.type.startsWith('event.')) return;
      const event = message as ContentEvent | StorageEvent;


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

      }
    };
  }, []);
}




export interface InspectorStateInfo {
  state: InspectorState | null;
  busy: boolean;
  error: string | null;
  refresh: () => void;
  toggle: () => void;

  setOutlines: (mode: OutlineMode) => void;

  setTools: (tools: Partial<PageTools>) => void;

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












export function useSidePanelPresence(tabId: number | null): void {
  useEffect(() => {
    if (!hasChrome() || !chrome.runtime?.connect) return;
    let port: chrome.runtime.Port | null = null;
    try {
      port = chrome.runtime.connect({ name: SIDEPANEL_PORT });
    } catch {

      port = null;
    }
    return () => {
      try {
        port?.disconnect();
      } catch {

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




export interface SettingsInfo {
  settings: Settings;
  ready: boolean;
  update: (partial: Partial<Settings>) => void;
}


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
