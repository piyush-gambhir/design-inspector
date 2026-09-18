// Versioned JSON export and its validator (PRD EXP-03, EXP-04).
import type { ExportEnvelope, SavedReference, SourceContext } from '@/lib/contracts';
import { SCHEMA_VERSION } from '@/lib/contracts';

const VIEWPORT_NOTE = 'Values are computed styles at the recorded viewport and time.';

export function toJsonEnvelope(
  references: SavedReference[],
  extensionVersion: string,
): ExportEnvelope {
  const sources: SourceContext[] = [];
  const seenSources = new Set<string>();
  const limitations: string[] = [];
  const seenLimitations = new Set<string>();

  for (const reference of references) {
    const source = reference.snapshot.source;
    const key = `${source.url}|${source.capturedAt}`;
    if (!seenSources.has(key)) {
      seenSources.add(key);
      sources.push(source);
    }
    for (const limitation of reference.snapshot.limitations) {
      if (seenLimitations.has(limitation)) continue;
      seenLimitations.add(limitation);
      limitations.push(limitation);
    }
  }

  if (!seenLimitations.has(VIEWPORT_NOTE)) limitations.push(VIEWPORT_NOTE);

  return {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion,
    exportedAt: new Date().toISOString(),
    sources,
    references,
    limitations,
  };
}

/** Validates a parsed JSON value as an ExportEnvelope. Returns errors, empty when valid. */
export function validateEnvelope(value: unknown): string[] {
  const errors: string[] = [];

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['Export is not an object.'];
  }
  const envelope = value as Record<string, unknown>;

  if (envelope.schemaVersion !== SCHEMA_VERSION) {
    errors.push(
      `Export schemaVersion must be ${SCHEMA_VERSION}, found ${describe(envelope.schemaVersion)}.`,
    );
  }
  if (typeof envelope.extensionVersion !== 'string') {
    errors.push('Export is missing "extensionVersion".');
  }
  if (typeof envelope.exportedAt !== 'string') {
    errors.push('Export is missing "exportedAt".');
  }

  for (const field of ['sources', 'references', 'limitations'] as const) {
    if (!Array.isArray(envelope[field])) errors.push(`Export field "${field}" must be an array.`);
  }

  const references = envelope.references;
  if (Array.isArray(references)) {
    references.forEach((reference, index) => {
      errors.push(...validateReference(reference, index));
    });
  }

  return errors;
}

function validateReference(value: unknown, index: number): string[] {
  const label = `references[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`${label} is not an object.`];
  }

  const errors: string[] = [];
  const reference = value as Record<string, unknown>;

  if (typeof reference.id !== 'string' || reference.id === '') {
    errors.push(`${label} is missing "id".`);
  }
  if (reference.kind !== 'element' && reference.kind !== 'summary') {
    errors.push(`${label} is missing "kind" (expected "element" or "summary").`);
  }
  if (typeof reference.createdAt !== 'string' || reference.createdAt === '') {
    errors.push(`${label} is missing "createdAt".`);
  }

  const snapshot = reference.snapshot;
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    errors.push(`${label} is missing "snapshot".`);
    return errors;
  }

  const snapshotRecord = snapshot as Record<string, unknown>;
  if (snapshotRecord.schemaVersion !== SCHEMA_VERSION) {
    errors.push(
      `${label}.snapshot.schemaVersion must be ${SCHEMA_VERSION}, found ${describe(snapshotRecord.schemaVersion)}.`,
    );
  }

  // Palette clusters arrived after the first summaries were written, so a
  // record without them is valid. A record with them must still carry a list.
  const clusters = snapshotRecord.paletteClusters;
  if (clusters !== undefined && !Array.isArray(clusters)) {
    errors.push(`${label}.snapshot.paletteClusters must be an array when present.`);
  }

  const source = snapshotRecord.source;
  const url =
    typeof source === 'object' && source !== null
      ? (source as Record<string, unknown>).url
      : undefined;
  if (typeof url !== 'string' || url === '') {
    errors.push(`${label}.snapshot.source.url is missing.`);
  }

  return errors;
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}
