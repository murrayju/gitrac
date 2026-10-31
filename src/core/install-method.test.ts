import { describe, expect, test } from 'bun:test';
import {
  detectInstallMethod,
  isNewerVersion,
  packageManagerInstallCommand,
  releaseAssetName,
  versionFromReleaseUrl,
} from './install-method.ts';

/** Regression tests for #125: how `gitrac update` finds the install method. */

describe('detectInstallMethod', () => {
  test('not compiled: a source checkout', () => {
    expect(detectInstallMethod('/usr/local/bin/bun', false)).toEqual({
      kind: 'source',
    });
  });

  test('a compiled binary outside node_modules: a standalone binary', () => {
    for (const path of [
      '/home/u/.local/bin/gitrac',
      '/usr/local/bin/gitrac',
      '/home/u/src/gitrac/bin/gitrac',
    ]) {
      expect(detectInstallMethod(path, true)).toEqual({ kind: 'binary', path });
    }
  });

  // The paths below are where each tool really puts the platform binary.
  test('npm global install: npm, with its prefix', () => {
    expect(
      detectInstallMethod(
        '/home/u/.nvm/versions/node/v22.1.0/lib/node_modules/@gitrac/cli/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
        true,
      ),
    ).toEqual({
      kind: 'package-manager',
      manager: 'npm',
      npmPrefix: '/home/u/.nvm/versions/node/v22.1.0',
    });
    // npm 7+ may hoist the platform package next to @gitrac/cli.
    expect(
      detectInstallMethod(
        '/usr/local/lib/node_modules/@gitrac/cli-darwin-arm64/bin/gitrac',
        true,
      ),
    ).toEqual({
      kind: 'package-manager',
      manager: 'npm',
      npmPrefix: '/usr/local',
    });
  });

  test('pnpm global install (pnpm 11 store links and older global dirs)', () => {
    for (const path of [
      '/home/u/.local/share/pnpm/store/v11/links/@gitrac/cli-linux-x64/0.2.1/98b2/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
      '/home/u/.local/share/pnpm/global/5/.pnpm/@gitrac+cli-linux-x64@0.2.1/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
    ]) {
      expect(detectInstallMethod(path, true)).toEqual({
        kind: 'package-manager',
        manager: 'pnpm',
      });
    }
  });

  test('bun global install', () => {
    expect(
      detectInstallMethod(
        '/home/u/.bun/install/global/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
        true,
      ),
    ).toEqual({ kind: 'package-manager', manager: 'bun' });
  });

  test('yarn classic global install', () => {
    expect(
      detectInstallMethod(
        '/home/u/.config/yarn/global/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
        true,
      ),
    ).toEqual({ kind: 'package-manager', manager: 'yarn' });
  });

  test('one-off runs: npx, bunx, pnpm dlx', () => {
    expect(
      detectInstallMethod(
        '/home/u/.npm/_npx/49a11c879dfaa229/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
        true,
      ),
    ).toEqual({ kind: 'one-off', runner: 'npx' });
    expect(
      detectInstallMethod(
        '/tmp/bunx-1000-@gitrac/cli@latest/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
        true,
      ),
    ).toEqual({ kind: 'one-off', runner: 'bunx' });
    expect(
      detectInstallMethod(
        '/home/u/.cache/pnpm/dlx/8ff63ae1/mvwhqral-j8n7/node_modules/.pnpm/@gitrac+cli-linux-x64@0.2.1/node_modules/@gitrac/cli-linux-x64/bin/gitrac',
        true,
      ),
    ).toEqual({ kind: 'one-off', runner: 'pnpm dlx' });
  });

  test('a project dependency', () => {
    const path =
      '/home/u/project/node_modules/@gitrac/cli-linux-x64/bin/gitrac';
    expect(detectInstallMethod(path, true)).toEqual({
      kind: 'dependency',
      path,
    });
  });
});

describe('packageManagerInstallCommand', () => {
  test('installs @gitrac/cli@latest globally', () => {
    expect(packageManagerInstallCommand('npm')).toEqual([
      'npm',
      'install',
      '--global',
      '@gitrac/cli@latest',
    ]);
    expect(packageManagerInstallCommand('pnpm')).toEqual([
      'pnpm',
      'add',
      '--global',
      '@gitrac/cli@latest',
    ]);
    expect(packageManagerInstallCommand('bun')).toEqual([
      'bun',
      'add',
      '--global',
      '@gitrac/cli@latest',
    ]);
    expect(packageManagerInstallCommand('yarn')).toEqual([
      'yarn',
      'global',
      'add',
      '@gitrac/cli@latest',
    ]);
  });

  test('npm keeps the prefix of the install', () => {
    expect(packageManagerInstallCommand('npm', '/opt/node')).toEqual([
      'npm',
      'install',
      '--global',
      '--prefix',
      '/opt/node',
      '@gitrac/cli@latest',
    ]);
  });
});

test('releaseAssetName: the released platforms only', () => {
  expect(releaseAssetName('linux', 'x64')).toBe('gitrac-linux-x64');
  expect(releaseAssetName('linux', 'arm64')).toBe('gitrac-linux-arm64');
  expect(releaseAssetName('darwin', 'arm64')).toBe('gitrac-darwin-arm64');
  expect(releaseAssetName('darwin', 'x64')).toBeNull();
  expect(releaseAssetName('win32', 'x64')).toBeNull();
});

test('versionFromReleaseUrl', () => {
  expect(
    versionFromReleaseUrl(
      'https://github.com/murrayju/gitrac/releases/tag/v0.2.1',
    ),
  ).toBe('0.2.1');
  expect(
    versionFromReleaseUrl(
      'https://github.com/murrayju/gitrac/releases/tag/v1.0.0-rc.1',
    ),
  ).toBe('1.0.0-rc.1');
  expect(
    versionFromReleaseUrl('https://github.com/murrayju/gitrac/releases'),
  ).toBeNull();
});

test('isNewerVersion', () => {
  expect(isNewerVersion('0.3.0', '0.2.1')).toBe(true);
  expect(isNewerVersion('0.2.1', '0.2.1')).toBe(false);
  expect(isNewerVersion('0.2.0', '0.2.1')).toBe(false);
  expect(isNewerVersion('0.3.0', '0.3.0-rc.1')).toBe(true);
});
