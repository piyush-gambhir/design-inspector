// Which tabs have a side panel open, and what that means for the page badge
// (workstream W).
//
// The user's question was whether both surfaces are needed at once: "if sidebar
// is open do we need the floating bar". They are not, so while a panel is open
// for a tab the badge on that tab steps aside to its dot and the panel hosts
// the same tools.
//
// The service worker can be killed between two presence messages, so the set is
// mirrored into chrome.storage.session and read back at startup. Every chrome
// call here is guarded: the unit tests drive this module with a partial mock,
// and a missing session storage is a degraded cache, not a failure.
import { sendToTab } from '@/lib/messages';

const SESSION_KEY = 'sidepanel.presence';

let openTabs = new Set<number>();

/**
 * The next presence set for one update. Pure, so the rule is testable without
 * a browser: `open` adds the tab, anything else removes it, and the result is
 * sorted so two equal sets compare equal.
 */
export function nextPresence(
  current: Iterable<number>,
  update: { tabId: number; open: boolean },
): number[] {
  const next = new Set(current);
  if (update.open) next.add(update.tabId);
  else next.delete(update.tabId);
  return [...next].sort((a, b) => a - b);
}

/** The tabs currently showing a side panel. */
export function presenceTabs(): number[] {
  return [...openTabs].sort((a, b) => a - b);
}

export function hasSidePanel(tabId: number): boolean {
  return openTabs.has(tabId);
}

/** Test seam: forgets the set without touching storage. */
export function resetPresenceForTests(): void {
  openTabs = new Set();
}

async function persist(): Promise<void> {
  try {
    await chrome.storage?.session?.set({ [SESSION_KEY]: presenceTabs() });
  } catch {
    // A worker without session storage simply forgets on the next restart.
  }
}

/** Read the set back after the worker was restarted. */
export async function loadPresence(): Promise<number[]> {
  try {
    const stored = await chrome.storage?.session?.get(SESSION_KEY);
    const list = (stored ?? {})[SESSION_KEY];
    if (Array.isArray(list)) {
      openTabs = new Set(list.filter((value): value is number => typeof value === 'number'));
    }
  } catch {
    // See above: an unreadable cache leaves the set empty, which is safe.
  }
  return presenceTabs();
}

/**
 * Tell one tab's badge to step aside, or to come back. A tab with no content
 * script is the normal case (the inspector was never switched on there), and
 * `sendToTab` already answers that with an error rather than throwing.
 */
export async function pushBadge(tabId: number, collapsed: boolean): Promise<void> {
  await sendToTab(tabId, { type: 'content.setBadge', collapsed, reason: 'sidepanel' });
}

/** A panel opened or closed for one tab. */
export async function setSidePanelPresence(tabId: number, open: boolean): Promise<void> {
  openTabs = new Set(nextPresence(openTabs, { tabId, open }));
  await persist();
  await pushBadge(tabId, open);
}

/**
 * The panel's port disconnected, which is the only reliable signal that the
 * panel itself closed: the unmount message races the page going away. One panel
 * exists per window, so every tab it was standing in for gets its badge back.
 */
export async function clearSidePanelPresence(): Promise<void> {
  const tabs = presenceTabs();
  openTabs = new Set();
  await persist();
  for (const tabId of tabs) await pushBadge(tabId, false);
}
