/**
 * Rules for syncing the current branch with git remotes (pure; no I/O).
 *
 * `src/git/remotes.ts` reads the refs and runs git; `src/service/sync.ts`
 * combines them into the operations that the web UI (and a future
 * `gitrac sync`) use. Scope: the current branch only. For each remote, the
 * local branch is compared with `<remote>/<branch>`.
 */

/** A git operation that a user started in a terminal and did not finish. */
export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

/** One commit, for the "what will be synced" tooltip. */
export interface CommitSummary {
  /** Abbreviated hash. */
  hash: string;
  subject: string;
  author: string;
  /** Committer date (ISO 8601). */
  date: string;
}

/** The first commits of a range, plus how many more there are. */
export interface CommitList {
  commits: CommitSummary[];
  /** Commits in the range that are not in `commits` (the "+N more"). */
  more: number;
}

/** Most commits listed per direction and remote. */
export const COMMIT_LIST_CAP = 20;

/** The sync state of the current branch with one remote. */
export interface RemoteSyncStatus {
  name: string;
  /** Fetch URL with credentials removed (see {@link redactUrl}). */
  url: string;
  /** Whether the simple sync (no remote given) uses this remote. */
  included: boolean;
  /** Whether `<remote>/<branch>` exists (as of the last fetch). */
  hasBranch: boolean;
  /** Local commits that `<remote>/<branch>` does not have. */
  ahead: number;
  /** Commits on `<remote>/<branch>` that the local branch does not have. */
  behind: number;
  toPush: CommitList;
  toPull: CommitList;
  /**
   * Files that would conflict if `<remote>/<branch>` was merged now (with
   * gitrac's merge driver). `[]`: it merges cleanly. `null`: not checked
   * (not diverged, or this git can not tell).
   */
  conflicts: string[] | null;
  /** When this remote was last fetched (ISO 8601), if known. */
  lastFetch: string | null;
}

/** The overall state, for the compact indicator. */
export type SyncState =
  /** A merge/rebase/... from a terminal is not finished. */
  | 'operation'
  /** HEAD is not on a branch. */
  | 'detached'
  /** The repository has no remotes. */
  | 'no-remotes'
  /** No remote is included in the simple sync. */
  | 'excluded'
  /** No included remote has the branch. */
  | 'not-published'
  /** An included remote has diverged with conflicts. */
  | 'conflict'
  /** Ahead of or behind an included remote. */
  | 'out-of-sync'
  | 'in-sync';

export interface SyncSummary {
  state: SyncState;
  /** Most commits ahead of an included remote that has the branch. */
  ahead: number;
  /** Most commits behind an included remote that has the branch. */
  behind: number;
}

/** What `GET /api/sync` returns (local refs only, no network). */
export interface SyncStatus {
  /** The current branch, or null if HEAD is detached. */
  branch: string | null;
  operation: GitOperation | null;
  remotes: RemoteSyncStatus[];
  summary: SyncSummary;
}

/** A sync operation (all of them use the same per-remote results). */
export type SyncOperation = 'fetch' | 'pull' | 'push' | 'sync';

/** Why a step for one remote failed. */
export type SyncErrorKind =
  /** The merge had conflicts and was aborted. */
  | 'conflict'
  /** Uncommitted changes would be overwritten by the merge. */
  | 'local-changes'
  /** The remote has commits that are not here (push not fast-forward). */
  | 'rejected'
  /** Credentials missing or refused (no prompt is ever shown). */
  | 'auth'
  /** The remote can not be reached (DNS, connection, bad URL). */
  | 'unreachable'
  /** The git command took too long and was stopped. */
  | 'timeout'
  /** The remote does not have the branch. */
  | 'no-branch'
  /** Any other git failure. */
  | 'git';

export interface RemoteSyncError {
  kind: SyncErrorKind;
  /** A message for the user (names the remote). */
  message: string;
  /** Conflicting files, or the files local changes would lose. */
  files?: string[];
  /** Commands that the user can run in a terminal to fix it. */
  commands?: string[];
}

/** What a sync operation did with one remote. */
export interface RemoteSyncOutcome {
  remote: string;
  /** True if the remote was fetched. */
  fetched?: boolean;
  /** How the remote's commits were brought into the local branch. */
  integrated?: 'up-to-date' | 'fast-forward' | 'merge';
  /** What the push did. `created`: the branch is new on the remote. */
  pushed?: 'up-to-date' | 'pushed' | 'created';
  /** The remote was not used. */
  skipped?: 'no-branch';
  error?: RemoteSyncError;
}

export interface SyncResult {
  operation: SyncOperation;
  branch: string;
  /** False if a step failed for any remote. */
  ok: boolean;
  remotes: RemoteSyncOutcome[];
}

/** How to bring `<remote>/<branch>` into the local branch. */
export type IntegrationPlan = 'none' | 'fast-forward' | 'merge';

/**
 * The integration for the given counts: nothing if not behind, a
 * fast-forward if not ahead, else a real merge. Never a rebase: published
 * commits are never rewritten.
 */
export function integrationPlan(
  ahead: number,
  behind: number,
): IntegrationPlan {
  if (behind === 0) return 'none';
  return ahead === 0 ? 'fast-forward' : 'merge';
}

/**
 * Parse a git boolean config value for `remote.<name>.gitracSync`. Unset
 * (null) means included.
 */
export function parseIncluded(value: string | null): boolean {
  if (value === null) return true;
  const v = value.trim().toLowerCase();
  return !(v === 'false' || v === 'no' || v === 'off' || v === '0' || v === '');
}

/** Schemes where a URL's user name is often a token. */
const TOKEN_USER_SCHEMES = new Set(['http', 'https', 'ftp', 'ftps']);

/**
 * A remote URL that is safe to show: the user info of
 * `https://user:token@host/...` (or `https://token@host/...`) becomes
 * `***`. The user name of `ssh://git@host/...` (no password) is kept, and so
 * are scp-like URLs (`git@host:path`), which can not hold a password.
 */
export function redactUrl(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^@/?#]*)@/i.exec(url);
  if (!match) return url;
  const [whole, scheme = '', userInfo = ''] = match;
  const secret =
    userInfo.includes(':') || TOKEN_USER_SCHEMES.has(scheme.toLowerCase());
  if (!secret || !userInfo) return url;
  return `${scheme}://***@${url.slice(whole.length)}`;
}

/** Quote a word for a POSIX shell, only if it needs it. */
export function shellWord(word: string): string {
  if (/^[A-Za-z0-9._/@%+=:,-]+$/.test(word)) return word;
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The terminal command that merges `<remote>/<branch>` by hand. */
export function pullCommand(remote: string, branch: string): string {
  return `git pull --no-rebase ${shellWord(remote)} ${shellWord(branch)}`;
}

/** Terminal steps to resolve a conflicting merge with `remote`. */
export function conflictCommands(remote: string, branch: string): string[] {
  return [
    pullCommand(remote, branch),
    '# edit the conflicting files, then: git add <files>',
    'git commit --no-edit',
  ];
}

/** Terminal commands that finish or undo a git operation in progress. */
export function operationCommands(operation: GitOperation): string[] {
  return [`git ${operation} --continue`, `git ${operation} --abort`];
}

/** A message for a git operation in progress, which blocks sync. */
export function operationMessage(operation: GitOperation): string {
  return `A ${operation} is in progress in this repository. Finish it (git ${operation} --continue) or undo it (git ${operation} --abort) in a terminal, then sync again.`;
}

/** Patterns of git's stderr, checked in order (auth before reachability). */
const ERROR_PATTERNS: [SyncErrorKind, RegExp][] = [
  [
    'auth',
    /authentication failed|could not read (username|password)|terminal prompts disabled|permission denied \(|host key verification failed|access denied|returned error: 40[13]|invalid username or password|repository not found/i,
  ],
  [
    'unreachable',
    /could not resolve host|could not resolve hostname|connection refused|connection timed out|operation timed out|network is unreachable|no route to host|does not appear to be a git repository|could not read from remote repository|unable to access|failed to connect|connection reset/i,
  ],
  ['rejected', /\[rejected\]|non-fast-forward|fetch first|\(stale info\)/i],
  [
    'local-changes',
    /would be overwritten by merge|commit your changes or stash them|untracked working tree files would be/i,
  ],
];

/** The kind of a failed git command, from its stderr. */
export function classifyGitError(
  stderr: string,
  options: { timedOut?: boolean } = {},
): SyncErrorKind {
  if (options.timedOut) return 'timeout';
  for (const [kind, pattern] of ERROR_PATTERNS) {
    if (pattern.test(stderr)) return kind;
  }
  return 'git';
}

/** One ref status line of `git push --porcelain`, with the URL it is for. */
export interface PushRefStatus {
  /** The URL of the `To <url>` block (one block per push URL). */
  url: string;
  /**
   * git's flag: ` ` (fast-forward), `+` (forced), `-` (deleted), `*` (new
   * ref), `=` (up to date), `!` (rejected or failed).
   */
  flag: string;
  /** The summary column (e.g. `[rejected] (fetch first)`). */
  summary: string;
}

/**
 * Parse `git push --porcelain` stdout. A remote with several push URLs
 * gives one `To <url>` block for each URL that git reached.
 */
export function parsePushPorcelain(stdout: string): PushRefStatus[] {
  const statuses: PushRefStatus[] = [];
  let url = '';
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('To ')) {
      url = line.slice(3).trim();
      continue;
    }
    const match = /^(.)\t[^\t]*\t?(.*)$/.exec(line);
    if (match) {
      statuses.push({ url, flag: match[1] ?? '', summary: match[2] ?? '' });
    }
  }
  return statuses;
}

/**
 * Whether all `urlCount` push URLs reported the ref as accepted (any flag
 * but `!`). Then the push worked even if git exited with an error: e.g. a
 * server prints an error after it took the ref. git hides credentials in
 * the URLs it prints, so this counts the URLs instead of comparing them.
 */
export function pushAcceptedEverywhere(
  statuses: readonly PushRefStatus[],
  urlCount: number,
): boolean {
  if (statuses.length === 0 || statuses.some((s) => s.flag === '!')) {
    return false;
  }
  return urlCount > 0 && new Set(statuses.map((s) => s.url)).size >= urlCount;
}

/**
 * The files listed after git's "would be overwritten by merge:" (or
 * "untracked working tree files would be overwritten") line.
 */
export function overwrittenFiles(stderr: string): string[] {
  const lines = stderr.split(/\r?\n/);
  const files: string[] = [];
  let inList = false;
  for (const line of lines) {
    if (/would be (overwritten|removed) by (merge|checkout)/i.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (/^\s+\S/.test(line)) {
      files.push(line.trim());
    } else {
      inList = false;
    }
  }
  return files;
}

/** The last useful line of git's stderr (for a short error message). */
export function gitErrorLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^hint:/i.test(l));
  const fatal = lines.find((l) => /^(fatal|error):/i.test(l));
  return (fatal ?? lines[lines.length - 1] ?? 'git failed').replace(
    /^(fatal|error):\s*/i,
    '',
  );
}

/** The user-facing error for a failed step with `remote`. */
export function remoteError(
  kind: SyncErrorKind,
  remote: string,
  branch: string,
  detail: { stderr?: string; files?: string[] } = {},
): RemoteSyncError {
  const { stderr = '', files } = detail;
  switch (kind) {
    case 'conflict':
      return {
        kind,
        message: `Merging ${remote}/${branch} has conflicts${files?.length ? ` in ${files.join(', ')}` : ''}. The merge was undone. Merge it in a terminal, resolve the conflicts and commit, then sync again.`,
        files,
        commands: conflictCommands(remote, branch),
      };
    case 'local-changes': {
      const list = files ?? overwrittenFiles(stderr);
      return {
        kind,
        message: `Cannot merge ${remote}/${branch}: uncommitted changes${list.length ? ` to ${list.join(', ')}` : ''} would be overwritten. Commit or stash them, then sync again.`,
        files: list,
        commands: ['git status', 'git stash', pullCommand(remote, branch)],
      };
    }
    case 'rejected':
      return {
        kind,
        message: `${remote} has new commits on ${branch} that are not here, so the push was rejected. Sync again to merge them first.`,
      };
    case 'auth':
      return {
        kind,
        message: `Authentication with ${remote} failed (${gitErrorLine(stderr)}). gitrac never prompts for credentials: set up an SSH agent or a credential helper, or run git fetch ${shellWord(remote)} in a terminal.`,
      };
    case 'unreachable':
      return {
        kind,
        message: `Cannot reach ${remote} (${gitErrorLine(stderr)}).`,
      };
    case 'timeout':
      return {
        kind,
        message: `${remote} did not answer in time; the git command was stopped.`,
      };
    case 'no-branch':
      return {
        kind,
        message: `${remote} has no branch ${branch}.`,
      };
    default:
      return {
        kind,
        message: `git failed for ${remote}: ${gitErrorLine(stderr)}`,
      };
  }
}

/**
 * The overall state for the compact indicator, from the included remotes.
 */
export function summarizeSync(status: {
  branch: string | null;
  operation: GitOperation | null;
  remotes: readonly Pick<
    RemoteSyncStatus,
    'included' | 'hasBranch' | 'ahead' | 'behind' | 'conflicts'
  >[];
}): SyncSummary {
  const included = status.remotes.filter((r) => r.included);
  const tracked = included.filter((r) => r.hasBranch);
  const ahead = Math.max(0, ...tracked.map((r) => r.ahead));
  const behind = Math.max(0, ...tracked.map((r) => r.behind));
  const counts = { ahead, behind };
  if (status.operation) return { state: 'operation', ...counts };
  if (status.branch === null) return { state: 'detached', ...counts };
  if (status.remotes.length === 0) return { state: 'no-remotes', ...counts };
  if (included.length === 0) return { state: 'excluded', ...counts };
  if (tracked.length === 0) return { state: 'not-published', ...counts };
  if (tracked.some((r) => (r.conflicts?.length ?? 0) > 0)) {
    return { state: 'conflict', ...counts };
  }
  if (ahead > 0 || behind > 0) return { state: 'out-of-sync', ...counts };
  return { state: 'in-sync', ...counts };
}
