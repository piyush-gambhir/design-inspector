// Real font identity, read from the font file itself (PRD TYP-01, TYP-03).
//
// A site's CSS alias is whatever the person who wrote the @font-face block
// typed: "Nb international pro webfont" is not a typeface, it is a nickname.
// The typeface's own name lives in the OpenType `name` table inside the served
// woff2/woff/ttf, next to its designer, foundry, version, and licence. This
// module opens the container, finds `name` and `fvar`, and reads them.
//
// Pure: no chrome APIs, no fetch. The caller supplies the bytes. The only
// runtime dependency is `brotli`, reached through a dynamic import in the
// WOFF2 branch so it lands in the chunk of whoever actually parses a file
// (the background worker) rather than in every bundle that imports a type.

import type { FontIdentity } from '../contracts';

/** Refuse anything larger than this before spending time on it. */
export const MAX_FONT_BYTES = 20 * 1024 * 1024;

/** name id 13 is a whole licence agreement in some fonts. */
const MAX_LICENSE_CHARS = 300;

const SIG_WOFF2 = 0x774f4632; // 'wOF2'
const SIG_WOFF = 0x774f4646; // 'wOFF'
const SIG_TTCF = 0x74746366; // 'ttcf'
const SIG_TRUE = 0x74727565; // 'true'
const SIG_OTTO = 0x4f54544f; // 'OTTO'
const SIG_TYP1 = 0x74797031; // 'typ1'
const SIG_SFNT = 0x00010000;

/** WOFF2 table tags 0 to 62; index 63 means an arbitrary 4-byte tag follows. */
const WOFF2_KNOWN_TAGS: readonly string[] = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/** Only these two tables are ever needed, so only these are ever inflated. */
const WANTED_TAGS: readonly string[] = ['name', 'fvar'];

/** A font file that does not parse is a readable failure, not a crash. */
export class FontFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontFileError';
  }
}

// ---------------------------------------------------------------------------
// Byte readers

class Reader {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private require(length: number, what: string): void {
    if (this.offset + length > this.bytes.byteLength) {
      throw new FontFileError(`This font file ends in the middle of its ${what}.`);
    }
  }

  u8(what = 'header'): number {
    this.require(1, what);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(what = 'header'): number {
    this.require(2, what);
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  u32(what = 'header'): number {
    this.require(4, what);
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  /** 16.16 signed fixed point, as fvar uses for axis bounds. */
  fixed(what = 'axis'): number {
    this.require(4, what);
    const value = this.view.getInt32(this.offset) / 65536;
    this.offset += 4;
    return value;
  }

  tag(what = 'table directory'): string {
    this.require(4, what);
    let out = '';
    for (let index = 0; index < 4; index += 1) {
      out += String.fromCharCode(this.view.getUint8(this.offset + index));
    }
    this.offset += 4;
    return out;
  }

  /** WOFF2 UIntBase128: up to five 7-bit groups, high bit continues. */
  base128(what = 'table directory'): number {
    let value = 0;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.u8(what);
      // A leading zero byte is not a canonical encoding, and neither is a
      // value that would overflow 32 bits. Both mean the file is not one.
      if (index === 0 && byte === 0x80) {
        throw new FontFileError('This font file has a malformed table directory.');
      }
      if (value > 0x01ffffff) {
        throw new FontFileError('This font file declares an impossible table length.');
      }
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new FontFileError('This font file has a malformed table directory.');
  }
}

function sliceOrThrow(bytes: Uint8Array, start: number, length: number, tag: string): Uint8Array {
  if (start < 0 || length < 0 || start + length > bytes.byteLength) {
    throw new FontFileError(`The ${tag.trim()} table is outside this font file.`);
  }
  return bytes.subarray(start, start + length);
}

// ---------------------------------------------------------------------------
// Containers

type TableMap = Map<string, Uint8Array>;

/** sfnt table directory at `base`, which is 0 for a bare font and the font's own offset in a collection. */
function readSfntTables(bytes: Uint8Array, base: number): TableMap {
  const reader = new Reader(bytes);
  reader.offset = base + 4;
  const numTables = reader.u16('table count');
  reader.offset = base + 12;
  const tables: TableMap = new Map();
  for (let index = 0; index < numTables; index += 1) {
    const tag = reader.tag();
    reader.u32('table directory'); // checksum
    const offset = reader.u32('table directory');
    const length = reader.u32('table directory');
    if (!WANTED_TAGS.includes(tag)) continue;
    tables.set(tag, sliceOrThrow(bytes, offset, length, tag));
  }
  return tables;
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new FontFileError('This browser cannot decompress WOFF tables.');
  }
  // WOFF compresses each table as a complete zlib stream, so 'deflate' (which
  // expects the zlib header) is correct and 'deflate-raw' is not.
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function readWoffTables(bytes: Uint8Array): Promise<TableMap> {
  const reader = new Reader(bytes);
  reader.offset = 12;
  const numTables = reader.u16('table count');
  reader.offset = 44;
  const wanted: { tag: string; offset: number; compLength: number; origLength: number }[] = [];
  for (let index = 0; index < numTables; index += 1) {
    const tag = reader.tag();
    const offset = reader.u32('table directory');
    const compLength = reader.u32('table directory');
    const origLength = reader.u32('table directory');
    reader.u32('table directory'); // checksum
    if (WANTED_TAGS.includes(tag)) wanted.push({ tag, offset, compLength, origLength });
  }

  const tables: TableMap = new Map();
  for (const entry of wanted) {
    const raw = sliceOrThrow(bytes, entry.offset, entry.compLength, entry.tag);
    // Per the WOFF spec a table is stored uncompressed when compressing it
    // would not have helped, and that is signalled by equal lengths.
    tables.set(entry.tag, entry.compLength < entry.origLength ? await inflateZlib(raw) : raw);
  }
  return tables;
}

/**
 * WOFF2 is one Brotli stream holding every table back to back, in directory
 * order, with no padding. The directory gives each table's length in that
 * stream, so the two tables we want are found by adding up the ones before
 * them. `glyf` and `loca` may be transformed; their transformed lengths are
 * simply skipped over, because neither is read here.
 */
async function readWoff2Tables(bytes: Uint8Array): Promise<TableMap> {
  const reader = new Reader(bytes);
  reader.offset = 12;
  const numTables = reader.u16('table count');
  reader.offset = 20;
  const totalCompressedSize = reader.u32('header');
  reader.offset = 48;

  const entries: { tag: string; length: number }[] = [];
  for (let index = 0; index < numTables; index += 1) {
    const flags = reader.u8('table directory');
    const tagIndex = flags & 0x3f;
    const transform = (flags >> 6) & 0x03;
    const tag = tagIndex === 63 ? reader.tag() : (WOFF2_KNOWN_TAGS[tagIndex] ?? '????');
    const origLength = reader.base128();
    // The null transform is version 3 for glyf and loca, version 0 for every
    // other table. A transformed table carries its transformed length too, and
    // that is the length it occupies in the decompressed stream.
    const nullTransform = tag === 'glyf' || tag === 'loca' ? 3 : 0;
    const transformed = transform !== nullTransform;
    const length = transformed ? reader.base128() : origLength;
    entries.push({ tag, length });
  }

  const compressed = sliceOrThrow(bytes, reader.offset, totalCompressedSize, 'compressed');
  const decodedSize = entries.reduce((total, entry) => total + entry.length, 0);
  const decoded = await brotliDecompress(compressed, decodedSize);

  const tables: TableMap = new Map();
  let cursor = 0;
  for (const entry of entries) {
    if (WANTED_TAGS.includes(entry.tag)) {
      tables.set(entry.tag, sliceOrThrow(decoded, cursor, entry.length, entry.tag));
    }
    cursor += entry.length;
  }
  return tables;
}

async function brotliDecompress(input: Uint8Array, outputSize: number): Promise<Uint8Array> {
  let decoded: Uint8Array | null | undefined;
  try {
    // Dynamic so the decoder is only pulled into the bundle that parses files.
    const module = await import('brotli/decompress');
    const decompress = (module as unknown as { default?: typeof module.default }).default ?? module;
    decoded = (decompress as unknown as (a: Uint8Array, b?: number) => Uint8Array)(
      input,
      outputSize,
    );
  } catch (error) {
    throw new FontFileError(
      `This WOFF2 file could not be decompressed (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!decoded || decoded.byteLength === 0) {
    throw new FontFileError('This WOFF2 file could not be decompressed.');
  }
  return decoded;
}

// ---------------------------------------------------------------------------
// name table

interface NameEntry {
  platformID: number;
  encodingID: number;
  languageID: number;
  nameID: number;
  value: string;
}

/**
 * MacRoman bytes 0x80 to 0xFF, 128 characters exactly. Below 0x80 it is ASCII.
 * The dashes at 0xD0 and 0xD1 are written as escapes so this character table
 * is not mistaken for prose punctuation by a search over the source.
 */
const MAC_ROMAN_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü' +
  '†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø' +
  '¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ\u2013\u2014“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ' +
  '‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uf8ffÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

function decodeUtf16Be(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index + 1 < bytes.byteLength; index += 2) {
    out += String.fromCharCode(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
  }
  return out;
}

function decodeMacRoman(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte < 0x80 ? String.fromCharCode(byte) : (MAC_ROMAN_HIGH[byte - 0x80] ?? '?');
  }
  return out;
}

export function parseNameTable(table: Uint8Array): NameEntry[] {
  const reader = new Reader(table);
  reader.u16('name table'); // version
  const count = reader.u16('name table');
  const storageOffset = reader.u16('name table');

  const entries: NameEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const platformID = reader.u16('name record');
    const encodingID = reader.u16('name record');
    const languageID = reader.u16('name record');
    const nameID = reader.u16('name record');
    const length = reader.u16('name record');
    const stringOffset = reader.u16('name record');
    const start = storageOffset + stringOffset;
    if (start + length > table.byteLength) continue; // Tolerate one bad record.
    const raw = table.subarray(start, start + length);
    // Platform 3 (Windows) and platform 0 (Unicode) are UTF-16BE. Platform 1
    // (Mac) with encoding 0 is MacRoman; other Mac encodings are rare enough
    // that reading them as MacRoman is better than dropping the record.
    const value =
      platformID === 3 || platformID === 0 ? decodeUtf16Be(raw) : decodeMacRoman(raw);
    entries.push({ platformID, encodingID, languageID, nameID, value: value.trim() });
  }
  return entries;
}

/**
 * The best record for one name id. Windows English (3, 1, 0x409) is the record
 * every foundry fills in; Mac English (1, *, 0) is the fallback; anything else
 * is better than nothing.
 */
export function pickName(entries: NameEntry[], nameID: number): string | null {
  const candidates = entries.filter((entry) => entry.nameID === nameID && entry.value !== '');
  if (candidates.length === 0) return null;
  const rank = (entry: NameEntry): number => {
    if (entry.platformID === 3 && entry.encodingID === 1 && entry.languageID === 0x0409) return 0;
    if (entry.platformID === 3 && entry.languageID === 0x0409) return 1;
    if (entry.platformID === 3) return 2;
    if (entry.platformID === 1 && entry.languageID === 0) return 3;
    if (entry.platformID === 0) return 4;
    return 5;
  };
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0]?.value ?? null;
}

// ---------------------------------------------------------------------------
// fvar table

export function parseFvar(table: Uint8Array, entries: NameEntry[]): FontIdentity['axes'] {
  const reader = new Reader(table);
  reader.u16('fvar table'); // majorVersion
  reader.u16('fvar table'); // minorVersion
  const axesArrayOffset = reader.u16('fvar table');
  reader.u16('fvar table'); // reserved
  const axisCount = reader.u16('fvar table');
  const axisSize = reader.u16('fvar table');

  const axes: FontIdentity['axes'] = [];
  for (let index = 0; index < axisCount; index += 1) {
    const start = axesArrayOffset + index * axisSize;
    if (start + 20 > table.byteLength) break;
    reader.offset = start;
    const tag = reader.tag('fvar axis');
    const min = reader.fixed();
    const value = reader.fixed();
    const max = reader.fixed();
    reader.u16('fvar axis'); // flags
    const axisNameID = reader.u16('fvar axis');
    axes.push({ tag: tag.trim(), name: pickName(entries, axisNameID), min, max, default: value });
  }
  return axes;
}

// ---------------------------------------------------------------------------
// Entry point

/** "Version 1.004; ttfautohint ..." reads better as "1.004". */
export function cleanVersion(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.replace(/^\s*version\s+/i, '').trim();
  return trimmed === '' ? null : trimmed;
}

function truncate(value: string | null, limit: number): string | null {
  if (value === null) return null;
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Reads the identity out of one font file. Async because two of the four
 * containers have to be decompressed first.
 */
export async function parseFontIdentity(bytes: ArrayBuffer, url: string): Promise<FontIdentity> {
  if (bytes.byteLength === 0) throw new FontFileError('That font file was empty.');
  if (bytes.byteLength > MAX_FONT_BYTES) {
    throw new FontFileError('That font file is larger than 20 MB, so it was not read.');
  }
  const all = new Uint8Array(bytes);
  if (all.byteLength < 12) throw new FontFileError('Not a font file.');

  const signature = new DataView(all.buffer, all.byteOffset, all.byteLength).getUint32(0);
  let tables: TableMap;
  let container: FontIdentity['container'];

  switch (signature) {
    case SIG_WOFF2:
      container = 'woff2';
      tables = await readWoff2Tables(all);
      break;
    case SIG_WOFF:
      container = 'woff';
      tables = await readWoffTables(all);
      break;
    case SIG_TTCF: {
      container = 'ttc';
      const reader = new Reader(all);
      reader.offset = 8;
      const numFonts = reader.u32('collection header');
      if (numFonts < 1) throw new FontFileError('This font collection holds no fonts.');
      const first = reader.u32('collection header');
      tables = readSfntTables(all, first);
      break;
    }
    case SIG_SFNT:
    case SIG_TRUE:
    case SIG_OTTO:
    case SIG_TYP1:
      container = 'sfnt';
      tables = readSfntTables(all, 0);
      break;
    default:
      throw new FontFileError('Not a font file.');
  }

  const nameTable = tables.get('name');
  if (!nameTable) {
    throw new FontFileError('This font file carries no name table, so it cannot be identified.');
  }
  const entries = parseNameTable(nameTable);

  // Typographic family and subfamily (16 and 17) are the real names of a
  // family with more than four styles; 1 and 2 are the legacy four-style
  // names, which split large families into "Inter Display SemiBold" groups.
  const family = pickName(entries, 16) ?? pickName(entries, 1);
  if (family === null) {
    throw new FontFileError('This font file names no family, so it cannot be identified.');
  }

  const fvarTable = tables.get('fvar');

  return {
    family,
    subfamily: pickName(entries, 17) ?? pickName(entries, 2),
    fullName: pickName(entries, 4),
    postscriptName: pickName(entries, 6),
    designer: pickName(entries, 9),
    manufacturer: pickName(entries, 8),
    version: cleanVersion(pickName(entries, 5)),
    license: truncate(pickName(entries, 13), MAX_LICENSE_CHARS),
    licenseUrl: pickName(entries, 14),
    axes: fvarTable ? parseFvar(fvarTable, entries) : [],
    container,
    fileSize: bytes.byteLength,
    evidence: 'name-table',
    url,
  };
}
