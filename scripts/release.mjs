// Cut a release package: bump the version, write the changelog entry, run the
// gate, build the store ZIP.
//
// This script performs no git operations. It does not commit, tag, push, or
// read the branch. Deciding what is in a release is a person's job, and a tool
// that tags on your behalf makes that decision quietly. Commit the bump and the
// changelog yourself afterwards.
//
// Usage:
//   pnpm release --patch --notes "Fix the asset filter counts"
//   pnpm release --minor --notes "Mockup overlay; compare two summaries"
//   pnpm release --major --notes "..."
//   pnpm release --patch --notes "..." --dry-run    print the plan, change nothing
//   pnpm release --patch --notes "..." --skip-check skip pnpm check, still zips
//
// --notes accepts one or more sentences, or a `;`-separated list which becomes
// one bullet per item. The manifest version comes from package.json, so that
// file is the single source of truth for the shipped version.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '../..');
const packagePath = path.join(root, 'package.json');
const changelogPath = path.join(root, 'CHANGELOG.md');
const outputDir = path.join(root, '.output');

const die = message => {
  console.error(`\x1b[31m${message}\x1b[0m`);
  process.exit(1);
};
const say = message => console.log(`\x1b[2m${message}\x1b[0m`);
const run = (command, args) => {
  say(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
};

// --- Arguments --------------------------------------------------------------

const argv = process.argv.slice(2);

/** `--notes "text"` or `--notes=text`. */
function readOption(name) {
  const inline = argv.find(arg => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

const levels = ['patch', 'minor', 'major'].filter(level => argv.includes(`--${level}`));
const dryRun = argv.includes('--dry-run');
const skipCheck = argv.includes('--skip-check');
const notes = readOption('notes');

const usage =
  'Usage: pnpm release --patch|--minor|--major --notes "what changed" [--dry-run] [--skip-check]';

if (levels.length !== 1) die(`Pick exactly one of --patch, --minor, --major.\n${usage}`);
if (!notes || !notes.trim()) die(`--notes is required: a release with no notes is a mystery.\n${usage}`);
const level = levels[0];

// --- Next version -----------------------------------------------------------

const packageRaw = readFileSync(packagePath, 'utf8');
const current = JSON.parse(packageRaw).version;
const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(current ?? '');
if (!parsed) die(`package.json version "${current}" is not plain X.Y.Z semver.`);
const [major, minor, patch] = parsed.slice(1).map(Number);

const next =
  level === 'major'
    ? `${major + 1}.0.0`
    : level === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

// --- Changelog entry --------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
const bullets = notes
  .split(';')
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => `- ${line.replace(/\.$/, '')}.`);

const entry = `## ${next} (${today})\n\n${bullets.join('\n')}\n`;

if (!existsSync(changelogPath)) die('CHANGELOG.md is missing; create it before releasing.');
const changelog = readFileSync(changelogPath, 'utf8');
if (changelog.includes(`## ${next} `)) die(`CHANGELOG.md already has a ${next} section.`);

// The new section goes directly under the file's heading and its preamble, so
// the newest release is always the first section a reader meets.
const anchor = changelog.indexOf('\n## ');
const updatedChangelog =
  anchor === -1
    ? `${changelog.trimEnd()}\n\n${entry}`
    : `${changelog.slice(0, anchor + 1)}${entry}\n${changelog.slice(anchor + 1)}`;

// --- Plan -------------------------------------------------------------------

console.log(`\x1b[1mRelease ${current} -> ${next}\x1b[0m (${level})\n`);
console.log(entry);

if (dryRun) {
  say('--dry-run: package.json and CHANGELOG.md were not written, and nothing was built.');
  say(`Would run: ${skipCheck ? '(check skipped) ' : 'pnpm check, then '}pnpm zip`);
  process.exit(0);
}

// --- Write ------------------------------------------------------------------

// A targeted replace keeps package.json's formatting exactly as it was.
const bumped = packageRaw.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`);
if (bumped === packageRaw) die('Could not find the "version" field in package.json.');
writeFileSync(packagePath, bumped);
writeFileSync(changelogPath, updatedChangelog);
say(`  package.json version -> ${next}`);
say(`  CHANGELOG.md entry written`);

// --- Gate and package -------------------------------------------------------

try {
  if (skipCheck) say('Skipping pnpm check (--skip-check). The package is still built.');
  else run('pnpm', ['check']);
  run('pnpm', ['zip']);
} catch (error) {
  // Put the version back: a failed gate must not leave a half-released tree.
  writeFileSync(packagePath, packageRaw);
  writeFileSync(changelogPath, changelog);
  die(
    `Release aborted and package.json and CHANGELOG.md were restored.\n${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

// --- Report -----------------------------------------------------------------

const zips = existsSync(outputDir)
  ? readdirSync(outputDir)
      .filter(name => name.endsWith('.zip') && name.includes(next))
      .map(name => ({ name, size: statSync(path.join(outputDir, name)).size }))
  : [];

if (zips.length === 0) die(`No ${next} zip was produced in .output/. Check the pnpm zip output.`);

console.log(`\n\x1b[32mPackaged ${next}.\x1b[0m`);
for (const zip of zips) {
  console.log(`  .output/${zip.name}  ${(zip.size / 1024).toFixed(0)} KB`);
}
console.log('\nNext, by hand:');
console.log('  1. Review the diff, then commit package.json and CHANGELOG.md.');
console.log('  2. Upload the zip and follow store/LISTING.md.');
