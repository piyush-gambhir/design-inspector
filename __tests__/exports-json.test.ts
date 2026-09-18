import { describe, expect, it } from 'vitest';
import { toJsonEnvelope, validateEnvelope } from '@/lib/exports';
import { cardSnapshot, elementReference, headingSnapshot } from './fixtures/snapshots';
import { pageSummary, summaryReference } from './fixtures/summary';

const references = [
  elementReference(headingSnapshot),
  elementReference(cardSnapshot, { id: 'ref-card', title: 'Glass card' }),
  summaryReference(),
];

describe('toJsonEnvelope', () => {
  it('stamps the schema version, extension version, and an ISO timestamp', () => {
    const envelope = toJsonEnvelope(references, '0.1.0');
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.extensionVersion).toBe('0.1.0');
    expect(envelope.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('deduplicates sources by url and capture time', () => {
    const envelope = toJsonEnvelope(references, '0.1.0');
    expect(envelope.sources).toHaveLength(1);
    expect(envelope.sources[0]?.url).toBe('https://example.com/');
  });

  it('keeps distinct sources apart', () => {
    const other = elementReference(
      {
        ...headingSnapshot,
        source: { ...headingSnapshot.source, capturedAt: '2026-09-18T12:00:00.000Z' },
      },
      { id: 'ref-later' },
    );
    expect(toJsonEnvelope([references[0]!, other], '0.1.0').sources).toHaveLength(2);
  });

  it('unions snapshot limitations and adds the viewport note once', () => {
    const envelope = toJsonEnvelope(references, '0.1.0');
    expect(envelope.limitations).toEqual([
      'Pseudo-element styles were not read for this element.',
      'Counts are element and property occurrences, not visual area.',
      'Values are computed styles at the recorded viewport and time.',
    ]);
  });

  it('keeps the references untouched', () => {
    expect(toJsonEnvelope(references, '0.1.0').references).toBe(references);
  });
});

describe('validateEnvelope', () => {
  it('accepts an envelope after a JSON round trip', () => {
    const envelope = toJsonEnvelope(references, '0.1.0');
    expect(validateEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual([]);
  });

  it('accepts a summary with or without palette clusters, and only a list when present', () => {
    const withClusters = toJsonEnvelope([summaryReference()], '0.1.0');
    expect(validateEnvelope(JSON.parse(JSON.stringify(withClusters)))).toEqual([]);

    const older = { ...pageSummary };
    delete older.paletteClusters;
    const withoutClusters = toJsonEnvelope([summaryReference({ snapshot: older })], '0.1.0');
    expect(validateEnvelope(JSON.parse(JSON.stringify(withoutClusters)))).toEqual([]);

    const broken = {
      ...toJsonEnvelope([summaryReference()], '0.1.0'),
      references: [
        { ...summaryReference(), snapshot: { ...pageSummary, paletteClusters: 'lots' } },
      ],
    };
    expect(validateEnvelope(broken)).toEqual([
      'references[0].snapshot.paletteClusters must be an array when present.',
    ]);
  });

  it('rejects a value that is not an object', () => {
    expect(validateEnvelope(null)).toEqual(['Export is not an object.']);
    expect(validateEnvelope([])).toEqual(['Export is not an object.']);
    expect(validateEnvelope('{}')).toEqual(['Export is not an object.']);
  });

  it('reports a wrong schema version', () => {
    const envelope = { ...toJsonEnvelope(references, '0.1.0'), schemaVersion: 2 };
    expect(validateEnvelope(envelope)).toContain(
      'Export schemaVersion must be 1, found 2.',
    );
  });

  it('reports missing arrays', () => {
    const errors = validateEnvelope({ schemaVersion: 1, extensionVersion: '0.1.0', exportedAt: 'x' });
    expect(errors).toContain('Export field "sources" must be an array.');
    expect(errors).toContain('Export field "references" must be an array.');
    expect(errors).toContain('Export field "limitations" must be an array.');
  });

  it('reports a reference missing its id, kind, or createdAt', () => {
    const envelope = {
      ...toJsonEnvelope(references, '0.1.0'),
      references: [{ snapshot: headingSnapshot }],
    };
    const errors = validateEnvelope(envelope);
    expect(errors).toContain('references[0] is missing "id".');
    expect(errors).toContain('references[0] is missing "kind" (expected "element" or "summary").');
    expect(errors).toContain('references[0] is missing "createdAt".');
  });

  it('reports a reference missing its snapshot', () => {
    const envelope = {
      ...toJsonEnvelope(references, '0.1.0'),
      references: [{ id: 'a', kind: 'element', createdAt: 'now' }],
    };
    expect(validateEnvelope(envelope)).toEqual(['references[0] is missing "snapshot".']);
  });

  it('reports a snapshot schema mismatch and a missing source url', () => {
    const envelope = {
      ...toJsonEnvelope(references, '0.1.0'),
      references: [
        {
          id: 'a',
          kind: 'element',
          createdAt: 'now',
          snapshot: { schemaVersion: 99, source: { title: 'no url' } },
        },
      ],
    };
    const errors = validateEnvelope(envelope);
    expect(errors).toContain('references[0].snapshot.schemaVersion must be 1, found 99.');
    expect(errors).toContain('references[0].snapshot.source.url is missing.');
  });

  it('names the index of each failing reference', () => {
    const envelope = {
      ...toJsonEnvelope(references, '0.1.0'),
      references: [JSON.parse(JSON.stringify(references[0])), 'not a reference'],
    };
    expect(validateEnvelope(envelope)).toEqual(['references[1] is not an object.']);
  });
});
