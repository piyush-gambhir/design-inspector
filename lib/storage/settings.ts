// Settings persistence. Local only, never synced: saved research and its
// settings stay on the device (PRD 1.2, 17.3).
import { DEFAULT_SETTINGS, type Settings, type ThemePreference } from '@/lib/contracts';

const SETTINGS_KEY = 'settings';

export const SCAN_CAP_MIN = 500;
export const SCAN_CAP_MAX = 20_000;

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

/** Coerce an unknown stored value into a complete, in-range Settings object. */
export function normalizeSettings(value: unknown): Settings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<Settings>;
  const theme =
    typeof raw.theme === 'string' && THEMES.includes(raw.theme as ThemePreference)
      ? (raw.theme as ThemePreference)
      : DEFAULT_SETTINGS.theme;
  const hoverCard = typeof raw.hoverCard === 'boolean' ? raw.hoverCard : DEFAULT_SETTINGS.hoverCard;
  const capRaw = typeof raw.summaryScanCap === 'number' ? raw.summaryScanCap : NaN;
  const summaryScanCap = Number.isFinite(capRaw)
    ? Math.min(SCAN_CAP_MAX, Math.max(SCAN_CAP_MIN, Math.round(capRaw)))
    : DEFAULT_SETTINGS.summaryScanCap;
  const outlineColoring =
    raw.outlineColoring === 'depth' || raw.outlineColoring === 'tag'
      ? raw.outlineColoring
      : DEFAULT_SETTINGS.outlineColoring;
  const preferSemanticParents =
    typeof raw.preferSemanticParents === 'boolean'
      ? raw.preferSemanticParents
      : DEFAULT_SETTINGS.preferSemanticParents;
  return { theme, hoverCard, summaryScanCap, outlineColoring, preferSemanticParents };
}

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(stored[SETTINGS_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...partial });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Subscribe to settings writes from any extension surface. Returns an unsubscribe. */
export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'local') return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;
    callback(normalizeSettings(change.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      // The surface is closing. An unavailable API is not a failure here.
    }
  };
}
