import { describe, expect, it } from 'vitest';

import { crc32, dosDateTime, ZipError, ZipWriter } from '@/lib/exports/zip';

const MTIME = new Date('2026-09-18T10:30:00.000Z');

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function signatureAt(bytes: Uint8Array, offset: number): number[] {
  return [...bytes.slice(offset, offset + 4)];
}

describe('crc32', () => {
  it('matches the published check vectors', () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('is stable for the same bytes', () => {
    const data = new TextEncoder().encode('design inspector');
    expect(crc32(data)).toBe(crc32(data.slice()));
  });
});

describe('dosDateTime', () => {
  it('packs the year, month and day into the DOS date field', () => {
    const stamp = dosDateTime(new Date(2026, 8, 18, 10, 30, 20));
    expect(stamp.date >> 9).toBe(2026 - 1980);
    expect((stamp.date >> 5) & 0x0f).toBe(9);
    expect(stamp.date & 0x1f).toBe(18);
    expect(stamp.time >> 11).toBe(10);
    expect((stamp.time >> 5) & 0x3f).toBe(30);
    // DOS stores seconds in two-second steps.
    expect(stamp.time & 0x1f).toBe(10);
  });
});

describe('ZipWriter', () => {
  it('writes a two-entry archive with the right headers, order and counts', async () => {
    const zip = new ZipWriter();
    zip.add('a.txt', 'hello', { mtime: MTIME });
    zip.add('b/c.txt', new TextEncoder().encode('world!'), { mtime: MTIME });
    const blob = zip.finish();
    expect(blob.type).toBe('application/zip');

    const bytes = await bytesOf(blob);
    // 2 x (30 + name + data) + 2 x (46 + name) + 22
    expect(bytes.byteLength).toBe(35 + 5 + 37 + 6 + 51 + 53 + 22);

    // First local file header.
    expect(signatureAt(bytes, 0)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(u16(bytes, 6)).toBe(0x0800); // UTF-8 filename flag
    expect(u16(bytes, 8)).toBe(0); // STORE
    expect(u32(bytes, 18)).toBe(5); // compressed size == size
    expect(u32(bytes, 22)).toBe(5);
    expect(u16(bytes, 26)).toBe(5); // name length
    expect(new TextDecoder().decode(bytes.slice(30, 35))).toBe('a.txt');
    expect(new TextDecoder().decode(bytes.slice(35, 40))).toBe('hello');
    expect(u32(bytes, 14)).toBe(crc32(new TextEncoder().encode('hello')));

    // Insertion order is the archive order.
    expect(signatureAt(bytes, 40)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(bytes.slice(70, 77))).toBe('b/c.txt');

    // Central directory, right after the last payload.
    const centralOffset = 40 + 43;
    expect(signatureAt(bytes, centralOffset)).toEqual([0x50, 0x4b, 0x01, 0x02]);
    expect(u32(bytes, centralOffset + 42)).toBe(0); // first entry's local offset
    expect(signatureAt(bytes, centralOffset + 51)).toEqual([0x50, 0x4b, 0x01, 0x02]);
    expect(u32(bytes, centralOffset + 51 + 42)).toBe(40); // second entry's offset

    // End of central directory record.
    const endOffset = bytes.byteLength - 22;
    expect(signatureAt(bytes, endOffset)).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(u16(bytes, endOffset + 8)).toBe(2);
    expect(u16(bytes, endOffset + 10)).toBe(2);
    expect(u32(bytes, endOffset + 12)).toBe(104);
    expect(u32(bytes, endOffset + 16)).toBe(centralOffset);
  });

  it('writes an empty archive as just the end record', async () => {
    const bytes = await bytesOf(new ZipWriter().finish());
    expect(bytes.byteLength).toBe(22);
    expect(signatureAt(bytes, 0)).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(u16(bytes, 8)).toBe(0);
  });

  it('encodes non-ASCII paths as UTF-8 and says so in the flag', async () => {
    const zip = new ZipWriter();
    zip.add('café/über.txt', 'x', { mtime: MTIME });
    const bytes = await bytesOf(zip.finish());
    expect(u16(bytes, 6)).toBe(0x0800);
    // Two two-byte characters make the name longer than its character count.
    expect(u16(bytes, 26)).toBe(15);
  });

  it('rejects a duplicate path', () => {
    const zip = new ZipWriter();
    zip.add('a.txt', 'one');
    expect(() => zip.add('a.txt', 'two')).toThrow(ZipError);
    expect(() => zip.add('a.txt', 'two')).toThrow(/already has a file/);
  });

  it('rejects traversal, absolute and backslash paths', () => {
    const zip = new ZipWriter();
    for (const path of ['../escape.txt', 'a/../b.txt', '/abs.txt', 'a\\b.txt', './here.txt', '']) {
      expect(() => zip.add(path, 'x'), path).toThrow(ZipError);
    }
    expect(zip.count).toBe(0);
  });

  it('rejects an entry over the per-file limit', () => {
    const zip = new ZipWriter({ maxEntryBytes: 16 });
    expect(() => zip.add('big.bin', new Uint8Array(17))).toThrow(/over the .* limit for one file/);
    zip.add('ok.bin', new Uint8Array(16));
    expect(zip.count).toBe(1);
  });

  it('rejects an entry that would take the archive over its limit', () => {
    const zip = new ZipWriter({ maxArchiveBytes: 300 });
    zip.add('a.bin', new Uint8Array(100));
    expect(() => zip.add('b.bin', new Uint8Array(100))).toThrow(/past the .* limit/);
    expect(zip.has('a.bin')).toBe(true);
    expect(zip.has('b.bin')).toBe(false);
  });

  it('refuses to be used after it is finished', () => {
    const zip = new ZipWriter();
    zip.add('a.txt', 'x');
    zip.finish();
    expect(() => zip.add('b.txt', 'y')).toThrow(/already finished/);
    expect(() => zip.finish()).toThrow(/already finished/);
  });

  it('copies a view so neighbouring bytes never reach the archive', async () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const zip = new ZipWriter();
    zip.add('view.bin', backing.subarray(2, 4), { mtime: MTIME });
    backing.fill(0);
    const bytes = await bytesOf(zip.finish());
    expect([...bytes.slice(38, 40)]).toEqual([3, 4]);
  });

  it('reports the size the finished archive will have', () => {
    const zip = new ZipWriter();
    expect(zip.byteLength).toBe(22);
    zip.add('a.txt', 'hello');
    expect(zip.byteLength).toBe(35 + 5 + 51 + 22);
  });
});
