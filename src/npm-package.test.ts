import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  distTag,
  generatePackages,
  MAIN_PACKAGE,
  PLATFORMS,
} from '../scripts/npm/publish.ts';

/** Tests for the npm packaging in scripts/npm/ (@gitrac/cli + platform packages). */

const ROOT = join(import.meta.dir, '..');
const PUBLISH = join(ROOT, 'scripts', 'npm', 'publish.ts');
const PLATFORM_SUFFIX = `cli-${process.platform}-${process.arch}`;

let dir: string;
let binaries: string;

/**
 * A stand-in binary: prints its args and exits with $FAKE_EXIT (default 0).
 * The script does not use the `${VAR:-default}` shell form, because Biome
 * reads `${` in a plain string as a template placeholder.
 */
const FAKE_BINARY = [
  '#!/bin/sh',
  'echo "fake gitrac $*"',
  '[ -n "$FAKE_EXIT" ] || FAKE_EXIT=0',
  'exit "$FAKE_EXIT"',
  '',
].join('\n');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-npm-'));
  binaries = join(dir, 'binaries');
  await mkdir(binaries);
  for (const target of PLATFORMS) {
    await Bun.write(join(binaries, target.binaryName), FAKE_BINARY);
  }
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function readJson(path: string): Promise<Record<string, unknown>> {
  return Bun.file(path).json();
}

async function run(
  cmd: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe('generatePackages', () => {
  test('writes the platform packages, then the main package', async () => {
    const work = join(dir, 'work');
    const dirs = await generatePackages({
      version: '1.2.3',
      binariesDir: binaries,
      workDir: work,
    });
    expect(dirs).toEqual([
      join(work, 'cli-linux-x64'),
      join(work, 'cli-linux-arm64'),
      join(work, 'cli-darwin-arm64'),
      join(work, 'cli'),
    ]);

    for (const target of PLATFORMS) {
      const pkgDir = join(work, target.packageSuffix);
      expect(await readJson(join(pkgDir, 'package.json'))).toMatchObject({
        name: `@gitrac/${target.packageSuffix}`,
        version: '1.2.3',
        license: 'MIT',
        os: [target.os],
        cpu: [target.cpu],
        files: ['bin'],
        repository: { url: 'git+https://github.com/murrayju/gitrac.git' },
      });
      const bin = join(pkgDir, 'bin', 'gitrac');
      expect((await stat(bin)).mode & 0o111).not.toBe(0);
      expect(await Bun.file(bin).text()).toBe(FAKE_BINARY);
    }

    const main = await readJson(join(work, 'cli', 'package.json'));
    expect(main).toMatchObject({
      name: MAIN_PACKAGE,
      version: '1.2.3',
      license: 'MIT',
      bin: { gitrac: 'bin/gitrac' },
      optionalDependencies: {
        '@gitrac/cli-linux-x64': '1.2.3',
        '@gitrac/cli-linux-arm64': '1.2.3',
        '@gitrac/cli-darwin-arm64': '1.2.3',
      },
      // npm trusted publishing (OIDC) requires the repository to match
      repository: { url: 'git+https://github.com/murrayju/gitrac.git' },
    });
    expect(await Bun.file(join(work, 'cli', 'README.md')).exists()).toBe(true);
    const wrapper = join(work, 'cli', 'bin', 'gitrac');
    expect((await stat(wrapper)).mode & 0o111).not.toBe(0);
    expect(await Bun.file(wrapper).text()).toStartWith('#!/usr/bin/env node');
  });

  test('--no-publish generates packages without running npm', async () => {
    const work = join(dir, 'out');
    const res = await run([
      process.execPath,
      PUBLISH,
      '--version',
      'v4.5.6',
      '--binaries-dir',
      binaries,
      '--work-dir',
      work,
      '--no-publish',
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Generated 4 packages');
    expect(res.stdout).not.toContain('npm publish');
    expect(await readJson(join(work, 'cli', 'package.json'))).toMatchObject({
      version: '4.5.6',
    });
  });

  test('a missing binary fails', async () => {
    await rm(join(binaries, 'gitrac-darwin-arm64'));
    const res = await run([
      process.execPath,
      PUBLISH,
      '--version',
      '1.0.0',
      '--binaries-dir',
      binaries,
      '--work-dir',
      join(dir, 'out'),
      '--no-publish',
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Binary not found');
  });
});

test('prereleases are published under the next dist-tag', () => {
  expect(distTag('1.2.3')).toBe('latest');
  expect(distTag('1.2.3-rc.1')).toBe('next');
  expect(distTag('0.0.0-e2e')).toBe('next');
});

describe('wrapper', () => {
  /** Lay the generated packages out like `npm install -g @gitrac/cli` would. */
  async function installLayout(): Promise<string> {
    const work = join(dir, 'work');
    await generatePackages({
      version: '1.0.0',
      binariesDir: binaries,
      workDir: work,
    });
    const nm = join(dir, 'prefix', 'node_modules', '@gitrac');
    await mkdir(nm, { recursive: true });
    await cp(join(work, 'cli'), join(nm, 'cli'), { recursive: true });
    if (PLATFORMS.some((t) => t.packageSuffix === PLATFORM_SUFFIX)) {
      await cp(join(work, PLATFORM_SUFFIX), join(nm, PLATFORM_SUFFIX), {
        recursive: true,
      });
    }
    return join(nm, 'cli', 'bin', 'gitrac');
  }

  const supported = PLATFORMS.some((t) => t.packageSuffix === PLATFORM_SUFFIX);

  test.if(supported)(
    'resolves the platform package binary and forwards args + exit code',
    async () => {
      const wrapper = await installLayout();
      const ok = await run([process.execPath, wrapper, 'ls', '--mine']);
      expect(ok.stdout).toBe('fake gitrac ls --mine\n');
      expect(ok.code).toBe(0);

      const failed = await run([process.execPath, wrapper, 'claim', '7'], {
        FAKE_EXIT: '3',
      });
      expect(failed.code).toBe(3);
    },
  );

  test('GITRAC_BINARY overrides the binary', async () => {
    const wrapper = await installLayout();
    const custom = join(dir, 'custom-gitrac');
    await Bun.write(custom, '#!/bin/sh\necho custom "$@"\n');
    await chmod(custom, 0o755);
    const res = await run([process.execPath, wrapper, '--version'], {
      GITRAC_BINARY: custom,
    });
    expect(res.stdout).toBe('custom --version\n');
    expect(res.code).toBe(0);
  });

  test('a missing platform package explains how to reinstall', async () => {
    const wrapper = await installLayout();
    await rm(join(dir, 'prefix', 'node_modules', '@gitrac', PLATFORM_SUFFIX), {
      recursive: true,
      force: true,
    });
    const res = await run([process.execPath, wrapper, '--version']);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(
      /npm install -g @gitrac\/cli|does not ship prebuilt binaries/,
    );
  });
});
