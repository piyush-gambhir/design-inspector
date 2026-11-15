





import type { BackgroundResponse } from '@/lib/messages';
import { sendToTab } from '@/lib/messages';
import { getSettings } from '@/lib/storage/settings';
import { ensureContentScript } from './inspector-control';


export const GLOBAL_PROBES: string[] = [
  '__NEXT_DATA__',
  '__next_f',
  'React',
  '__REACT_DEVTOOLS_GLOBAL_HOOK__',
  '__VUE__',
  'Vue',
  '__NUXT__',
  '__remixContext',
  'ng',
  'getAllAngularRootElements',
  '_$HY',
  'Shopify',
  'gsap',
  'Lenis',
  'THREE',
  'posthog',
  'hj',
  'Webflow',
  'wp',
  'jQuery',
  'ScrollTrigger',
  'Intercom',
  'analytics',
  'mixpanel',
  'Sentry',
];





export function probeGlobals(names: string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    try {
      if (typeof (window as unknown as Record<string, unknown>)[name] !== 'undefined') {
        found.push(name);
      }
    } catch {

    }
  }
  return found;
}


export async function detectGlobals(tabId: number): Promise<string[]> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: probeGlobals,
      args: [GLOBAL_PROBES],
    });
    const value = results?.[0]?.result;
    if (!Array.isArray(value)) return [];
    return value.filter((name): name is string => typeof name === 'string');
  } catch {


    return [];
  }
}

export async function requestSummary(tabId: number): Promise<BackgroundResponse> {
  const ready = await ensureContentScript(tabId);
  if (!ready.ok) return { ok: false, error: ready.reason };
  const globals = await detectGlobals(tabId);
  const settings = await getSettings();
  const response = await sendToTab(tabId, {
    type: 'content.scanSummary',
    cap: settings.summaryScanCap,
    globals,
  });
  if (!response.ok) return { ok: false, error: response.error };
  if (!('summary' in response)) return { ok: false, error: 'The page scan returned no summary.' };
  return { ok: true, summary: response.summary };
}

export async function requestStack(tabId: number): Promise<BackgroundResponse> {
  const ready = await ensureContentScript(tabId);
  if (!ready.ok) return { ok: false, error: ready.reason };
  const globals = await detectGlobals(tabId);
  const response = await sendToTab(tabId, { type: 'content.detectStack', globals });
  if (!response.ok) return { ok: false, error: response.error };
  if (!('stack' in response)) return { ok: false, error: 'Stack detection returned no report.' };
  return { ok: true, stack: response.stack };
}
