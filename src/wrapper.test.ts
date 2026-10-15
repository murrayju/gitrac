import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Shell-level checks for the `./gitrac` source wrapper: it must find `bun`
// and `index.ts` in the source tree even when invoked through a symlink that
// lives elsewhere (e.g. `ln -s ~/src/gitrac/gitrac ~/.local/bin/gitrac`).

const repoRoot = resolve(import.meta.dir, '..');
const wrapper = join(repoRoot, 'gitrac');
const version = (await Bun.file(join(repoRoot, 'package.json')).json()) as {
  version: string;
};

// Space in the name: the wrapper must quote every path it builds.
const scratch = mkdtempSync(join(tmpdir(), 'gitrac wrapper-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env } });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function expectVersion(result: ReturnType<typeof run>) {
  expect(result.stderr).not.toContain('No such file');
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(version.version);
}

describe('./gitrac wrapper', () => {
  const bin = join(scratch, 'bin');
  const elsewhere = join(scratch, 'elsewhere');
  mkdirSync(bin);
  mkdirSync(elsewhere);
  const link = join(bin, 'gitrac');
  symlinkSync(wrapper, link);
  // elsewhere/gitrac-chained -> ../first -> <repo>/gitrac
  symlinkSync(wrapper, join(scratch, 'first'));
  symlinkSync('../first', join(elsewhere, 'gitrac-chained'));

  test('runs via an absolute symlink from another directory', () => {
    expectVersion(run([link, '--version'], elsewhere));
  }, 30_000);

  test('runs via a symlink found on PATH', () => {
    const PATH = `${bin}:${process.env.PATH ?? ''}`;
    expectVersion(run(['bash', '-c', 'gitrac --version'], elsewhere, { PATH }));
  }, 30_000);

  test('follows a chain of relative symlinks', () => {
    expectVersion(run(['./gitrac-chained', '--version'], elsewhere));
  }, 30_000);
});
