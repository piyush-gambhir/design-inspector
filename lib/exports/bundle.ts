











import type { SavedReference } from '@/lib/contracts';
import { toJsonEnvelope } from './json';
import { referenceToMarkdown } from './markdown';
import { toTasteLedger } from './taste-ledger';
import { ZIP_MAX_ENTRY_BYTES, ZipWriter } from './zip';

export interface BundleOptions {

  screenshots?: Map<string, Blob>;
  extensionVersion: string;

  includeLedger?: boolean;
}

export interface BundleResult {
  blob: Blob;

  filename: string;

  manifest: { written: string[]; skipped: { path: string; reason: string }[] };
}


interface BundleManifest {
  written: string[];
  skipped: { path: string; reason: string }[];
  generatedAt: string;
  extensionVersion: string;
}

const SEPARATOR = '\n\n---\n\n';

export async function buildReferenceBundle(
  references: SavedReference[],
  options: BundleOptions,
): Promise<BundleResult> {
  const generatedAt = new Date().toISOString();
  const mtime = new Date(generatedAt);
  const zip = new ZipWriter();
  const written: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  const usable: SavedReference[] = [];
  references.forEach((reference, index) => {
    const problem = unusableReason(reference);
    if (problem === null) usable.push(reference);
    else skipped.push({ path: pathFor(reference, index), reason: problem });
  });


  const screenshotPaths = new Map<string, string>();
  for (const reference of usable) {
    const blob = options.screenshots?.get(reference.id);
    const path = `screenshots/${safeSegment(reference.id)}.png`;
    if (!blob) {
      if (reference.screenshotId !== null) {
        skipped.push({ path, reason: 'The screenshot for this reference was not loaded.' });
      }
      continue;
    }
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength > ZIP_MAX_ENTRY_BYTES) {
        skipped.push({ path, reason: 'The screenshot is larger than the per-file limit.' });
        continue;
      }
      zip.add(path, bytes, { mtime });
      screenshotPaths.set(reference.id, path);
      written.push(path);
    } catch (error) {
      skipped.push({ path, reason: reasonOf(error) });
    }
  }

  try {
    const envelope = toJsonEnvelope(usable, options.extensionVersion);
    zip.add('references.json', `${JSON.stringify(envelope, null, 2)}\n`, { mtime });
    written.push('references.json');
  } catch (error) {
    skipped.push({ path: 'references.json', reason: reasonOf(error) });
  }

  const documents: string[] = [];
  usable.forEach((reference, index) => {
    try {
      documents.push(markdownFor(reference, screenshotPaths.get(reference.id) ?? null));
    } catch (error) {
      skipped.push({ path: `references.md#${pathFor(reference, index)}`, reason: reasonOf(error) });
    }
  });
  if (documents.length > 0) {
    try {
      zip.add('references.md', documents.join(SEPARATOR), { mtime });
      written.push('references.md');
    } catch (error) {
      skipped.push({ path: 'references.md', reason: reasonOf(error) });
    }
  } else {
    skipped.push({ path: 'references.md', reason: 'No reference produced Markdown.' });
  }

  if (options.includeLedger) {
    try {
      const ledger = toTasteLedger(usable, generatedAt);
      if (ledger.trim() === '') {
        skipped.push({ path: 'ledger.md', reason: 'No reference produced a ledger entry.' });
      } else {
        zip.add('ledger.md', `${ledger}\n`, { mtime });
        written.push('ledger.md');
      }
    } catch (error) {
      skipped.push({ path: 'ledger.md', reason: reasonOf(error) });
    }
  }

  const manifest: BundleManifest = {
    written: [...written, 'manifest.json'],
    skipped,
    generatedAt,
    extensionVersion: options.extensionVersion,
  };
  try {
    zip.add('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, { mtime });
    written.push('manifest.json');
  } catch (error) {


    skipped.push({ path: 'manifest.json', reason: reasonOf(error) });
  }

  return {
    blob: zip.finish(),
    filename: `design-inspector-bundle-${generatedAt.slice(0, 10)}.zip`,
    manifest: { written, skipped },
  };
}








function markdownFor(reference: SavedReference, screenshotPath: string | null): string {
  const base = referenceToMarkdown(reference);
  const rewritten = rewriteScreenshotLinks(base, reference, screenshotPath);
  if (screenshotPath === null) return rewritten;
  if (rewritten.includes(screenshotPath)) return rewritten;
  const alt = reference.title.trim() === '' ? 'Saved screenshot' : reference.title.trim();
  const crop =
    reference.screenshotIsCrop === true
      ? '\nThe screenshot is a visible crop of a larger element.\n'
      : '';
  return `${rewritten}\n## Screenshot\n\n![${escapeAlt(alt)}](${screenshotPath})\n${crop}`;
}






function rewriteScreenshotLinks(
  markdown: string,
  reference: SavedReference,
  screenshotPath: string | null,
): string {
  const id = reference.screenshotId;
  if (id === null || id === '') return markdown;
  const pattern = new RegExp(`!?\\[([^\\]]*)\\]\\([^)\\s]*${escapeRegExp(id)}[^)\\s]*\\)`, 'g');
  return markdown.replace(pattern, (match, label: string) => {
    if (screenshotPath === null) return label;
    return match.startsWith('!') ? `![${label}](${screenshotPath})` : `[${label}](${screenshotPath})`;
  });
}


function unusableReason(reference: unknown): string | null {
  if (typeof reference !== 'object' || reference === null) {
    return 'The reference is not an object.';
  }
  const record = reference as Partial<SavedReference>;
  if (typeof record.id !== 'string' || record.id === '') {
    return 'The reference has no id.';
  }
  const snapshot = record.snapshot as { source?: { url?: unknown } } | undefined;
  if (typeof snapshot !== 'object' || snapshot === null) {
    return 'The reference has no snapshot.';
  }
  if (typeof snapshot.source?.url !== 'string') {
    return 'The reference snapshot has no source URL.';
  }
  return null;
}

function pathFor(reference: SavedReference | unknown, index: number): string {
  const id = (reference as Partial<SavedReference> | null)?.id;
  return typeof id === 'string' && id !== '' ? id : `references[${index}]`;
}


function safeSegment(id: string): string {
  const cleaned = id
    .replace(/[^A-Za-z0-9._-]/g, '-')

    .replace(/\.{2,}/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned === '' ? 'screenshot' : cleaned;
}

function escapeAlt(value: string): string {
  return value.replace(/[[\]]/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The file could not be written.';
}
