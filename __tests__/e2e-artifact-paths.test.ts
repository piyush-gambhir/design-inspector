import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';






const E2E_DIR = path.resolve(import.meta.dirname, '..', 'e2e');


function specFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...specFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('e2e artifact paths', () => {
  const files = specFiles(E2E_DIR);

  it('finds the browser specs at all', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never hard-codes a path that only exists on one machine', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {




        if (/['"`][^'"`]*\/private\/tmp/.test(line)) {
          offenders.push(`${path.relative(E2E_DIR, file)}:${index + 1}: ${line.trim()}`);
        }
        if (/(path|outputDir|dir):\s*['"`]\/(Users|home|private)\//.test(line)) {
          offenders.push(`${path.relative(E2E_DIR, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, 'use artifactPath() from e2e/helpers/artifacts.ts').toEqual([]);
  });

  it('routes every screenshot through artifactPath', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/screenshot\(\{[^}]*path:\s*([^,}]+)/g)) {
        const target = (match[1] ?? '').trim();
        if (!target.startsWith('artifactPath(')) {
          offenders.push(`${path.relative(E2E_DIR, file)}: ${target}`);
        }
      }
    }
    expect(offenders, 'screenshot paths must come from artifactPath()').toEqual([]);
  });
});
