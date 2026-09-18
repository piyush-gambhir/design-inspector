import { describe, expect, it } from 'vitest';

import type { SavedReference } from '@/lib/contracts';
import { buildReferenceBundle } from '@/lib/exports/bundle';
import { cardSnapshot, elementReference, headingSnapshot } from './fixtures/snapshots';
import { summaryReference } from './fixtures/summary';

/**
 * Reads an archive through its central directory, the same way an unzip tool
 * does, so these tests check the bundle as a consumer would see it.
 */
async function readZip(blob: Blob): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('No end of central directory record');

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    const localName = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localName + localExtra;
    files.set(name, decoder.decode(bytes.slice(start, start + size)));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const OPTIONS = { extensionVersion: '0.1.0' };

function pngBlob(): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
}

describe('buildReferenceBundle', () => {
  it('writes the envelope, the Markdown and a manifest, and names the file by date', async () => {
    const bundle = await buildReferenceBundle([elementReference(headingSnapshot)], OPTIONS);

    expect(bundle.filename).toMatch(/^design-inspector-bundle-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(bundle.manifest.written).toEqual(['references.json', 'references.md', 'manifest.json']);
    expect(bundle.manifest.skipped).toEqual([]);

    const files = await readZip(bundle.blob);
    expect([...files.keys()]).toEqual(['references.json', 'references.md', 'manifest.json']);

    const envelope = JSON.parse(files.get('references.json') as string);
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.extensionVersion).toBe('0.1.0');
    expect(envelope.references).toHaveLength(1);

    const manifest = JSON.parse(files.get('manifest.json') as string);
    expect(manifest.extensionVersion).toBe('0.1.0');
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.written).toContain('manifest.json');
    expect(manifest.skipped).toEqual([]);
  });

  it('separates each reference in references.md with a horizontal rule', async () => {
    const references = [
      elementReference(headingSnapshot),
      elementReference(cardSnapshot, { id: 'ref-card', title: 'Glass card' }),
      summaryReference(),
    ];
    const bundle = await buildReferenceBundle(references, OPTIONS);
    const markdown = (await readZip(bundle.blob)).get('references.md') as string;

    expect(markdown.split('\n\n---\n\n')).toHaveLength(3);
    expect(markdown).toContain('# Reference: Hero typography');
    expect(markdown).toContain('# Reference: Glass card');
  });

  it('omits ledger.md unless it is asked for', async () => {
    const references = [elementReference(headingSnapshot)];
    const without = await readZip((await buildReferenceBundle(references, OPTIONS)).blob);
    expect(without.has('ledger.md')).toBe(false);

    const withLedger = await readZip(
      (await buildReferenceBundle(references, { ...OPTIONS, includeLedger: true })).blob,
    );
    expect(withLedger.get('ledger.md')).toContain('### Essence (mine)');
  });

  it('links a screenshot only when that file travels in the bundle', async () => {
    const reference = elementReference(headingSnapshot, {
      id: 'ref-with-shot',
      screenshotId: 'shot-1',
      screenshotIsCrop: true,
    });
    const screenshots = new Map([['ref-with-shot', pngBlob()]]);
    const bundle = await buildReferenceBundle([reference], { ...OPTIONS, screenshots });

    expect(bundle.manifest.written).toContain('screenshots/ref-with-shot.png');
    const files = await readZip(bundle.blob);
    expect(files.has('screenshots/ref-with-shot.png')).toBe(true);
    const markdown = files.get('references.md') as string;
    expect(markdown).toContain('![Hero typography](screenshots/ref-with-shot.png)');
    expect(markdown).toContain('visible crop');
  });

  it('records a missing screenshot as skipped and writes no link for it', async () => {
    const reference = elementReference(headingSnapshot, {
      id: 'ref-missing-shot',
      screenshotId: 'shot-2',
    });
    const bundle = await buildReferenceBundle([reference], OPTIONS);

    expect(bundle.manifest.skipped).toEqual([
      {
        path: 'screenshots/ref-missing-shot.png',
        reason: 'The screenshot for this reference was not loaded.',
      },
    ]);
    const markdown = (await readZip(bundle.blob)).get('references.md') as string;
    expect(markdown).not.toContain('screenshots/');
    // A failed screenshot must not cost the reference itself.
    expect(markdown).toContain('# Reference: Hero typography');
  });

  it('skips a broken reference with a reason instead of losing the batch', async () => {
    const broken = { id: 'ref-broken', kind: 'element' } as unknown as SavedReference;
    const bundle = await buildReferenceBundle(
      [broken, elementReference(headingSnapshot)],
      OPTIONS,
    );

    expect(bundle.manifest.skipped).toEqual([
      { path: 'ref-broken', reason: 'The reference has no snapshot.' },
    ]);
    const files = await readZip(bundle.blob);
    expect(files.get('references.md')).toContain('# Reference: Hero typography');
    expect(JSON.parse(files.get('references.json') as string).references).toHaveLength(1);
  });

  it('produces an archive even when every reference is unusable', async () => {
    const bundle = await buildReferenceBundle([null as unknown as SavedReference], OPTIONS);
    expect(bundle.manifest.skipped.map((entry) => entry.reason)).toEqual([
      'The reference is not an object.',
      'No reference produced Markdown.',
    ]);
    const files = await readZip(bundle.blob);
    expect(files.has('references.md')).toBe(false);
    expect(files.has('manifest.json')).toBe(true);
  });

  it('keeps a page-supplied id from becoming a path of its own', async () => {
    const reference = elementReference(headingSnapshot, { id: '../../etc/passwd' });
    const screenshots = new Map([['../../etc/passwd', pngBlob()]]);
    const bundle = await buildReferenceBundle([reference], { ...OPTIONS, screenshots });
    const files = await readZip(bundle.blob);
    expect([...files.keys()]).toContain('screenshots/etc-passwd.png');
  });
});
