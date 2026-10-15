import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { atomicTempPath, atomicWriteFile } from './atomic-write.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-atomic-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('atomicTempPath', () => {
  test('is a unique hidden .tmp sibling that is never *.md or config.yaml', () => {
    for (const name of ['1-foo.md', 'config.yaml']) {
      const path = join(dir, name);
      const a = atomicTempPath(path);
      const b = atomicTempPath(path);
      expect(a).not.toBe(b);
      for (const tmp of [a, b]) {
        expect(dirname(tmp)).toBe(dir);
        expect(basename(tmp).startsWith(`.${name}.`)).toBe(true);
        expect(tmp.endsWith('.tmp')).toBe(true);
        expect(tmp.endsWith('.md')).toBe(false);
        expect(basename(tmp)).not.toBe('config.yaml');
      }
    }
  });
});

describe('atomicWriteFile', () => {
  test('creates a new file and leaves no temp file', async () => {
    const path = join(dir, 'new.md');
    await atomicWriteFile(path, 'hello\n');
    expect(await readFile(path, 'utf-8')).toBe('hello\n');
    expect(await readdir(dir)).toEqual(['new.md']);
  });

  test('replaces an existing file by rename (new inode), not in place', async () => {
    const path = join(dir, 'config.yaml');
    await writeFile(path, 'old: 1\n');
    const before = await stat(path);
    await atomicWriteFile(path, 'new: 2\n');
    expect(await readFile(path, 'utf-8')).toBe('new: 2\n');
    expect((await stat(path)).ino).not.toBe(before.ino);
    expect(await readdir(dir)).toEqual(['config.yaml']);
  });

  test("keeps an existing file's permission bits", async () => {
    const path = join(dir, 'private.md');
    await writeFile(path, 'x');
    await chmod(path, 0o640);
    await atomicWriteFile(path, 'y');
    expect((await stat(path)).mode & 0o777).toBe(0o640);
  });

  test('writes through a symlink instead of replacing it', async () => {
    const real = join(dir, 'real.yaml');
    const link = join(dir, 'config.yaml');
    await writeFile(real, 'old');
    await symlink(real, link);
    await atomicWriteFile(link, 'new');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(real, 'utf-8')).toBe('new');
    expect((await readdir(dir)).toSorted()).toEqual([
      'config.yaml',
      'real.yaml',
    ]);
  });

  test('removes the temp file and keeps the target when the rename fails', async () => {
    // A non-empty directory can't be replaced by a file: rename fails.
    const path = join(dir, '1-blocked.md');
    await mkdir(path);
    await writeFile(join(path, 'keep'), 'kept');
    await expect(atomicWriteFile(path, 'content')).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['1-blocked.md']);
    expect(await readFile(join(path, 'keep'), 'utf-8')).toBe('kept');
  });

  test('fails without leaving anything when the directory is missing', async () => {
    await expect(
      atomicWriteFile(join(dir, 'missing', 'x.md'), 'content'),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  test('concurrent readers only ever see a complete old or new file', async () => {
    const path = join(dir, 'big.md');
    const a = 'a'.repeat(1 << 20);
    const b = 'b'.repeat(1 << 20);
    await atomicWriteFile(path, a);
    let writing = true;
    const writer = (async () => {
      for (let i = 0; i < 30; i++) await atomicWriteFile(path, i % 2 ? a : b);
      writing = false;
    })();
    const seen: number[] = [];
    while (writing) {
      const content = await readFile(path, 'utf-8');
      if (content !== a && content !== b) seen.push(content.length);
    }
    await writer;
    expect(seen).toEqual([]);
    expect(await readdir(dir)).toEqual(['big.md']);
  });
});
