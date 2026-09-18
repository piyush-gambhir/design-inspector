// `brotli` (MIT, pure JS) ships no types. Only the decompressor is used at
// runtime, and only from the background worker; `brotli/compress` is used by
// the WOFF2 unit test to build its own fixture.
declare module 'brotli/decompress' {
  /**
   * Decodes one Brotli stream. `outputSize` is the exact decoded length; pass
   * it whenever it is known, because the WOFF2 stream carries no size header
   * of its own and the library otherwise has to guess.
   */
  const decompress: (input: Uint8Array, outputSize?: number) => Uint8Array;
  export default decompress;
}

declare module 'brotli/compress' {
  const compress: (
    input: Uint8Array,
    options?: boolean | { quality?: number; mode?: number; lgwin?: number },
  ) => Uint8Array | null;
  export default compress;
}
