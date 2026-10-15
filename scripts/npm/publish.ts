#!/usr/bin/env bun

// Generates and publishes npm packages for the gitrac CLI binary.
//
// Creates 4 packages:
//   @gitrac/cli              - main package with JS wrapper + optionalDependencies
//   @gitrac/cli-linux-x64    - linux x64 binary
//   @gitrac/cli-linux-arm64  - linux arm64 binary
//   @gitrac/cli-darwin-arm64 - darwin arm64 binary
//
// Usage:
//   ./bun scripts/npm/publish.ts --version 0.2.0 --binaries-dir ./binaries [--dry-run]
//   ./bun scripts/npm/publish.ts --version 0.2.0 --binaries-dir ./binaries --no-publish --work-dir ./out
//
// --dry-run runs `npm publish --dry-run`; --no-publish only generates the
// package directories (in --work-dir, default: a temp dir) without invoking npm.
//
// In CI this authenticates via npm trusted publishing (OIDC); see
// docs/releasing.md for the one-time setup.

import { chmod, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export const SCOPE = '@gitrac';
export const MAIN_PACKAGE = `${SCOPE}/cli`;
const REPOSITORY = {
  type: 'git',
  url: 'git+https://github.com/murrayju/gitrac.git',
};
const HOMEPAGE = 'https://github.com/murrayju/gitrac#readme';
const LICENSE = 'MIT';

// Resolve the project-root `./bun` wrapper to an absolute path so it works
// regardless of the cwd we pass to Bun.spawn when publishing packages.
const PROJECT_ROOT = resolve(dirname(import.meta.dir), '..');
const BUN = join(PROJECT_ROOT, 'bun');

// npm 11.5.1+ is required for OIDC authentication to npm trusted publishers.
// Use `./bun x` to run a recent npm without requiring it to be globally installed.
const NPM_CMD = [BUN, 'x', 'npm@>=11.5.1'];

export interface PlatformTarget {
  os: string;
  cpu: string;
  binaryName: string;
  packageSuffix: string;
}

export const PLATFORMS: PlatformTarget[] = [
  {
    os: 'linux',
    cpu: 'x64',
    binaryName: 'gitrac-linux-x64',
    packageSuffix: 'cli-linux-x64',
  },
  {
    os: 'linux',
    cpu: 'arm64',
    binaryName: 'gitrac-linux-arm64',
    packageSuffix: 'cli-linux-arm64',
  },
  {
    os: 'darwin',
    cpu: 'arm64',
    binaryName: 'gitrac-darwin-arm64',
    packageSuffix: 'cli-darwin-arm64',
  },
];

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/**
 * npm dist-tag for a version: prereleases (`1.2.0-rc.1`) go to `next` so they
 * never become `latest` (npm refuses to publish them without a tag anyway).
 */
export function distTag(version: string): string {
  return version.includes('-') ? 'next' : 'latest';
}

async function npmPublish(
  packageDir: string,
  version: string,
  dryRun: boolean,
): Promise<void> {
  const args = [
    ...NPM_CMD,
    'publish',
    '--access',
    'public',
    '--tag',
    distTag(version),
  ];
  if (dryRun) {
    args.push('--dry-run');
  }

  console.log(
    `  ${dryRun ? '[dry-run] ' : ''}${args.join(' ')} (in ${packageDir})`,
  );
  const proc = Bun.spawn(args, {
    cwd: packageDir,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    fail(`npm publish failed for ${packageDir} (exit code ${exitCode})`);
  }
}

export function makePlatformPackageJson(
  target: PlatformTarget,
  version: string,
): string {
  const pkg = {
    name: `${SCOPE}/${target.packageSuffix}`,
    version,
    description: `gitrac CLI binary for ${target.os}-${target.cpu}`,
    license: LICENSE,
    repository: REPOSITORY,
    homepage: HOMEPAGE,
    os: [target.os],
    cpu: [target.cpu],
    files: ['bin'],
  };
  return JSON.stringify(pkg, null, 2);
}

export function makeMainPackageJson(version: string): string {
  const optionalDependencies: Record<string, string> = {};
  for (const target of PLATFORMS) {
    optionalDependencies[`${SCOPE}/${target.packageSuffix}`] = version;
  }

  const pkg = {
    name: MAIN_PACKAGE,
    version,
    description:
      'Issue tracking that lives in your git repo: markdown issues, a CLI for humans and coding agents, and a local web UI',
    license: LICENSE,
    repository: REPOSITORY,
    homepage: HOMEPAGE,
    keywords: ['issues', 'issue-tracker', 'git', 'markdown', 'cli', 'agents'],
    bin: {
      gitrac: 'bin/gitrac',
    },
    files: ['bin', 'README.md'],
    optionalDependencies,
  };
  return JSON.stringify(pkg, null, 2);
}

/**
 * Write the package directories for every platform package and the main
 * package into `workDir`. Returns their directories, platform packages first
 * (the order they must be published in).
 */
export async function generatePackages(options: {
  version: string;
  binariesDir: string;
  workDir: string;
}): Promise<string[]> {
  const { version, workDir } = options;
  const binariesDir = resolve(options.binariesDir);
  const dirs: string[] = [];

  for (const target of PLATFORMS) {
    const pkgDir = join(workDir, target.packageSuffix);
    const binDir = join(pkgDir, 'bin');
    await mkdir(binDir, { recursive: true });

    await Bun.write(
      join(pkgDir, 'package.json'),
      makePlatformPackageJson(target, version),
    );

    const srcBinary = join(binariesDir, target.binaryName);
    if (!(await Bun.file(srcBinary).exists())) {
      fail(`Binary not found: ${srcBinary}`);
    }
    const dstBinary = join(binDir, 'gitrac');
    await cp(srcBinary, dstBinary);
    await chmod(dstBinary, 0o755);
    dirs.push(pkgDir);
  }

  const mainPkgDir = join(workDir, 'cli');
  const mainBinDir = join(mainPkgDir, 'bin');
  await mkdir(mainBinDir, { recursive: true });
  await Bun.write(
    join(mainPkgDir, 'package.json'),
    makeMainPackageJson(version),
  );

  const wrapperSrc = join(import.meta.dir, 'wrapper.cjs');
  if (!(await Bun.file(wrapperSrc).exists())) {
    fail(`Wrapper script not found: ${wrapperSrc}`);
  }
  const wrapperDst = join(mainBinDir, 'gitrac');
  await cp(wrapperSrc, wrapperDst);
  await chmod(wrapperDst, 0o755);
  await cp(join(PROJECT_ROOT, 'README.md'), join(mainPkgDir, 'README.md'));
  dirs.push(mainPkgDir);

  return dirs;
}

// --- Main ---

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      'binaries-dir': { type: 'string' },
      'work-dir': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'no-publish': { type: 'boolean', default: false },
    },
    strict: true,
  });

  const version = values.version?.replace(/^v/, '');
  const binariesDir = values['binaries-dir'];
  const dryRun = values['dry-run'] ?? false;
  const noPublish = values['no-publish'] ?? false;

  if (!version) {
    fail('--version is required');
  }
  if (!binariesDir) {
    fail('--binaries-dir is required');
  }

  const workDir = values['work-dir']
    ? resolve(values['work-dir'])
    : join(
        process.env.RUNNER_TEMP || tmpdir(),
        `gitrac-npm-publish-${Date.now()}`,
      );
  await mkdir(workDir, { recursive: true });

  const mode = noPublish ? ' (generate only)' : dryRun ? ' (dry-run)' : '';
  console.log(`Publishing gitrac ${version} to npm${mode}`);
  console.log(`  Binaries: ${resolve(binariesDir)}`);
  console.log(`  Work dir: ${workDir}`);
  console.log();

  const dirs = await generatePackages({ version, binariesDir, workDir });

  // Platform packages first, so the main package's optionalDependencies
  // resolve as soon as it is published.
  for (const dir of dirs) {
    const name = (await Bun.file(join(dir, 'package.json')).json()).name;
    console.log(`  ${name}@${version}`);
    if (!noPublish) {
      await npmPublish(dir, version, dryRun);
    }
  }

  console.log();
  console.log(
    `Done! ${noPublish ? 'Generated' : 'Published'} ${dirs.length} packages${mode}.`,
  );
}
