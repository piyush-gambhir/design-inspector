









import type { FontIdentity } from '@/lib/contracts';
import type { BackgroundResponse } from '@/lib/messages';
import { FontFileError, MAX_FONT_BYTES, parseFontIdentity } from '@/lib/readings/font-file';

const SESSION_KEY = 'font.identity';

const MIRRORED_ENTRIES = 50;
const FETCH_TIMEOUT_MS = 10_000;


const cache = new Map<string, FontIdentity>();


export function resetFontIdentityCacheForTests(): void {
  cache.clear();
}

export function cachedIdentity(url: string): FontIdentity | null {
  return cache.get(url) ?? null;
}






export function isIdentifiableFontUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true;
  return parsed.protocol === 'data:' && /^data:font\/|^data:application\/font/i.test(url);
}


function statusMessage(status: number): string {
  if (status === 403) return 'The font host refused the request (403).';
  if (status === 404) return 'The font file is no longer at that URL (404).';
  if (status === 401) return 'The font host requires credentials (401).';
  if (status === 429) return 'The font host is rate limiting this request (429).';
  if (status >= 500) return `The font host returned an error (${status}).`;
  return `The font host refused the request (${status}).`;
}

async function mirror(): Promise<void> {
  try {
    const entries = [...cache.entries()].slice(-MIRRORED_ENTRIES);
    await chrome.storage?.session?.set({ [SESSION_KEY]: entries });
  } catch {

  }
}


export async function loadFontIdentities(): Promise<number> {
  try {
    const stored = await chrome.storage?.session?.get(SESSION_KEY);
    const entries = (stored ?? {})[SESSION_KEY];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [url, identity] = entry as [unknown, unknown];
        if (typeof url === 'string' && identity && typeof identity === 'object') {
          cache.set(url, identity as FontIdentity);
        }
      }
    }
  } catch {

  }
  return cache.size;
}





export async function identifyFont(url: string): Promise<BackgroundResponse> {
  if (!isIdentifiableFontUrl(url)) {
    return { ok: false, error: 'That is not a font file address this extension can read.' };
  }

  const cached = cache.get(url);
  if (cached) return { ok: true, identity: cached };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      signal: controller.signal,
      cache: 'force-cache',
    });
    if (!response.ok) return { ok: false, error: statusMessage(response.status) };



    const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(declared) && declared > MAX_FONT_BYTES) {
      return { ok: false, error: 'That font file is larger than 20 MB, so it was not read.' };
    }
    bytes = await response.arrayBuffer();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'The font host did not answer in time.' };
    }
    return {
      ok: false,
      error: `The font file could not be fetched (${error instanceof Error ? error.message : String(error)}).`,
    };
  } finally {
    clearTimeout(timer);
  }

  try {
    const identity = await parseFontIdentity(bytes, url);
    cache.set(url, identity);
    await mirror();
    return { ok: true, identity };
  } catch (error) {
    if (error instanceof FontFileError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: `That file could not be read as a font (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
}
