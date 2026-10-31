import { realpathSync } from 'node:fs';
import { chmod, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Command } from 'commander';
import yaml from 'js-yaml';
import packageJson from '../../../package.json' with { type: 'json' };
import { GitracError } from '../../core/errors.ts';
import {
  detectInstallMethod,
  type InstallMethod,
  installMethodName,
  isNewerVersion,
  NPM_PACKAGE,
  packageManagerInstallCommand,
  RELEASE_REPO,
  releaseAssetName,
  versionFromReleaseUrl,
} from '../../core/install-method.ts';
import type { OutputFormat } from '../../core/types.ts';
import { isCompiledBinary } from '../../web/ui-assets.ts';
import { getGlobalOptions } from '../global-options.ts';

/** What `gitrac update` reads from and does to the system (tests replace it). */
export interface UpdateEnvironment {
  /** The version of the running gitrac. */
  currentVersion: string;
  /** The real path of the running executable. */
  execPath: string;
  /** False when gitrac runs from source. */
  compiled: boolean;
  platform: string;
  arch: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** The path of `command` on PATH, or null. */
  which: (command: string) => string | null;
  /**
   * Run a command with the terminal attached; its stdout goes to `stdout`.
   * Returns its exit code (null if a signal stopped it).
   */
  run: (
    command: string[],
    stdout: 'stdout' | 'stderr',
  ) => Promise<number | null>;
  /** Run `<binary> --version` and return what it prints (trimmed). */
  binaryVersion: (binary: string) => Promise<string>;
  /** Progress messages (stderr). */
  log: (message: string) => void;
}

/** The result of `gitrac update`. */
export interface UpdateResult {
  /** The install method (`binary`, `npm`, `pnpm`, `bun`, `yarn`). */
  method: string;
  /** The version before the update. */
  current: string;
  /** The newest released version. */
  latest: string;
  /** True if this run installed `latest`. */
  updated: boolean;
  /** `binary` only: the file that was (or would be) replaced. */
  path?: string;
  /** Package managers only: the command that was (or would be) run. */
  command?: string;
}

const METADATA_TIMEOUT_MS = 30_000;

/** The default {@link UpdateEnvironment}: the running process. */
export function processUpdateEnvironment(): UpdateEnvironment {
  return {
    currentVersion: packageJson.version,
    execPath: realpathSync(process.execPath),
    compiled: isCompiledBinary(),
    platform: process.platform,
    arch: process.arch,
    fetch: (url, init) => fetch(url, init),
    which: (command) => Bun.which(command),
    run: async (command, stdout) => {
      const proc = Bun.spawn(command, {
        stdin: 'inherit',
        stdout: stdout === 'stderr' ? 2 : 'inherit',
        stderr: 'inherit',
      });
      await proc.exited;
      return proc.exitCode;
    },
    binaryVersion: async (binary) => {
      const proc = Bun.spawn([binary, '--version'], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ]);
      return stdout.trim();
    },
    log: (message) => console.error(message),
  };
}

/** A version string as the release process writes it (`1.2.3`, `1.2.3-rc.1`). */
function checkVersion(version: unknown, source: string): string {
  if (
    typeof version === 'string' &&
    /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)
  ) {
    return version;
  }
  throw new GitracError(
    'error',
    `Could not read the latest gitrac version from ${source}.`,
  );
}

async function fetchOrFail(
  env: UpdateEnvironment,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await env.fetch(url, init);
  } catch (err) {
    throw new GitracError(
      'error',
      `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

/**
 * The newest stable release on GitHub. `releases/latest` redirects to the
 * tag of the newest release that is not a prerelease (the same release
 * install.sh downloads).
 */
async function latestReleaseVersion(env: UpdateEnvironment): Promise<string> {
  const url = `https://github.com/${RELEASE_REPO}/releases/latest`;
  const response = await fetchOrFail(env, url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  const location = response.headers.get('location');
  return checkVersion(location && versionFromReleaseUrl(location), url);
}

/** The version of the `latest` dist-tag of the npm package. */
async function latestNpmVersion(env: UpdateEnvironment): Promise<string> {
  const url = `https://registry.npmjs.org/${NPM_PACKAGE}/latest`;
  const response = await fetchOrFail(env, url, {
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new GitracError(
      'error',
      `Could not read the latest gitrac version from ${url} (HTTP ${response.status}).`,
    );
  }
  const body = (await response.json()) as { version?: unknown };
  return checkVersion(body.version, url);
}

/** Why `method` cannot be updated by gitrac, and what to do instead. */
function notUpdatableMessage(method: InstallMethod): string | null {
  switch (method.kind) {
    case 'source':
      return 'gitrac runs from a source checkout. Update it with git pull, then ./bun install.';
    case 'one-off':
      return `gitrac runs with ${method.runner}, so there is no installation to update. Run ${method.runner} ${NPM_PACKAGE}@latest to use the latest version.`;
    case 'dependency':
      return `gitrac is installed as a project dependency (${method.path}). Update ${NPM_PACKAGE} with the package manager of that project.`;
    default:
      return null;
  }
}

/**
 * Stream the body of `response` to a new file at `path`. (`Bun.write(path,
 * response)` does not finish for large downloads in Bun 1.3.11.)
 */
async function writeResponseBody(
  response: Response,
  path: string,
): Promise<void> {
  const file = await open(path, 'w', 0o755);
  try {
    if (response.body) {
      for await (const chunk of response.body) await file.write(chunk);
    }
  } finally {
    await file.close();
  }
}

/**
 * Replace the binary at `path` with release `version`: download it next to
 * `path`, check that it runs and reports `version`, then rename it over
 * `path` (atomic, so a failed update leaves the old binary in place).
 */
async function replaceBinary(
  env: UpdateEnvironment,
  path: string,
  version: string,
): Promise<void> {
  const asset = releaseAssetName(env.platform, env.arch);
  if (!asset) {
    throw new GitracError(
      'error',
      `No gitrac binary is released for ${env.platform}-${env.arch}.`,
    );
  }
  const url = `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${asset}`;
  env.log(`Downloading ${url}`);
  const response = await fetchOrFail(env, url);
  if (!response.ok) {
    throw new GitracError(
      'error',
      `Could not download ${url} (HTTP ${response.status}).`,
    );
  }
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.update-${process.pid}`,
  );
  try {
    try {
      await writeResponseBody(response, temporaryPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        throw new GitracError(
          'error',
          `Cannot write to ${dirname(path)}. Run gitrac update again as a user that can change ${path}.`,
          { cause: err },
        );
      }
      throw err;
    }
    await chmod(temporaryPath, 0o755);
    const downloadedVersion = await env.binaryVersion(temporaryPath);
    if (downloadedVersion !== version) {
      throw new GitracError(
        'error',
        `The downloaded binary reports version "${downloadedVersion}", expected ${version}. ${path} was not changed.`,
      );
    }
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/**
 * `gitrac update`: find how gitrac was installed and install the latest
 * release the same way. With `check`, only report whether there is one.
 */
export async function runUpdate(
  env: UpdateEnvironment,
  options: { check: boolean; format: OutputFormat },
): Promise<UpdateResult> {
  const method = detectInstallMethod(env.execPath, env.compiled);
  const notUpdatable = notUpdatableMessage(method);
  if (notUpdatable) throw new GitracError('invalid_state', notUpdatable);

  const current = env.currentVersion;
  const result: UpdateResult = {
    method: installMethodName(method),
    current,
    latest: current,
    updated: false,
  };
  if (method.kind === 'binary') {
    result.path = method.path;
    result.latest = await latestReleaseVersion(env);
    if (options.check || !isNewerVersion(result.latest, current)) return result;
    await replaceBinary(env, method.path, result.latest);
    result.updated = true;
    return result;
  }
  if (method.kind !== 'package-manager') {
    throw new Error(`Unexpected install method: ${method.kind}`);
  }
  const command = packageManagerInstallCommand(
    method.manager,
    method.npmPrefix,
  );
  result.command = command.join(' ');
  result.latest = await latestNpmVersion(env);
  if (options.check || !isNewerVersion(result.latest, current)) return result;
  const [program] = command;
  if (!program || !env.which(program)) {
    throw new GitracError(
      'error',
      `${program} is not on PATH. Update gitrac with: ${result.command}`,
    );
  }
  env.log(`Running ${result.command}`);
  // Keep stdout for the result in json/yaml mode.
  const exitCode = await env.run(
    command,
    options.format === 'human' ? 'stdout' : 'stderr',
  );
  if (exitCode !== 0) {
    throw new GitracError(
      'error',
      `${result.command} failed (exit code ${exitCode ?? 'none'}).`,
      { details: { exitCode } },
    );
  }
  result.updated = true;
  return result;
}

/** Format the result of `gitrac update` in the `-o` format. */
export function formatUpdateResult(
  result: UpdateResult,
  options: { check: boolean; format: OutputFormat },
): string {
  switch (options.format) {
    case 'json':
      return JSON.stringify(result, null, 2);
    case 'yaml':
      return yaml.dump(result, { lineWidth: -1 }).trimEnd();
    case 'human': {
      const where = result.path ? ` (${result.path})` : ` (${result.method})`;
      if (result.updated) {
        return `Updated gitrac ${result.current} → ${result.latest}${where}`;
      }
      if (options.check && isNewerVersion(result.latest, result.current)) {
        return `gitrac ${result.latest} is available (installed: ${result.current}${where}). Run gitrac update to install it.`;
      }
      return `gitrac ${result.current} is up to date${where}`;
    }
  }
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .alias('upgrade')
    .description(
      'Update gitrac to the latest release, the way it was installed: ' +
        'a standalone binary (install.sh, a download) is replaced in place; ' +
        'an npm, pnpm, bun or yarn global install is updated with that package manager',
    )
    .option('--check', 'Only check for a newer version; change nothing')
    .action(async (options: { check?: boolean }) => {
      const updateOptions = {
        check: options.check === true,
        format: getGlobalOptions(program).output,
      };
      const result = await runUpdate(processUpdateEnvironment(), updateOptions);
      console.log(formatUpdateResult(result, updateOptions));
    });
}
