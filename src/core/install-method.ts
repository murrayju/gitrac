/**
 * How the running gitrac was installed, and what `gitrac update` does for
 * each way. Pure functions: the caller supplies the executable path, the
 * platform and the versions.
 */

/** The npm package that `npm install -g` and friends install. */
export const NPM_PACKAGE = '@gitrac/cli';

/** The GitHub repository that hosts the release binaries. */
export const RELEASE_REPO = 'murrayju/gitrac';

/** A package manager that can install gitrac globally. */
export type PackageManager = 'npm' | 'pnpm' | 'bun' | 'yarn';

/** A tool that runs a package once without installing it (`npx` etc.). */
export type OneOffRunner = 'npx' | 'bunx' | 'pnpm dlx';

export type InstallMethod =
  /** Run from a source checkout (`./gitrac`, `bun index.ts`). */
  | { kind: 'source' }
  /** A standalone binary (install.sh, a manual download, a local build). */
  | { kind: 'binary'; path: string }
  /** A global install by a package manager (the npm packages). */
  | {
      kind: 'package-manager';
      manager: PackageManager;
      /** npm only: the `--prefix` of the install. */
      npmPrefix?: string;
    }
  /** A one-off run (`npx @gitrac/cli`): it has nothing to update. */
  | { kind: 'one-off'; runner: OneOffRunner }
  /** A dependency of a project (not a global install). */
  | { kind: 'dependency'; path: string };

/** The name of the install method in output (`binary`, `npm`, `npx`, ...). */
export function installMethodName(method: InstallMethod): string {
  switch (method.kind) {
    case 'source':
      return 'source';
    case 'binary':
      return 'binary';
    case 'package-manager':
      return method.manager;
    case 'one-off':
      return method.runner;
    case 'dependency':
      return 'dependency';
  }
}

/**
 * Find how gitrac was installed from the real path of the running
 * executable. `compiled` is false when gitrac runs from source (then
 * `execPath` is the bun binary). A compiled binary inside `node_modules`
 * comes from the npm packages: the directory layout tells which tool put it
 * there. Any other compiled binary is a standalone binary.
 */
export function detectInstallMethod(
  execPath: string,
  compiled: boolean,
): InstallMethod {
  if (!compiled) return { kind: 'source' };
  const path = execPath.replace(/\\/g, '/');
  if (!path.includes('/node_modules/')) {
    return { kind: 'binary', path: execPath };
  }
  // The caches of one-off runs: npm's `_npx/<hash>`, bun's
  // `<tmp>/bunx-<uid>-<package>`, pnpm's `pnpm/dlx/<hash>`.
  if (path.includes('/_npx/')) return { kind: 'one-off', runner: 'npx' };
  if (/\/bunx-[^/]*\//.test(path)) return { kind: 'one-off', runner: 'bunx' };
  if (path.includes('/pnpm/dlx/')) {
    return { kind: 'one-off', runner: 'pnpm dlx' };
  }
  // pnpm 11 links global packages from its store (`store/v11/links`),
  // older versions keep them in `global/<n>/`.
  if (/\/(store\/v\d+\/links|global\/v?\d+)\//.test(path)) {
    return { kind: 'package-manager', manager: 'pnpm' };
  }
  if (path.includes('/install/global/node_modules/')) {
    return { kind: 'package-manager', manager: 'bun' };
  }
  if (path.includes('/yarn/global/node_modules/')) {
    return { kind: 'package-manager', manager: 'yarn' };
  }
  // npm installs global packages in <prefix>/lib/node_modules.
  const libIndex = path.indexOf('/lib/node_modules/');
  if (libIndex > 0) {
    return {
      kind: 'package-manager',
      manager: 'npm',
      npmPrefix: execPath.slice(0, libIndex),
    };
  }
  return { kind: 'dependency', path: execPath };
}

/**
 * The command that installs the latest gitrac with `manager`. For npm,
 * `npmPrefix` keeps the install in the same prefix, also when the `npm` on
 * PATH now belongs to another Node.js version (nvm, mise, ...).
 */
export function packageManagerInstallCommand(
  manager: PackageManager,
  npmPrefix?: string,
): string[] {
  const spec = `${NPM_PACKAGE}@latest`;
  switch (manager) {
    case 'npm':
      return npmPrefix
        ? ['npm', 'install', '--global', '--prefix', npmPrefix, spec]
        : ['npm', 'install', '--global', spec];
    case 'pnpm':
      return ['pnpm', 'add', '--global', spec];
    case 'bun':
      return ['bun', 'add', '--global', spec];
    case 'yarn':
      return ['yarn', 'global', 'add', spec];
  }
}

/**
 * The release asset for a platform (`process.platform`, `process.arch`), or
 * null if no binary is released for it. Keep in sync with install.sh and the
 * Publish workflow.
 */
export function releaseAssetName(
  platform: string,
  arch: string,
): string | null {
  const supported = ['linux-x64', 'linux-arm64', 'darwin-arm64'];
  const name = `${platform}-${arch}`;
  return supported.includes(name) ? `gitrac-${name}` : null;
}

/**
 * The version in a GitHub release URL (`.../releases/tag/v1.2.3` → `1.2.3`),
 * or null if the URL is not a release tag URL.
 */
export function versionFromReleaseUrl(url: string): string | null {
  const match = /\/releases\/tag\/v?([^/?#]+)$/.exec(url);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** True if `latest` is a newer semver version than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  return Bun.semver.order(latest, current) > 0;
}
