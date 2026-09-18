import { describe, expect, it, vi } from 'vitest';

import type { AssetReading } from '@/lib/contracts';
import {
  ASSET_BATCH_MAX_BYTES,
  AssetBundleCancelled,
  assetFilenames,
  buildAssetBundle,
} from '@/lib/exports/asset-bundle';

const NOW = new Date('2026-09-18T10:30:00.000Z');

function asset(overrides: Partial<AssetReading> = {}): AssetReading {
  return {
    kind: 'img',
    url: 'https://cdn.example.com/media/hero.png',
    candidates: [],
    renderedWidth: 640,
    renderedHeight: 360,
    intrinsicWidth: null,
    intrinsicHeight: null,
    fileSize: null,
    mimeType: null,
    svgMarkup: null,
    alt: null,
    limitations: [],
    ...overrides,
  };
}

function okResponse(bytes: number): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Response;
}

function errorResponse(status: number, statusText = ''): Response {
  return {
    ok: false,
    status,
    statusText,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

/** Reads the archive through its central directory, as an unzip tool would. */
async function readZip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    const start =
      localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    files.set(name, bytes.slice(start, start + size));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('assetFilenames', () => {
  it('prefixes each file with its position so the panel order survives', () => {
    const names = assetFilenames([
      asset(),
      asset({ url: 'https://cdn.example.com/icons/logo.svg' }),
      asset({ kind: 'svg-inline', url: null, svgMarkup: '<svg />' }),
    ]);
    expect(names).toEqual(['1-hero.png', '2-logo.svg', '3-inline.svg']);
  });

  it('keeps two identical basenames apart', () => {
    const names = assetFilenames([
      asset({ url: 'https://a.example.com/hero.png' }),
      asset({ url: 'https://b.example.com/hero.png' }),
    ]);
    expect(names).toEqual(['1-hero.png', '2-hero.png']);
    expect(new Set(names).size).toBe(2);
  });

  it('adds a numeric suffix when sanitizing produces the same name twice', () => {
    // Both of these sanitize to `a-b.png` and would otherwise collide once the
    // index is stripped by a tool that flattens the archive.
    const names = assetFilenames([
      asset({ url: 'https://cdn.example.com/1/a%20b.png' }),
      asset({ url: 'https://cdn.example.com/1/a%20b.png' }),
    ]);
    expect(names).toEqual(['1-a-b.png', '2-a-b.png']);
  });

  it('never lets a page-supplied name escape into a path', () => {
    const names = assetFilenames([
      asset({ url: 'https://cdn.example.com/a/..%2F..%2Fetc%2Fpasswd' }),
      asset({ url: 'https://cdn.example.com/a/' }),
      asset({ kind: 'video', url: null }),
    ]);
    expect(names[0]).not.toContain('/');
    expect(names[0]).not.toContain('..');
    expect(names[1]).toBe('2-a');
    expect(names[2]).toBe('3-video');
  });

  it('caps a very long name while keeping its extension', () => {
    const long = `${'x'.repeat(200)}.png`;
    const name = assetFilenames([asset({ url: `https://cdn.example.com/${long}` })])[0] as string;
    expect(name.length).toBeLessThanOrEqual(84);
    expect(name.endsWith('.png')).toBe(true);
  });
});

describe('buildAssetBundle', () => {
  it('writes each fetched asset plus a manifest, with credentials omitted', async () => {
    const fetchAsset = vi.fn(async (_url: string, _init: RequestInit) => okResponse(64));
    const result = await buildAssetBundle(
      [asset(), asset({ kind: 'svg-inline', url: null, svgMarkup: '<svg id="a" />' })],
      { extensionVersion: '0.1.0', fetchAsset, now: NOW },
    );

    expect(result.filename).toBe('design-inspector-assets-2026-09-18.zip');
    expect(result.writtenCount).toBe(2);
    expect(result.stoppedAtCap).toBe(false);
    // The inline SVG never goes to the network.
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(fetchAsset.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' });

    const files = await readZip(result.blob);
    expect([...files.keys()]).toEqual(['1-hero.png', '2-inline.svg', 'manifest.json']);
    expect(new TextDecoder().decode(files.get('2-inline.svg'))).toBe('<svg id="a" />');

    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
    expect(manifest.extensionVersion).toBe('0.1.0');
    expect(manifest.generatedAt).toBe(NOW.toISOString());
    expect(manifest.written).toEqual([
      { path: '1-hero.png', source: 'https://cdn.example.com/media/hero.png', bytes: 64 },
      { path: '2-inline.svg', source: 'inline SVG', bytes: 14 },
    ]);
    expect(manifest.skipped).toEqual([]);
  });

  it('records an HTTP failure and keeps the rest of the batch', async () => {
    const fetchAsset = vi.fn(async (url: string) =>
      url.includes('missing') ? errorResponse(404, 'Not Found') : okResponse(16),
    );
    const result = await buildAssetBundle(
      [asset({ url: 'https://cdn.example.com/missing.png' }), asset()],
      { extensionVersion: '0.1.0', fetchAsset, now: NOW },
    );

    expect(result.writtenCount).toBe(1);
    expect(result.manifest.skipped).toEqual([
      {
        path: '1-missing.png',
        source: 'https://cdn.example.com/missing.png',
        reason: 'HTTP 404 Not Found.',
      },
    ]);
    expect((await readZip(result.blob)).has('2-hero.png')).toBe(true);
  });

  it('records a blocked cross-origin read with a reason', async () => {
    const fetchAsset = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await buildAssetBundle([asset()], {
      extensionVersion: '0.1.0',
      fetchAsset,
      now: NOW,
    });
    expect(result.manifest.skipped[0]?.reason).toBe('Failed to fetch');
    expect(result.writtenCount).toBe(0);
  });

  it('explains an asset that has no URL to fetch', async () => {
    const result = await buildAssetBundle(
      [asset({ kind: 'video', url: null, limitations: ['Streamed video, no downloadable file'] })],
      { extensionVersion: '0.1.0', fetchAsset: async () => okResponse(1), now: NOW },
    );
    expect(result.manifest.skipped).toEqual([
      { path: '1-video', source: 'inline video', reason: 'Streamed video, no downloadable file' },
    ]);
  });

  it('stops at the batch cap and says how many fit', async () => {
    const fetchAsset = vi.fn(async () => okResponse(400));
    const assets = [
      asset(),
      asset({ url: 'https://cdn.example.com/b.png' }),
      asset({ url: 'https://cdn.example.com/c.png' }),
      asset({ url: 'https://cdn.example.com/d.png' }),
    ];
    const result = await buildAssetBundle(assets, {
      extensionVersion: '0.1.0',
      fetchAsset,
      maxBytes: 900,
      now: NOW,
    });

    expect(result.writtenCount).toBe(2);
    expect(result.stoppedAtCap).toBe(true);
    expect(result.manifest.skipped.map((entry) => entry.reason)).toEqual([
      'Stopped at the 900 byte batch limit.',
      'Stopped at the 900 byte batch limit.',
    ]);
    // The asset that overflows is the last one fetched; nothing after it is.
    expect(fetchAsset).toHaveBeenCalledTimes(3);
    expect([...(await readZip(result.blob)).keys()]).toEqual([
      '1-hero.png',
      '2-b.png',
      'manifest.json',
    ]);
  });

  it('never raises its own cap above the documented limit', async () => {
    const huge = ASSET_BATCH_MAX_BYTES * 4;
    const fetchAsset = vi.fn(async () => okResponse(8));
    const result = await buildAssetBundle([asset()], {
      extensionVersion: '0.1.0',
      fetchAsset,
      maxBytes: huge,
      now: NOW,
    });
    expect(result.stoppedAtCap).toBe(false);
    expect(ASSET_BATCH_MAX_BYTES).toBe(200 * 1024 * 1024);
  });

  it('reports progress once per asset, in order', async () => {
    const seen: [number, number][] = [];
    await buildAssetBundle([asset(), asset({ url: 'https://cdn.example.com/b.png' })], {
      extensionVersion: '0.1.0',
      fetchAsset: async () => okResponse(8),
      onProgress: (done, total) => seen.push([done, total]),
      now: NOW,
    });
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('throws a cancellation as soon as the caller aborts', async () => {
    const controller = new AbortController();
    const fetchAsset = vi.fn(async () => {
      controller.abort();
      return okResponse(8);
    });
    await expect(
      buildAssetBundle([asset(), asset({ url: 'https://cdn.example.com/b.png' })], {
        extensionVersion: '0.1.0',
        fetchAsset,
        signal: controller.signal,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(AssetBundleCancelled);
    expect(fetchAsset).toHaveBeenCalledTimes(1);
  });
});
