#!/usr/bin/env bun

// ============================================================================
// Release Script - Automates version bump, tag, and push
//
// Usage:
//   ./bun run scripts/release.ts <version | major | minor | patch>
//
// Examples:
//   ./bun run scripts/release.ts patch      # 0.1.0 -> 0.1.1
//   ./bun run scripts/release.ts minor      # 0.1.0 -> 0.2.0
//   ./bun run scripts/release.ts 1.0.0      # explicit version
// ============================================================================

import semver from 'semver';

interface PackageJson {
  version?: string;
  [key: string]: unknown;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function run(args: Array<string>): Promise<CommandResult> {
  const proc = Bun.spawn(args, {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    const command = args.join(' ');
    fail(stderr.trim() || `Command failed: ${command}`);
  }

  return { stdout, stderr };
}

function validateVersion(version: string): void {
  if (!semver.valid(version)) {
    fail(`Invalid version '${version}'. Expected semver like 0.7.0.`);
  }
}

const INCREMENT_TYPES = ['major', 'minor', 'patch'] as const;
type IncrementType = (typeof INCREMENT_TYPES)[number];

function isIncrementType(value: string): value is IncrementType {
  return (INCREMENT_TYPES as ReadonlyArray<string>).includes(value);
}

// --- Main ---

const versionArg = process.argv[2];

if (!versionArg) {
  fail('Usage: ./bun run scripts/release.ts <version | major | minor | patch>');
}

// 1. Validate clean working directory
const status = await run(['git', 'status', '--porcelain']);
if (status.stdout.trim().length > 0) {
  fail(
    'Working directory is not clean. Commit, stash, or discard changes before releasing.',
  );
}

// 2. Validate on main branch and up to date
const branchResult = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
const currentBranch = branchResult.stdout.trim();
if (currentBranch !== 'main') {
  fail(
    `Must be on the 'main' branch to release. Currently on '${currentBranch}'.`,
  );
}

await run(['git', 'fetch', 'origin', 'main']);
const behindResult = await run([
  'git',
  'rev-list',
  '--count',
  'main..origin/main',
]);
const behindCount = Number.parseInt(behindResult.stdout.trim(), 10);
if (behindCount > 0) {
  fail(
    `Local 'main' is ${behindCount} commit(s) behind 'origin/main'. Pull before releasing.`,
  );
}

// 3. Read current version from package.json
const packageFile = Bun.file('package.json');
if (!(await packageFile.exists())) {
  fail('package.json not found in current directory.');
}

const packageJson = (await packageFile.json()) as PackageJson;
const currentVersion = packageJson.version;

if (!currentVersion || !semver.valid(currentVersion)) {
  fail(
    `Current version '${currentVersion ?? '(missing)'}' in package.json is not valid semver.`,
  );
}

// 4. Compute and validate next version
const nextVersion = isIncrementType(versionArg)
  ? semver.inc(currentVersion, versionArg)
  : versionArg;

if (!nextVersion) {
  fail(`Failed to compute next version from '${versionArg}'.`);
}

validateVersion(nextVersion);

if (!semver.gt(nextVersion, currentVersion)) {
  fail(
    `Version ${nextVersion} is not greater than current version ${currentVersion}.`,
  );
}

// 5. Check tag doesn't already exist
const tagName = `v${nextVersion}`;
const tagCheck = await run(['git', 'tag', '-l', tagName]);
if (tagCheck.stdout.trim() === tagName) {
  fail(`Tag ${tagName} already exists.`);
}

// 6. Update package.json version
packageJson.version = nextVersion;
await Bun.write('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

// 7. Commit, tag, and push
await run(['git', 'add', 'package.json']);
await run(['git', 'commit', '-m', `release: ${tagName}`]);
await run(['git', 'tag', '-a', tagName, '-m', tagName]);
await run(['git', 'push', '--follow-tags']);

console.log(`Released ${tagName}.`);
