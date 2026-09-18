// Export adapters (PRD section 15). The implementations live next to this file,
// one module per output format; this index is the only import surface the rest
// of the extension uses.
export type { StyleCategory } from './css';
export { toCss } from './css';
export type { TailwindOutput } from './tailwind';
export { toTailwind } from './tailwind';
export { toJsonEnvelope, validateEnvelope } from './json';
export { referenceToMarkdown, summaryToMarkdown } from './markdown';
export { toTasteLedger } from './taste-ledger';

export type { TailwindClosestOutput } from './tailwind-closest';
export { toTailwindClosest } from './tailwind-closest';
export { buildReferenceBundle } from './bundle';
export type { BundleOptions, BundleResult } from './bundle';

export { crc32, ZipError, ZipWriter, ZIP_MAX_ARCHIVE_BYTES, ZIP_MAX_ENTRY_BYTES } from './zip';
export { assetFilenames, buildAssetBundle, AssetBundleCancelled, ASSET_BATCH_MAX_BYTES } from './asset-bundle';
export type { AssetBundleManifest, AssetBundleOptions, AssetBundleResult } from './asset-bundle';
