import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Where a spec writes a screenshot it wants a human to look at.
 *
 * These are review shots, not assertions: nothing compares them, they exist so
 * a design pass has something to open. They used to be written to a scratch
 * directory that only existed on one laptop, which is why every spec that took
 * one failed on Linux with ENOENT while its assertions all passed. The rule now
 * is that the path comes from the environment or from the repo, and the
 * directory is created before anything writes into it.
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The directory review screenshots go to. Created on first use. */
export const ARTIFACT_DIR =
  process.env.CLAUDE_SCRATCH ?? path.join(ROOT, 'test-results', 'screens');

let ready = false;

/** An absolute path under the artifact directory, with the directory in place. */
export function artifactPath(name: string): string {
  if (!ready) {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    ready = true;
  }
  return path.join(ARTIFACT_DIR, name);
}
