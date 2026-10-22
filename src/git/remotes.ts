import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  COMMIT_LIST_CAP,
  type CommitList,
  type CommitSummary,
  classifyGitError,
  type GitOperation,
  parseIncluded,
  parsePushPorcelain,
  pushAcceptedEverywhere,
  redactUrl,
  type SyncErrorKind,
} from '../core/sync.ts';
import { atomicWriteFile } from '../fs/atomic-write.ts';
import { gitCommonDir } from './lock.ts';
import { gitText } from './objects.ts';

/**
 * Git helpers to compare the current branch with its remotes and to fetch,
 * merge and push it (used by `src/service/sync.ts`). Every network command
 * runs without a terminal: git and ssh never prompt, and a timeout stops a
 * command that hangs.
 */

/** Default time limit for a network command (fetch, push). */
export const NETWORK_TIMEOUT_MS = 60_000;

/** Local git config key (under `remote.<name>.`) that excludes a remote. */
export const INCLUDE_KEY = 'gitracSync';

/** The result of a git command run by {@link runGit}. */
export interface GitRun {
  /** Exit code (null if a signal stopped git). */
  code: number | null;
  stdout: string;
  stderr: string;
  /** True if the time limit stopped git. */
  timedOut: boolean;
}

export interface RunGitOptions {
  /** Stop git after this many ms (default: no limit). */
  timeoutMs?: number;
  /** Extra environment variables. */
  env?: Record<string, string>;
}

/** `promise`, or `fallback` if it takes longer than `ms`. */
async function within<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run git in `dir` with no stdin, capturing stdout and stderr. Never throws
 * for a git failure (see {@link GitRun.code}).
 */
export async function runGit(
  dir: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<GitRun> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(['git', ...args], {
      cwd: dir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...options.env },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { code: null, stdout: '', stderr: message, timedOut: false };
  }
  let timedOut = false;
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill('SIGKILL');
        }, options.timeoutMs);
  const stdout = new Response(proc.stdout as ReadableStream).text();
  const stderr = new Response(proc.stderr as ReadableStream).text();
  try {
    await proc.exited;
  } finally {
    clearTimeout(timer);
  }
  // A child of git (ssh) can keep the pipes open after git stops.
  const grace = timedOut ? 100 : 5_000;
  const [out, err] = await Promise.all([
    within(stdout, grace, ''),
    within(stderr, grace, ''),
  ]);
  return { code: proc.exitCode, stdout: out, stderr: err, timedOut };
}

/**
 * The environment for network commands: no credential prompt from git, Git
 * Credential Manager or ssh. `GIT_SSH_COMMAND` is set to ssh in batch mode
 * only if the user did not set an ssh command (`GIT_SSH_COMMAND`, `GIT_SSH`
 * or `core.sshCommand`).
 */
export async function networkEnv(dir: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
  };
  const custom =
    process.env.GIT_SSH_COMMAND ||
    process.env.GIT_SSH ||
    (await gitText(dir, ['config', '--get', 'core.sshCommand']))?.trim();
  if (!custom) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  return env;
}

/** A configured remote. */
export interface RemoteInfo {
  name: string;
  /** Fetch URL, credentials removed. */
  url: string;
  /** Whether the simple sync uses it (`remote.<name>.gitracSync`). */
  included: boolean;
}

/** The repository's remotes, in `git remote` order. */
export async function listRemotes(dir: string): Promise<RemoteInfo[]> {
  const [names, urls, flags] = await Promise.all([
    gitText(dir, ['remote']),
    gitText(dir, ['remote', '-v']),
    gitText(dir, [
      'config',
      '--get-regexp',
      `^remote\\..*\\.${INCLUDE_KEY.toLowerCase()}$`,
    ]),
  ]);
  const urlOf = new Map<string, string>();
  for (const line of (urls ?? '').split('\n')) {
    const match = /^(\S+)\t(.*) \(fetch\)$/.exec(line);
    if (match?.[1] && !urlOf.has(match[1])) urlOf.set(match[1], match[2] ?? '');
  }
  const flagOf = new Map<string, string>();
  const suffix = `.${INCLUDE_KEY.toLowerCase()}`;
  for (const line of (flags ?? '').split('\n')) {
    const space = line.indexOf(' ');
    const key = space < 0 ? line : line.slice(0, space);
    if (!key.startsWith('remote.') || !key.endsWith(suffix)) continue;
    flagOf.set(
      key.slice('remote.'.length, -suffix.length),
      space < 0 ? '' : line.slice(space + 1),
    );
  }
  return (names ?? '')
    .split('\n')
    .filter(Boolean)
    .map((name) => ({
      name,
      url: redactUrl(urlOf.get(name) ?? ''),
      included: parseIncluded(flagOf.get(name) ?? null),
    }));
}

/**
 * Include or exclude a remote from the simple sync. Stored in the local git
 * config (per clone, shared by its worktrees), so `git remote rename` and
 * `git remote remove` carry or drop it. Included is the default, so
 * including removes the key.
 */
export async function setRemoteIncluded(
  dir: string,
  remote: string,
  included: boolean,
): Promise<void> {
  const key = `remote.${remote}.${INCLUDE_KEY}`;
  const run = included
    ? await runGit(dir, ['config', '--local', '--unset-all', key])
    : await runGit(dir, ['config', '--local', key, 'false']);
  // Exit 5: the key was not set (nothing to unset).
  if (run.code !== 0 && !(included && run.code === 5)) {
    throw new Error(run.stderr.trim() || `git config ${key} failed`);
  }
}

/**
 * `remotes` with the upstream remote of `branch` (`branch.<name>.remote`)
 * first, then `origin`, then the others in their order. The sync merges
 * in this order.
 */
export async function orderRemotes<T extends { name: string }>(
  dir: string,
  branch: string | null,
  remotes: T[],
): Promise<T[]> {
  const upstream = branch
    ? (
        await gitText(dir, ['config', '--get', `branch.${branch}.remote`])
      )?.trim()
    : undefined;
  const rank = (name: string) =>
    name === upstream ? 0 : name === 'origin' ? 1 : 2;
  return remotes
    .map((remote, index) => ({ remote, index }))
    .sort(
      (a, b) => rank(a.remote.name) - rank(b.remote.name) || a.index - b.index,
    )
    .map((e) => e.remote);
}

/** The current branch, or null if HEAD is detached. */
export async function currentBranch(dir: string): Promise<string | null> {
  const out = await gitText(dir, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'HEAD',
  ]);
  return out?.trim() || null;
}

/** The full name of `<remote>/<branch>` (default fetch refspec). */
export function trackingRef(remote: string, branch: string): string {
  return `refs/remotes/${remote}/${branch}`;
}

/** The commit a ref or rev points at, or null if it does not exist. */
export async function resolveCommit(
  dir: string,
  rev: string,
): Promise<string | null> {
  const out = await gitText(dir, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${rev}^{commit}`,
  ]);
  return out?.trim() || null;
}

/** Git-dir files that show an operation is in progress, by operation. */
const OPERATION_FILES: [GitOperation, string][] = [
  ['merge', 'MERGE_HEAD'],
  ['rebase', 'rebase-merge'],
  ['rebase', 'rebase-apply'],
  ['cherry-pick', 'CHERRY_PICK_HEAD'],
  ['revert', 'REVERT_HEAD'],
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The merge/rebase/... started in a terminal and not finished, if any. */
export async function operationInProgress(
  dir: string,
): Promise<GitOperation | null> {
  const out = await gitText(dir, [
    'rev-parse',
    '--path-format=absolute',
    ...OPERATION_FILES.flatMap(([, file]) => ['--git-path', file]),
  ]);
  if (out === null) return null;
  const paths = out.trim().split('\n');
  const found = await Promise.all(paths.map((p) => exists(p)));
  const index = found.indexOf(true);
  return index < 0 ? null : (OPERATION_FILES[index]?.[0] ?? null);
}

/** Commits that `local` has and `other` does not, and the reverse. */
export async function aheadBehind(
  dir: string,
  local: string,
  other: string,
): Promise<{ ahead: number; behind: number }> {
  const out = await gitText(dir, [
    'rev-list',
    '--left-right',
    '--count',
    `${local}...${other}`,
  ]);
  const [ahead, behind] = (out ?? '').trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

/** The number of commits reachable from `rev`. */
export async function countCommits(dir: string, rev: string): Promise<number> {
  const out = await gitText(dir, ['rev-list', '--count', rev, '--']);
  return Number(out?.trim()) || 0;
}

/**
 * The first `cap` commits reachable from `from` but not from `not`, newest
 * first, plus how many more there are (`total` from {@link aheadBehind}).
 */
export async function commitList(
  dir: string,
  from: string,
  not: string | null,
  total: number,
  cap = COMMIT_LIST_CAP,
): Promise<CommitList> {
  if (total === 0) return { commits: [], more: 0 };
  const out = await gitText(dir, [
    'log',
    `--max-count=${cap}`,
    '--format=%h%x00%an%x00%cI%x00%s',
    from,
    ...(not ? ['--not', not] : []),
    '--',
  ]);
  const commits: CommitSummary[] = (out ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', author = '', date = '', subject = ''] =
        line.split('\0');
      return { hash, author, date, subject };
    });
  return { commits, more: Math.max(0, total - commits.length) };
}

const conflictCache = new Map<string, string[] | null>();

/**
 * Files that would conflict if `theirs` was merged into `ours` (both commit
 * hashes), without touching the work tree (`git merge-tree --write-tree`,
 * git 2.38 or later; it uses the merge drivers from `.gitattributes`, so
 * gitrac's driver merges `.issues/`). `[]`: clean. `null`: git can not tell.
 * Results are cached by the pair of commits.
 */
export async function mergeConflicts(
  dir: string,
  ours: string,
  theirs: string,
): Promise<string[] | null> {
  const key = `${dir}\0${ours}\0${theirs}`;
  if (conflictCache.has(key)) return conflictCache.get(key) ?? null;
  const run = await runGit(dir, [
    'merge-tree',
    '--write-tree',
    '--name-only',
    '--no-messages',
    '-z',
    ours,
    theirs,
  ]);
  let result: string[] | null = null;
  if (run.code === 0) result = [];
  else if (run.code === 1) {
    result = [...new Set(run.stdout.split('\0').slice(1).filter(Boolean))];
  }
  if (conflictCache.size > 200) conflictCache.clear();
  conflictCache.set(key, result);
  return result;
}

/** Path of the file with gitrac's per-remote fetch times. */
async function fetchTimesPath(dir: string): Promise<string | null> {
  const common = await gitCommonDir(dir);
  return common ? join(common, 'gitrac', 'last-fetch.json') : null;
}

async function readFetchTimes(dir: string): Promise<Record<string, string>> {
  const path = await fetchTimesPath(dir);
  if (!path) return {};
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (e): e is [string, string] => typeof e[1] === 'string',
        ),
      );
    }
  } catch {
    // missing or unreadable: no times
  }
  return {};
}

/** Record that `remotes` were fetched at `when`. */
export async function recordFetch(
  dir: string,
  remotes: string[],
  when = new Date(),
): Promise<void> {
  const path = await fetchTimesPath(dir);
  if (!path || remotes.length === 0) return;
  const times = await readFetchTimes(dir);
  for (const remote of remotes) times[remote] = when.toISOString();
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, `${JSON.stringify(times, null, 2)}\n`);
}

/**
 * When each remote was last fetched: the time gitrac recorded, or, if a
 * fetch from a terminal is newer, the time of `FETCH_HEAD` for the remotes
 * it names (`git fetch` writes the URL there).
 */
export async function lastFetchTimes(
  dir: string,
  remotes: { name: string; rawUrl: string }[],
): Promise<Map<string, string | null>> {
  const recorded = await readFetchTimes(dir);
  const fetchHead = (
    await gitText(dir, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'FETCH_HEAD',
    ])
  )?.trim();
  let headTime: Date | null = null;
  let headText = '';
  if (fetchHead) {
    try {
      headTime = (await stat(fetchHead)).mtime;
      headText = await readFile(fetchHead, 'utf-8');
    } catch {
      headTime = null;
    }
  }
  const named = new Set(
    headText
      .split('\n')
      .map((l) => / of (.*)$/.exec(l)?.[1]?.trim())
      .filter((u): u is string => Boolean(u))
      .map(normalizeUrl),
  );
  const result = new Map<string, string | null>();
  for (const { name, rawUrl } of remotes) {
    let best = recorded[name] ?? null;
    if (headTime && (named.has(normalizeUrl(rawUrl)) || named.has(name))) {
      const iso = headTime.toISOString();
      if (!best || iso > best) best = iso;
    }
    result.set(name, best);
  }
  return result;
}

/** A URL as `FETCH_HEAD` writes it (no trailing `/` or `.git`). */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\.git$/, '');
}

/** The raw (not redacted) fetch URL of each remote. */
export async function rawRemoteUrls(dir: string): Promise<Map<string, string>> {
  const out = await gitText(dir, ['remote', '-v']);
  const urls = new Map<string, string>();
  for (const line of (out ?? '').split('\n')) {
    const match = /^(\S+)\t(.*) \(fetch\)$/.exec(line);
    if (match?.[1] && !urls.has(match[1])) urls.set(match[1], match[2] ?? '');
  }
  return urls;
}

/** A failed git step: its kind and git's stderr. */
export interface GitFailure {
  kind: SyncErrorKind;
  stderr: string;
  files?: string[];
}

/** Fetch `remote` (all its branches; never prunes). */
export async function fetchRemote(
  dir: string,
  remote: string,
  options: { timeoutMs?: number } = {},
): Promise<GitFailure | null> {
  const run = await runGit(dir, ['fetch', '--quiet', '--', remote], {
    env: await networkEnv(dir),
    timeoutMs: options.timeoutMs ?? NETWORK_TIMEOUT_MS,
  });
  if (run.code === 0 && !run.timedOut) return null;
  return {
    kind: classifyGitError(run.stderr, { timedOut: run.timedOut }),
    stderr: run.stderr,
  };
}

/** Repo-relative paths with unresolved conflicts. */
async function conflictedFiles(dir: string): Promise<string[]> {
  const out = await gitText(dir, [
    'diff',
    '--name-only',
    '--diff-filter=U',
    '-z',
  ]);
  return [...new Set((out ?? '').split('\0').filter(Boolean))];
}

/**
 * Fast-forward the current branch to `commit` (`git merge --ff-only`).
 * Git refuses if it would overwrite local changes; then nothing changes.
 */
export async function fastForward(
  dir: string,
  commit: string,
): Promise<GitFailure | null> {
  const run = await runGit(dir, ['merge', '--ff-only', '--quiet', commit]);
  if (run.code === 0) return null;
  return { kind: classifyGitError(run.stderr), stderr: run.stderr };
}

/**
 * Merge `commit` into the current branch with a merge commit (so gitrac's
 * merge driver merges `.issues/`). If the merge does not complete (for
 * example conflicts, or a hook refuses it), it is aborted, so the work tree
 * is as before: a `conflict` failure lists the files.
 */
export async function mergeCommit(
  dir: string,
  commit: string,
  message: string,
): Promise<GitFailure | null> {
  const run = await runGit(
    dir,
    ['merge', '--no-ff', '--no-edit', '-m', message, commit],
    { env: { GIT_MERGE_AUTOEDIT: 'no' } },
  );
  if (run.code === 0) return null;
  if ((await operationInProgress(dir)) === 'merge') {
    const files = await conflictedFiles(dir);
    await runGit(dir, ['merge', '--abort']);
    if (files.length > 0)
      return { kind: 'conflict', stderr: run.stderr, files };
    return { kind: 'git', stderr: run.stderr };
  }
  return { kind: classifyGitError(run.stderr), stderr: run.stderr };
}

/** What a push did to the remote branch. */
export type PushOutcome = 'up-to-date' | 'pushed' | 'created';

/**
 * Push `branch` to the same branch on `remote`, fast-forward only (never
 * forced).
 */
export async function pushBranch(
  dir: string,
  remote: string,
  branch: string,
  options: { timeoutMs?: number } = {},
): Promise<{ outcome: PushOutcome } | GitFailure> {
  const ref = `refs/heads/${branch}`;
  const run = await runGit(
    dir,
    ['push', '--porcelain', '--', remote, `${ref}:${ref}`],
    {
      env: await networkEnv(dir),
      timeoutMs: options.timeoutMs ?? NETWORK_TIMEOUT_MS,
    },
  );
  // A remote can have several push URLs; git reports the ref for each one.
  const statuses = parsePushPorcelain(run.stdout);
  const outcome = (): { outcome: PushOutcome } => {
    if (statuses.length > 0 && statuses.every((s) => s.flag === '=')) {
      return { outcome: 'up-to-date' };
    }
    if (statuses.some((s) => s.flag === '*')) return { outcome: 'created' };
    return { outcome: 'pushed' };
  };
  if (run.code === 0 && !run.timedOut) return outcome();
  // git can exit with an error although every URL took the ref (e.g. a
  // server prints an error after the update). The push worked then.
  if (
    !run.timedOut &&
    pushAcceptedEverywhere(statuses, (await pushUrls(dir, remote)).length)
  ) {
    return outcome();
  }
  const stderr = `${run.stderr}\n${run.stdout}`;
  return {
    kind: statuses.some((s) => s.flag === '!')
      ? 'rejected'
      : classifyGitError(stderr, { timedOut: run.timedOut }),
    stderr,
  };
}

/** The push URLs of `remote` (its `pushurl`s, else its `url`). */
async function pushUrls(dir: string, remote: string): Promise<string[]> {
  const out = await gitText(dir, [
    'remote',
    'get-url',
    '--push',
    '--all',
    '--',
    remote,
  ]);
  return (out ?? '').split('\n').filter((u) => u.trim() !== '');
}

/**
 * Whether `rev` is on a remote: contained in any remote-tracking branch.
 * A commit pushed to any remote (not only the upstream) is published and
 * must never be rewritten.
 */
export async function isPublished(dir: string, rev = 'HEAD'): Promise<boolean> {
  const out = await gitText(dir, [
    'for-each-ref',
    '--count=1',
    '--format=%(refname)',
    '--contains',
    rev,
    'refs/remotes',
  ]);
  // On failure assume published: then nothing is amended.
  return out === null || out.trim() !== '';
}
