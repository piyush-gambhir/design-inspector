import { mkdirSync } from 'node:fs';
import path from 'node:path';











const ROOT = path.resolve(import.meta.dirname, '..', '..');


export const ARTIFACT_DIR =
  process.env.CLAUDE_SCRATCH ?? path.join(ROOT, 'test-results', 'screens');

let ready = false;


export function artifactPath(name: string): string {
  if (!ready) {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    ready = true;
  }
  return path.join(ARTIFACT_DIR, name);
}
