


















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



const argv = process.argv.slice(2);


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



const anchor = changelog.indexOf('\n## ');
const updatedChangelog =
  anchor === -1
    ? `${changelog.trimEnd()}\n\n${entry}`
    : `${changelog.slice(0, anchor + 1)}${entry}\n${changelog.slice(anchor + 1)}`;



console.log(`\x1b[1mRelease ${current} -> ${next}\x1b[0m (${level})\n`);
console.log(entry);

if (dryRun) {
  say('--dry-run: package.json and CHANGELOG.md were not written, and nothing was built.');
  say(`Would run: ${skipCheck ? '(check skipped) ' : 'pnpm check, then '}pnpm zip`);
  process.exit(0);
}




const bumped = packageRaw.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`);
if (bumped === packageRaw) die('Could not find the "version" field in package.json.');
writeFileSync(packagePath, bumped);
writeFileSync(changelogPath, updatedChangelog);
say(`  package.json version -> ${next}`);
say(`  CHANGELOG.md entry written`);



try {
  if (skipCheck) say('Skipping pnpm check (--skip-check). The package is still built.');
  else run('pnpm', ['check']);
  run('pnpm', ['zip']);
} catch (error) {

  writeFileSync(packagePath, packageRaw);
  writeFileSync(changelogPath, changelog);
  die(
    `Release aborted and package.json and CHANGELOG.md were restored.\n${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}



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
console.log(`  2. Push a v${next} tag: the publish workflow submits it to the Chrome Web Store.`);
console.log('     The first release was uploaded by hand; see store/LISTING.md.');
