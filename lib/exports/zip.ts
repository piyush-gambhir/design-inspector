// Dependency-free ZIP writer (PRD AST-05, EXP-03).
//
// Ported from Recast's lib/zip.js (MIT, same author) and cut down to what this
// extension needs: browser only (Uint8Array and Blob, no Node APIs), STORE for
// every entry so no CompressionStream is required, and no ZIP64 because the
// documented caps below keep every archive inside the ZIP32 limits.
//
// Two promises this file keeps:
// - Entries land in insertion order, so the same input always produces the same
//   bytes for a given timestamp.
// - A path that could escape the extraction directory is rejected rather than
//   sanitized, because silently renaming a file would make the manifest lie.

const MIB = 1024 * 1024;

/** PRD AST-05 documented memory limit for one archive. */
export const ZIP_MAX_ARCHIVE_BYTES = 512 * MIB;
/** PRD AST-05 documented per-file limit. */
export const ZIP_MAX_ENTRY_BYTES = 128 * MIB;

/** Thrown for a rejected path, a duplicate, or a size cap. */
export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), the checksum every ZIP entry header carries. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time fields, the only timestamp a ZIP32 header carries. */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  // Before 1980 there is nothing representable, so clamp instead of wrapping
  // into a nonsense date.
  const dosYear = Math.max(0, Math.min(127, year - 1980));
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: (dosYear << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface Entry {
  /** UTF-8 encoded path. */
  name: Uint8Array;
  payload: Uint8Array;
  crc: number;
  size: number;
  time: number;
  date: number;
  offset: number;
}

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;
/** STORE. No compression, so the payload is written verbatim. */
const METHOD_STORE = 0;
/** General purpose bit 11: the path and comment are UTF-8. */
const FLAG_UTF8 = 0x0800;
/** 2.0, the lowest version that understands everything written here. */
const VERSION = 20;

export interface ZipWriterOptions {
  /** Lower than ZIP_MAX_ARCHIVE_BYTES only. Tests use this; callers rarely do. */
  maxArchiveBytes?: number;
  /** Lower than ZIP_MAX_ENTRY_BYTES only. */
  maxEntryBytes?: number;
}

export interface ZipAddOptions {
  /** Timestamp written into the entry headers. Defaults to now. */
  mtime?: Date;
}

export class ZipWriter {
  private readonly entries: Entry[] = [];
  private readonly paths = new Set<string>();
  private readonly encoder = new TextEncoder();
  private readonly maxArchiveBytes: number;
  private readonly maxEntryBytes: number;
  private finished = false;
  /** Running total of local headers plus payloads. */
  private payloadBytes = 0;
  /** Running total of central directory headers. */
  private centralBytes = 0;

  constructor(options: ZipWriterOptions = {}) {
    this.maxArchiveBytes = cap(options.maxArchiveBytes, ZIP_MAX_ARCHIVE_BYTES);
    this.maxEntryBytes = cap(options.maxEntryBytes, ZIP_MAX_ENTRY_BYTES);
  }

  /** Bytes the finished archive would occupy right now. */
  get byteLength(): number {
    return this.payloadBytes + this.centralBytes + END_RECORD_BYTES;
  }

  get count(): number {
    return this.entries.length;
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  add(path: string, data: Uint8Array | string, options: ZipAddOptions = {}): void {
    if (this.finished) throw new ZipError('This archive is already finished.');
    assertPath(path);
    if (this.paths.has(path)) {
      throw new ZipError(`The archive already has a file at "${path}".`);
    }

    const payload = typeof data === 'string' ? this.encoder.encode(data) : copyOf(data);
    if (payload.byteLength > this.maxEntryBytes) {
      throw new ZipError(
        `"${path}" is ${formatBytes(payload.byteLength)}, over the ${formatBytes(this.maxEntryBytes)} limit for one file.`,
      );
    }

    const name = this.encoder.encode(path);
    if (name.byteLength > 0xffff) {
      throw new ZipError(`The path for "${path.slice(0, 60)}" is longer than 65535 bytes.`);
    }

    const nextPayloadBytes = this.payloadBytes + LOCAL_HEADER_BYTES + name.byteLength + payload.byteLength;
    const nextCentralBytes = this.centralBytes + CENTRAL_HEADER_BYTES + name.byteLength;
    const projected = nextPayloadBytes + nextCentralBytes + END_RECORD_BYTES;
    if (projected > this.maxArchiveBytes) {
      throw new ZipError(
        `Adding "${path}" would take the archive past the ${formatBytes(this.maxArchiveBytes)} limit.`,
      );
    }

    const stamp = dosDateTime(options.mtime ?? new Date());
    this.entries.push({
      name,
      payload,
      crc: crc32(payload),
      size: payload.byteLength,
      time: stamp.time,
      date: stamp.date,
      offset: this.payloadBytes,
    });
    this.paths.add(path);
    this.payloadBytes = nextPayloadBytes;
    this.centralBytes = nextCentralBytes;
  }

  /** The finished archive. Calling this twice throws: the writer is spent. */
  finish(): Blob {
    if (this.finished) throw new ZipError('This archive is already finished.');
    this.finished = true;

    const parts: BlobPart[] = [];
    for (const entry of this.entries) {
      parts.push(localHeader(entry) as unknown as BlobPart);
      parts.push(entry.payload as unknown as BlobPart);
    }
    for (const entry of this.entries) {
      parts.push(centralHeader(entry) as unknown as BlobPart);
    }
    parts.push(endRecord(this.entries.length, this.centralBytes, this.payloadBytes) as unknown as BlobPart);
    return new Blob(parts, { type: 'application/zip' });
  }
}

// ---------------------------------------------------------------------------

function localHeader(entry: Entry): Uint8Array {
  const buffer = new Uint8Array(LOCAL_HEADER_BYTES + entry.name.byteLength);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, FLAG_UTF8, true);
  view.setUint16(8, METHOD_STORE, true);
  view.setUint16(10, entry.time, true);
  view.setUint16(12, entry.date, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.size, true);
  view.setUint32(22, entry.size, true);
  view.setUint16(26, entry.name.byteLength, true);
  view.setUint16(28, 0, true);
  buffer.set(entry.name, LOCAL_HEADER_BYTES);
  return buffer;
}

function centralHeader(entry: Entry): Uint8Array {
  const buffer = new Uint8Array(CENTRAL_HEADER_BYTES + entry.name.byteLength);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, VERSION, true);
  view.setUint16(8, FLAG_UTF8, true);
  view.setUint16(10, METHOD_STORE, true);
  view.setUint16(12, entry.time, true);
  view.setUint16(14, entry.date, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.name.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.offset, true);
  buffer.set(entry.name, CENTRAL_HEADER_BYTES);
  return buffer;
}

function endRecord(count: number, centralSize: number, centralOffset: number): Uint8Array {
  const buffer = new Uint8Array(END_RECORD_BYTES);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return buffer;
}

function assertPath(path: string): void {
  if (typeof path !== 'string' || path === '') {
    throw new ZipError('A file in the archive needs a path.');
  }
  if (path.startsWith('/')) {
    throw new ZipError(`"${path}" starts with a slash; archive paths must be relative.`);
  }
  if (path.includes('\\')) {
    throw new ZipError(`"${path}" uses a backslash; archive paths use forward slashes.`);
  }
  if (path.includes('\0')) {
    throw new ZipError('An archive path cannot contain a null character.');
  }
  if (path.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    throw new ZipError(`"${path}" is not a plain relative path.`);
  }
}

/**
 * A view into a larger buffer would put the neighbouring bytes into the
 * archive, so anything that is not a whole, exact buffer is copied.
 */
function copyOf(data: Uint8Array): Uint8Array {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data;
  return data.slice();
}

function cap(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isFinite(value) || value <= 0) return maximum;
  return Math.min(Math.floor(value), maximum);
}

function formatBytes(bytes: number): string {
  if (bytes >= MIB && bytes % MIB === 0) return `${bytes / MIB} MiB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MiB`;
  return `${bytes} bytes`;
}
