// "Identify font file" (PRD TYP-01, TYP-03, 17.1).
//
// This is the one network path in the product that reaches a host the user did
// not already load, and it only ever runs when they press the button. It
// fetches exactly the one font file the page already served, reads its name
// table, and keeps nothing but the parsed identity.
//
// The fetch lives in the worker rather than the content script for two
// reasons: a page's CSP has no say over it, and the brotli decoder stays out
// of the content-script bundle.
import type { FontIdentity } from '@/lib/contracts';
import type { BackgroundResponse } from '@/lib/messages';
import { FontFileError, MAX_FONT_BYTES, parseFontIdentity } from '@/lib/readings/font-file';

const SESSION_KEY = 'font.identity';
/** Enough to cover a page's whole font set; the worker's own Map is unbounded until it dies. */
const MIRRORED_ENTRIES = 50;
const FETCH_TIMEOUT_MS = 10_000;

/** Parsed identities for this worker's lifetime, keyed by the exact URL read. */
const cache = new Map<string, FontIdentity>();

/** Test seam: forgets what was parsed without touching storage. */
export function resetFontIdentityCacheForTests(): void {
  cache.clear();
}

export function cachedIdentity(url: string): FontIdentity | null {
  return cache.get(url) ?? null;
}

/**
 * Only a URL the page could itself have loaded a font from. A `data:font` URL
 * costs no request at all; anything else (blob, file, chrome-extension) either
 * cannot be read here or is not ours to read.
 */
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

/** Plain language for the status codes a font CDN actually returns. */
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
    // A worker without session storage simply re-fetches after a restart.
  }
}

/** Read the mirror back after the worker was restarted. */
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
    // See above: an unreadable cache is a cold cache, which is safe.
  }
  return cache.size;
}

/**
 * Fetch one font file and read its identity. Never throws: every failure comes
 * back as a sentence the panel can print next to the button that caused it.
 */
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

    // Refuse an oversized file before downloading it when the host says how
    // big it is, and again after, because the header is only a claim.
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
