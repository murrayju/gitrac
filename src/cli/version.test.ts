import { describe, expect, test } from 'bun:test';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from './index.ts';

/** Regression tests for #80: `--version` comes from package.json. */

const repoRoot = join(import.meta.dir, '..', '..');

async function readPackageJson(dir: string): Promise<Record<string, unknown>> {
  return (await Bun.file(join(dir, 'package.json')).json()) as Record<
    string,
    unknown
  >;
}

async function runVersion(root: string): Promise<string> {
  const proc = Bun.spawn(
    [process.execPath, join(root, 'index.ts'), '--version'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  expect(exitCode).toBe(0);
  return stdout.trim();
}

describe('--version', () => {
  test('program version matches package.json', async () => {
    const pkg = await readPackageJson(repoRoot);
    expect(createProgram().version()).toBe(pkg.version as string);
  });

  test('gitrac --version prints the package.json version', async () => {
    const pkg = await readPackageJson(repoRoot);
    expect(await runVersion(repoRoot)).toBe(pkg.version as string);
  });

  test('follows a version bump (not hard-coded)', async () => {
    // A copy of the CLI whose package.json has been bumped the way
    // scripts/release.ts does it: only package.json changes.
    const dir = await mkdtemp(join(tmpdir(), 'gitrac-version-'));
    try {
      await cp(join(repoRoot, 'src'), join(dir, 'src'), { recursive: true });
      await cp(join(repoRoot, 'index.ts'), join(dir, 'index.ts'));
      await symlink(
        join(repoRoot, 'node_modules'),
        join(dir, 'node_modules'),
        'dir',
      );
      const pkg = await readPackageJson(repoRoot);
      const bumped = '98.76.54-test.1';
      expect(pkg.version).not.toBe(bumped);
      await Bun.write(
        join(dir, 'package.json'),
        JSON.stringify({ ...pkg, version: bumped }, null, 2),
      );
      expect(await runVersion(dir)).toBe(bumped);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
