











import { sendToTab } from '@/lib/messages';

const SESSION_KEY = 'sidepanel.presence';

let openTabs = new Set<number>();






export function nextPresence(
  current: Iterable<number>,
  update: { tabId: number; open: boolean },
): number[] {
  const next = new Set(current);
  if (update.open) next.add(update.tabId);
  else next.delete(update.tabId);
  return [...next].sort((a, b) => a - b);
}


export function presenceTabs(): number[] {
  return [...openTabs].sort((a, b) => a - b);
}

export function hasSidePanel(tabId: number): boolean {
  return openTabs.has(tabId);
}


export function resetPresenceForTests(): void {
  openTabs = new Set();
}

async function persist(): Promise<void> {
  try {
    await chrome.storage?.session?.set({ [SESSION_KEY]: presenceTabs() });
  } catch {

  }
}


export async function loadPresence(): Promise<number[]> {
  try {
    const stored = await chrome.storage?.session?.get(SESSION_KEY);
    const list = (stored ?? {})[SESSION_KEY];
    if (Array.isArray(list)) {
      openTabs = new Set(list.filter((value): value is number => typeof value === 'number'));
    }
  } catch {

  }
  return presenceTabs();
}






export async function pushBadge(tabId: number, collapsed: boolean): Promise<void> {
  await sendToTab(tabId, { type: 'content.setBadge', collapsed, reason: 'sidepanel' });
}


export async function setSidePanelPresence(tabId: number, open: boolean): Promise<void> {
  openTabs = new Set(nextPresence(openTabs, { tabId, open }));
  await persist();
  await pushBadge(tabId, open);
}






export async function clearSidePanelPresence(): Promise<void> {
  const tabs = presenceTabs();
  openTabs = new Set();
  await persist();
  for (const tabId of tabs) await pushBadge(tabId, false);
}
