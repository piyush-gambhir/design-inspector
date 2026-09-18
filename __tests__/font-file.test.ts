// @vitest-environment node
//
// Reading a font's own name and fvar tables out of the four containers the
// web serves (PRD TYP-01). Every fixture here is built in the test, so nothing
// depends on a binary checked into the repo.
//
// Node rather than jsdom: `brotli/compress` is an asm.js build that inspects
// `window` and takes a browser path that its bundle does not ship. Only the
// test needs the encoder; the parser itself only ever decodes. Everything the
// parser touches (Blob, Response, CompressionStream, DecompressionStream) is a
// Node 22 global.
import { describe, expect, it } from 'vitest';
import brotliCompress from 'brotli/compress';

import {
  FontFileError,
  cleanVersion,
  parseFontIdentity,
  parseNameTable,
  pickName,
} from '../lib/readings/font-file';

// ---------------------------------------------------------------------------
// Fixture builders

interface NameRecordInput {
  platformID: number;
  encodingID: number;
  languageID: number;
  nameID: number;
  value: string;
}

function utf16be(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    out[index * 2] = code >> 8;
    out[index * 2 + 1] = code & 0xff;
  }
  return out;
}

function macRoman(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) out[index] = value.charCodeAt(index) & 0xff;
  return out;
}

/** A real `name` table: header, one record per string, then the string store. */
function buildNameTable(records: NameRecordInput[]): Uint8Array {
  const encoded = records.map((record) =>
    record.platformID === 3 || record.platformID === 0
      ? utf16be(record.value)
      : macRoman(record.value),
  );
  const storageOffset = 6 + records.length * 12;
  const storeSize = encoded.reduce((total, bytes) => total + bytes.byteLength, 0);
  const table = new Uint8Array(storageOffset + storeSize);
  const view = new DataView(table.buffer);

  view.setUint16(0, 0); // version
  view.setUint16(2, records.length);
  view.setUint16(4, storageOffset);

  let stringOffset = 0;
  records.forEach((record, index) => {
    const base = 6 + index * 12;
    const bytes = encoded[index] as Uint8Array;
    view.setUint16(base, record.platformID);
    view.setUint16(base + 2, record.encodingID);
    view.setUint16(base + 4, record.languageID);
    view.setUint16(base + 6, record.nameID);
    view.setUint16(base + 8, bytes.byteLength);
    view.setUint16(base + 10, stringOffset);
    table.set(bytes, storageOffset + stringOffset);
    stringOffset += bytes.byteLength;
  });

  return table;
}

interface AxisInput {
  tag: string;
  min: number;
  default: number;
  max: number;
  nameID: number;
}

function buildFvarTable(axes: AxisInput[]): Uint8Array {
  const axesArrayOffset = 16;
  const axisSize = 20;
  const table = new Uint8Array(axesArrayOffset + axes.length * axisSize);
  const view = new DataView(table.buffer);
  view.setUint16(0, 1); // majorVersion
  view.setUint16(2, 0); // minorVersion
  view.setUint16(4, axesArrayOffset);
  view.setUint16(6, 2); // reserved
  view.setUint16(8, axes.length);
  view.setUint16(10, axisSize);
  view.setUint16(12, 0); // instanceCount
  view.setUint16(14, 0); // instanceSize

  axes.forEach((axis, index) => {
    const base = axesArrayOffset + index * axisSize;
    for (let byte = 0; byte < 4; byte += 1) {
      view.setUint8(base + byte, axis.tag.charCodeAt(byte));
    }
    view.setInt32(base + 4, Math.round(axis.min * 65536));
    view.setInt32(base + 8, Math.round(axis.default * 65536));
    view.setInt32(base + 12, Math.round(axis.max * 65536));
    view.setUint16(base + 16, 0); // flags
    view.setUint16(base + 18, axis.nameID);
  });
  return table;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

/**
 * `base` is where this font will sit in the finished file. A TrueType
 * collection stores table offsets from the start of the whole file, not from
 * the start of the font, so a collection member has to know its own position.
 */
function buildSfnt(
  tables: { tag: string; data: Uint8Array }[],
  version = 0x00010000,
  base = 0,
): Uint8Array {
  const directorySize = 12 + tables.length * 16;
  let offset = align4(directorySize);
  const placed = tables.map((table) => {
    const at = offset;
    offset = align4(offset + table.data.byteLength);
    return { ...table, offset: at };
  });

  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, version);
  view.setUint16(4, tables.length);
  view.setUint16(6, 0);
  view.setUint16(8, 0);
  view.setUint16(10, 0);

  placed.forEach((table, index) => {
    const entry = 12 + index * 16;
    for (let byte = 0; byte < 4; byte += 1) view.setUint8(entry + byte, table.tag.charCodeAt(byte));
    view.setUint32(entry + 4, 0); // checksum
    view.setUint32(entry + 8, table.offset + base);
    view.setUint32(entry + 12, table.data.byteLength);
    out.set(table.data, table.offset);
  });
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A WOFF wrapper: 44-byte header, 20 bytes per table, each table zlib deflated. */
async function buildWoff(tables: { tag: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const compressed = await Promise.all(
    tables.map(async (table) => {
      const deflated = await deflate(table.data);
      // A table only counts as compressed when that made it smaller.
      const useCompressed = deflated.byteLength < table.data.byteLength;
      return { ...table, stored: useCompressed ? deflated : table.data };
    }),
  );

  const directorySize = 44 + tables.length * 20;
  let offset = align4(directorySize);
  const placed = compressed.map((table) => {
    const at = offset;
    offset = align4(offset + table.stored.byteLength);
    return { ...table, offset: at };
  });

  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4646); // 'wOFF'
  view.setUint32(4, 0x00010000); // flavor
  view.setUint32(8, offset); // length
  view.setUint16(12, tables.length);
  view.setUint16(14, 0);
  view.setUint32(16, 0); // totalSfntSize, unused here
  view.setUint16(20, 1);
  view.setUint16(22, 0);

  placed.forEach((table, index) => {
    const base = 44 + index * 20;
    for (let byte = 0; byte < 4; byte += 1) view.setUint8(base + byte, table.tag.charCodeAt(byte));
    view.setUint32(base + 4, table.offset);
    view.setUint32(base + 8, table.stored.byteLength);
    view.setUint32(base + 12, table.data.byteLength);
    view.setUint32(base + 16, 0); // checksum
    out.set(table.stored, table.offset);
  });
  return out;
}

const WOFF2_TAG_INDEX: Record<string, number> = { name: 5, fvar: 47, glyf: 10, loca: 11 };

interface Woff2Table {
  tag: string;
  /** The bytes as they appear in the decompressed stream. */
  data: Uint8Array;
  /**
   * True to mark the table transformed, which is how a real WOFF2 stores glyf
   * and loca. A transformed entry carries both the original length and the
   * transformed one, and a parser that reads the wrong one loses the position
   * of every table after it.
   */
  transformed?: boolean;
  /** The untransformed size, meaningful only for a transformed table. */
  origLength?: number;
}

function base128(value: number): number[] {
  const groups: number[] = [];
  let remaining = value;
  do {
    groups.unshift(remaining & 0x7f);
    remaining = Math.floor(remaining / 128);
  } while (remaining > 0);
  return groups.map((group, index) => (index === groups.length - 1 ? group : group | 0x80));
}

/** A WOFF2 wrapper: one Brotli stream holding every table in directory order. */
function buildWoff2(tables: Woff2Table[]): Uint8Array {
  const directory: number[] = [];
  for (const table of tables) {
    const index = WOFF2_TAG_INDEX[table.tag];
    if (index === undefined) throw new Error(`No known tag index for ${table.tag}`);
    const isGlyfOrLoca = table.tag === 'glyf' || table.tag === 'loca';
    // The null transform is version 3 for glyf and loca, version 0 otherwise.
    const nullTransform = isGlyfOrLoca ? 3 : 0;
    const version = table.transformed ? (isGlyfOrLoca ? 0 : 1) : nullTransform;
    directory.push(index | (version << 6));
    directory.push(...base128(table.origLength ?? table.data.byteLength));
    if (table.transformed) directory.push(...base128(table.data.byteLength));
  }

  const decoded = new Uint8Array(
    tables.reduce((total, table) => total + table.data.byteLength, 0),
  );
  let cursor = 0;
  for (const table of tables) {
    decoded.set(table.data, cursor);
    cursor += table.data.byteLength;
  }
  const compressed = brotliCompress(decoded, { quality: 5 });
  if (!compressed) throw new Error('The test could not compress its own fixture.');

  const out = new Uint8Array(48 + directory.length + compressed.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4632); // 'wOF2'
  view.setUint32(4, 0x00010000); // flavor
  view.setUint32(8, out.byteLength);
  view.setUint16(12, tables.length);
  view.setUint16(14, 0);
  view.setUint32(16, decoded.byteLength); // totalSfntSize
  view.setUint32(20, compressed.byteLength);
  out.set(directory, 48);
  out.set(compressed, 48 + directory.length);
  return out;
}

// ---------------------------------------------------------------------------
// The fixture font

const NAMES: NameRecordInput[] = [
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 1, value: 'NB International' },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 2, value: 'Regular' },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 4, value: 'NB International Pro Regular' },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 5, value: 'Version 1.004' },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 6, value: 'NBInternationalPro-Regular' },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 8, value: 'Neubau Berlin' },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 9, value: 'Stefan Gandl' },
  {
    platformID: 3,
    encodingID: 1,
    languageID: 0x0409,
    nameID: 13,
    value: 'This font is licensed for web use. Redistribution is not permitted.',
  },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 14, value: 'https://example.invalid/eula' },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 16, value: 'NB International Pro' },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 17, value: 'Regular' },
  { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 256, value: 'Weight' },
];

const nameTable = buildNameTable(NAMES);
const fvarTable = buildFvarTable([
  { tag: 'wght', min: 100, default: 400, max: 900, nameID: 256 },
]);

const URL = 'https://cdn.example.invalid/fonts/nb-international-pro.woff2';

describe('parseFontIdentity: sfnt', () => {
  it('reads family, subfamily, designer, foundry, version, and licence from the name table', async () => {
    const bytes = buildSfnt([{ tag: 'name', data: nameTable }]);
    const identity = await parseFontIdentity(bytes.buffer as ArrayBuffer, URL);

    expect(identity.family).toBe('NB International Pro');
    expect(identity.subfamily).toBe('Regular');
    expect(identity.fullName).toBe('NB International Pro Regular');
    expect(identity.postscriptName).toBe('NBInternationalPro-Regular');
    expect(identity.designer).toBe('Stefan Gandl');
    expect(identity.manufacturer).toBe('Neubau Berlin');
    // "Version 1.004" is a prefix nobody needs twice.
    expect(identity.version).toBe('1.004');
    expect(identity.license).toContain('licensed for web use');
    expect(identity.licenseUrl).toBe('https://example.invalid/eula');
    expect(identity.container).toBe('sfnt');
    expect(identity.evidence).toBe('name-table');
    expect(identity.url).toBe(URL);
    expect(identity.fileSize).toBe(bytes.byteLength);
    expect(identity.axes).toEqual([]);
  });

  it('prefers the typographic family (16) over the legacy family (1)', async () => {
    const bytes = buildSfnt([{ tag: 'name', data: nameTable }]);
    const identity = await parseFontIdentity(bytes.buffer as ArrayBuffer, URL);
    expect(identity.family).not.toBe('NB International');
  });

  it('falls back to the legacy family when no typographic family is present', async () => {
    const table = buildNameTable(NAMES.filter((record) => record.nameID !== 16 && record.nameID !== 17));
    const bytes = buildSfnt([{ tag: 'name', data: table }]);
    const identity = await parseFontIdentity(bytes.buffer as ArrayBuffer, URL);
    expect(identity.family).toBe('NB International');
    expect(identity.subfamily).toBe('Regular');
  });

  it('reads variable axes with their names from fvar', async () => {
    const bytes = buildSfnt([
      { tag: 'fvar', data: fvarTable },
      { tag: 'name', data: nameTable },
    ]);
    const identity = await parseFontIdentity(bytes.buffer as ArrayBuffer, URL);
    expect(identity.axes).toEqual([
      { tag: 'wght', name: 'Weight', min: 100, max: 900, default: 400 },
    ]);
  });

  it('reads an OTTO flavoured file and a collection', async () => {
    const otto = buildSfnt([{ tag: 'name', data: nameTable }], 0x4f54544f);
    expect((await parseFontIdentity(otto.buffer as ArrayBuffer, URL)).container).toBe('sfnt');

    const inner = buildSfnt([{ tag: 'name', data: nameTable }], 0x00010000, 16);
    const collection = new Uint8Array(16 + inner.byteLength);
    const view = new DataView(collection.buffer);
    view.setUint32(0, 0x74746366); // 'ttcf'
    view.setUint16(4, 1);
    view.setUint16(6, 0);
    view.setUint32(8, 1); // numFonts
    view.setUint32(12, 16); // offset of the first font
    collection.set(inner, 16);
    const identity = await parseFontIdentity(collection.buffer as ArrayBuffer, URL);
    expect(identity.container).toBe('ttc');
    expect(identity.family).toBe('NB International Pro');
  });

  it('reads a MacRoman record when no Windows record exists', async () => {
    const table = buildNameTable([
      { platformID: 1, encodingID: 0, languageID: 0, nameID: 1, value: 'Chicago' },
    ]);
    const bytes = buildSfnt([{ tag: 'name', data: table }]);
    const identity = await parseFontIdentity(bytes.buffer as ArrayBuffer, URL);
    expect(identity.family).toBe('Chicago');
  });

  it('decodes MacRoman bytes above ASCII at the right positions', async () => {
    // The MacRoman table is 128 entries and a single missing character shifts
    // everything after it, so the bytes with known awkward positions are named
    // here: the non-breaking space at 0xCA, the two dashes at 0xD0 and 0xD1,
    // and the Apple logo at 0xF0 that every short version of the table drops.
    const highBytes = new Uint8Array([0x80, 0xa5, 0xca, 0xd0, 0xd1, 0xf0, 0xff]);
    const storageOffset = 6 + 12;
    const table = new Uint8Array(storageOffset + highBytes.byteLength);
    const view = new DataView(table.buffer);
    view.setUint16(0, 0);
    view.setUint16(2, 1);
    view.setUint16(4, storageOffset);
    view.setUint16(6, 1); // platform 1, Mac
    view.setUint16(8, 0); // encoding 0, Roman
    view.setUint16(10, 0); // language 0, English
    view.setUint16(12, 1); // nameID 1
    view.setUint16(14, highBytes.byteLength);
    view.setUint16(16, 0);
    table.set(highBytes, storageOffset);

    const bytes = buildSfnt([{ tag: 'name', data: table }]);
    const identity = await parseFontIdentity(bytes.buffer as ArrayBuffer, URL);
    expect(identity.family).toBe('\u00c4\u2022\u00a0\u2013\u2014\uf8ff\u02c7');
  });
});

describe('parseFontIdentity: woff', () => {
  it('inflates the zlib compressed name and fvar tables', async () => {
    const bytes = await buildWoff([
      { tag: 'name', data: nameTable },
      { tag: 'fvar', data: fvarTable },
    ]);
    const identity = await parseFontIdentity(bytes.buffer as ArrayBuffer, URL);
    expect(identity.container).toBe('woff');
    expect(identity.family).toBe('NB International Pro');
    expect(identity.axes[0]?.tag).toBe('wght');
  });
});

describe('parseFontIdentity: woff2', () => {
  it('decodes the brotli stream and locates tables by directory order', async () => {
    const bytes = buildWoff2([
      { tag: 'name', data: nameTable },
      { tag: 'fvar', data: fvarTable },
    ]);
    const identity = await parseFontIdentity(bytes.buffer as ArrayBuffer, URL);
    expect(identity.container).toBe('woff2');
    expect(identity.family).toBe('NB International Pro');
    expect(identity.subfamily).toBe('Regular');
    expect(identity.designer).toBe('Stefan Gandl');
    expect(identity.axes).toEqual([
      { tag: 'wght', name: 'Weight', min: 100, max: 900, default: 400 },
    ]);
  });

  it('skips over tables it does not need, including a transformed glyf', async () => {
    // glyf sits between the two tables that matter, so getting its length
    // wrong would move `name` and the parse would fail outright.
    const glyf = new Uint8Array(64).fill(7);
    const bytes = buildWoff2([
      // Transformed, so the directory carries both lengths and only the
      // transformed one counts towards the position of `name`.
      { tag: 'glyf', data: glyf, transformed: true, origLength: 4096 },
      { tag: 'name', data: nameTable },
      { tag: 'fvar', data: fvarTable },
    ]);
    const identity = await parseFontIdentity(bytes.buffer as ArrayBuffer, URL);
    expect(identity.family).toBe('NB International Pro');
    expect(identity.axes[0]?.max).toBe(900);
  });
});

describe('parseFontIdentity: refusals', () => {
  it('rejects an unknown magic number as not a font file', async () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x89, 0x50, 0x4e, 0x47]); // a PNG
    await expect(parseFontIdentity(bytes.buffer as ArrayBuffer, URL)).rejects.toThrow(
      /Not a font file/,
    );
  });

  it('rejects an empty response', async () => {
    await expect(parseFontIdentity(new ArrayBuffer(0), URL)).rejects.toThrow(FontFileError);
  });

  it('rejects a file over the 20 MB cap without parsing it', async () => {
    const oversized = new ArrayBuffer(20 * 1024 * 1024 + 1);
    await expect(parseFontIdentity(oversized, URL)).rejects.toThrow(/larger than 20 MB/);
  });

  it('reports a truncated table rather than returning half an identity', async () => {
    const bytes = buildSfnt([{ tag: 'name', data: nameTable }]);
    const truncated = bytes.slice(0, bytes.byteLength - 40);
    await expect(parseFontIdentity(truncated.buffer as ArrayBuffer, URL)).rejects.toThrow(
      FontFileError,
    );
  });

  it('reports a font with no name table', async () => {
    const bytes = buildSfnt([{ tag: 'fvar', data: fvarTable }]);
    await expect(parseFontIdentity(bytes.buffer as ArrayBuffer, URL)).rejects.toThrow(
      /no name table/,
    );
  });
});

describe('name table helpers', () => {
  it('prefers Windows English over any other record for the same id', () => {
    const table = buildNameTable([
      { platformID: 1, encodingID: 0, languageID: 0, nameID: 1, value: 'Mac name' },
      { platformID: 3, encodingID: 1, languageID: 0x0407, nameID: 1, value: 'German name' },
      { platformID: 3, encodingID: 1, languageID: 0x0409, nameID: 1, value: 'English name' },
    ]);
    expect(pickName(parseNameTable(table), 1)).toBe('English name');
  });

  it('returns null for an id the font does not carry', () => {
    expect(pickName(parseNameTable(nameTable), 99)).toBeNull();
  });

  it('strips a leading "Version " and keeps anything else', () => {
    expect(cleanVersion('Version 2.001')).toBe('2.001');
    expect(cleanVersion('2.001;NEUE')).toBe('2.001;NEUE');
    expect(cleanVersion(null)).toBeNull();
  });
});
