// The opt-in font fetch (PRD TYP-01, 17.1).
//
// Everything here is the worker's side of one button press: what it will and
// will not fetch, what it says when the host refuses, and the fact that the
// second press on the same file costs no request at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cachedIdentity,
  identifyFont,
  isIdentifiableFontUrl,
  loadFontIdentities,
  resetFontIdentityCacheForTests,
} from '../lib/background/font-identity';

const URL_A = 'https://cdn.example.invalid/fonts/nb-international-pro.woff2';

// ---------------------------------------------------------------------------
// A minimal sfnt with only a name table, built here so the test owns its bytes.

function utf16be(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    out[index * 2] = code >> 8;
    out[index * 2 + 1] = code & 0xff;
  }
  return out;
}

function fontBytes(family: string): Uint8Array {
  const records = [
    { nameID: 1, value: family },
    { nameID: 2, value: 'Regular' },
    { nameID: 9, value: 'Stefan Gandl' },
  ];
  const encoded = records.map((record) => utf16be(record.value));
  const storageOffset = 6 + records.length * 12;
  const store = encoded.reduce((total, bytes) => total + bytes.byteLength, 0);
  const name = new Uint8Array(storageOffset + store);
  const nameView = new DataView(name.buffer);
  nameView.setUint16(0, 0);
  nameView.setUint16(2, records.length);
  nameView.setUint16(4, storageOffset);
  let cursor = 0;
  records.forEach((record, index) => {
    const base = 6 + index * 12;
    const bytes = encoded[index] as Uint8Array;
    nameView.setUint16(base, 3);
    nameView.setUint16(base + 2, 1);
    nameView.setUint16(base + 4, 0x0409);
    nameView.setUint16(base + 6, record.nameID);
    nameView.setUint16(base + 8, bytes.byteLength);
    nameView.setUint16(base + 10, cursor);
    name.set(bytes, storageOffset + cursor);
    cursor += bytes.byteLength;
  });

  const tableOffset = 28;
  const out = new Uint8Array(tableOffset + name.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  for (let byte = 0; byte < 4; byte += 1) view.setUint8(12 + byte, 'name'.charCodeAt(byte));
  view.setUint32(16, 0);
  view.setUint32(20, tableOffset);
  view.setUint32(24, name.byteLength);
  out.set(name, tableOffset);
  return out;
}

// ---------------------------------------------------------------------------
// Harness

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

let calls: FetchCall[] = [];
let session: Map<string, unknown>;
let originalFetch: typeof globalThis.fetch;
let originalChrome: unknown;

function respondWith(
  body: Uint8Array | null,
  init: { status?: number; contentLength?: string } = {},
): void {
  globalThis.fetch = (async (input: string, requestInit?: RequestInit) => {
    calls.push({ url: String(input), init: requestInit });
    const status = init.status ?? 200;
    const headers = new Headers();
    if (init.contentLength) headers.set('content-length', init.contentLength);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers,
      arrayBuffer: async () => (body ? body.buffer.slice(0) : new ArrayBuffer(0)),
    };
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  calls = [];
  session = new Map();
  originalFetch = globalThis.fetch;
  originalChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: session.get(key) }),
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) session.set(key, value);
        },
      },
    },
  };
  resetFontIdentityCacheForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as unknown as { chrome?: unknown }).chrome = originalChrome;
  resetFontIdentityCacheForTests();
});

// ---------------------------------------------------------------------------

describe('isIdentifiableFontUrl', () => {
  it('accepts the addresses a page can actually serve a font from', () => {
    expect(isIdentifiableFontUrl('https://cdn.example.invalid/a.woff2')).toBe(true);
    expect(isIdentifiableFontUrl('http://localhost:3000/a.woff')).toBe(true);
    expect(isIdentifiableFontUrl('data:font/woff2;base64,AAAA')).toBe(true);
  });

  it('refuses anything else, including our own pages and the file system', () => {
    expect(isIdentifiableFontUrl('blob:https://example.com/abc')).toBe(false);
    expect(isIdentifiableFontUrl('file:///etc/passwd')).toBe(false);
    expect(isIdentifiableFontUrl('chrome-extension://abc/background.js')).toBe(false);
    expect(isIdentifiableFontUrl('data:text/html,<script>')).toBe(false);
    expect(isIdentifiableFontUrl('not a url')).toBe(false);
  });
});

describe('identifyFont', () => {
  it('fetches without credentials and returns the name table', async () => {
    respondWith(fontBytes('NB International Pro'));
    const response = await identifyFont(URL_A);

    expect(response.ok).toBe(true);
    if (!response.ok || !('identity' in response)) throw new Error('no identity');
    expect(response.identity.family).toBe('NB International Pro');
    expect(response.identity.designer).toBe('Stefan Gandl');
    expect(response.identity.url).toBe(URL_A);
    expect(calls).toHaveLength(1);
    // The user's cookies have no business in a font request (PRD 17.3).
    expect(calls[0]?.init?.credentials).toBe('omit');
  });

  it('answers the second press from cache, with no second request', async () => {
    respondWith(fontBytes('NB International Pro'));
    await identifyFont(URL_A);
    await identifyFont(URL_A);
    expect(calls).toHaveLength(1);
    expect(cachedIdentity(URL_A)?.family).toBe('NB International Pro');
  });

  it('mirrors what it read into session storage, and reads it back', async () => {
    respondWith(fontBytes('NB International Pro'));
    await identifyFont(URL_A);
    expect(session.get('font.identity')).toBeDefined();

    // A restarted worker has an empty Map and fills it from the mirror.
    resetFontIdentityCacheForTests();
    expect(cachedIdentity(URL_A)).toBeNull();
    await loadFontIdentities();
    expect(cachedIdentity(URL_A)?.family).toBe('NB International Pro');
  });

  it('says plainly when the host refuses', async () => {
    respondWith(null, { status: 403 });
    const response = await identifyFont(URL_A);
    expect(response).toEqual({ ok: false, error: 'The font host refused the request (403).' });
  });

  it('says plainly when the file is not a font', async () => {
    respondWith(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const response = await identifyFont(URL_A);
    expect(response).toEqual({ ok: false, error: 'Not a font file.' });
  });

  it('refuses an address it will not fetch, before any request', async () => {
    respondWith(fontBytes('Ignored'));
    const response = await identifyFont('file:///Users/someone/Library/Fonts/Thing.otf');
    expect(response.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses an oversized file on the declared length alone', async () => {
    respondWith(fontBytes('Huge'), { contentLength: String(21 * 1024 * 1024) });
    const response = await identifyFont(URL_A);
    expect(response).toEqual({
      ok: false,
      error: 'That font file is larger than 20 MB, so it was not read.',
    });
  });

  it('turns a network failure into a sentence rather than throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    const response = await identifyFont(URL_A);
    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('expected a failure');
    expect(response.error).toContain('Failed to fetch');
  });
});
