import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  clearEmbeddedUi,
  directoryUiAssets,
  embeddedUiAssets,
  isCompiledBinary,
  registerEmbeddedUi,
  resolveUiAssets,
  SOURCE_UI_DIST_DIR,
} from './ui-assets.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-ui-assets-'));
  await mkdir(join(dir, 'ui', 'assets'), { recursive: true });
  await writeFile(join(dir, 'ui', 'index.html'), 'INDEX');
  await writeFile(join(dir, 'ui', 'assets', 'a.js'), 'JS');
  await writeFile(join(dir, 'secret.txt'), 'SECRET');
});

afterEach(async () => {
  clearEmbeddedUi();
  await rm(dir, { recursive: true, force: true });
});

describe('directoryUiAssets', () => {
  test('reads files by URL path', async () => {
    const ui = directoryUiAssets(join(dir, 'ui'));
    expect(await (await ui.get('/index.html'))?.text()).toBe('INDEX');
    expect(await (await ui.get('/assets/a.js'))?.text()).toBe('JS');
    expect(await ui.get('/missing.js')).toBeNull();
    // Directories aren't files.
    expect(await ui.get('/assets')).toBeNull();
    expect(await ui.get('/')).toBeNull();
  });

  test('cannot escape the directory', async () => {
    const ui = directoryUiAssets(join(dir, 'ui'));
    for (const path of [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      `/${join(dir, 'secret.txt')}`,
      '/%E0%A4%A',
      '/index.html%00',
    ]) {
      expect(await ui.get(path)).toBeNull();
    }
  });
});

describe('embeddedUiAssets', () => {
  test('serves only manifest entries', async () => {
    const ui = embeddedUiAssets({
      '/index.html': join(dir, 'ui', 'index.html'),
    });
    expect(ui.source).toBe('embedded');
    expect(await (await ui.get('/index.html'))?.text()).toBe('INDEX');
    expect(await ui.get('/assets/a.js')).toBeNull();
    expect(await ui.get('/../secret.txt')).toBeNull();
  });
});

describe('resolveUiAssets', () => {
  test('prefers the registered embedded UI', () => {
    registerEmbeddedUi({ '/index.html': join(dir, 'ui', 'index.html') });
    expect(resolveUiAssets()?.source).toBe('embedded');
  });

  test("from source, uses gitrac's own dist/ui (not cwd)", () => {
    expect(SOURCE_UI_DIST_DIR).toBe(
      resolve(import.meta.dir, '..', '..', 'dist', 'ui'),
    );
    const ui = resolveUiAssets();
    // null if the UI hasn't been built in this checkout.
    if (ui) expect(ui.source).toBe(SOURCE_UI_DIST_DIR);
  });
});

describe('isCompiledBinary', () => {
  test('detects the bun virtual filesystem', () => {
    expect(isCompiledBinary('/$bunfs/root')).toBe(true);
    expect(isCompiledBinary('B:\\~BUN\\root')).toBe(true);
    expect(isCompiledBinary('/home/me/gitrac/src/web')).toBe(false);
    expect(isCompiledBinary()).toBe(false);
  });
});
