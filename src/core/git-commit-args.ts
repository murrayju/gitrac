/**
 * Classify the arguments that `gitrac commit` passes to `git commit`, so it
 * can reject a commit that would silently leave the issue file out.
 */

/** Short options of `git commit` that take a value (attached or next arg). */
const SHORT_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't', 'U']);

/**
 * Short options that take an optional value, attached only (`-S<keyid>`,
 * `-u<mode>`). The rest of the cluster is the value.
 */
const SHORT_OPTIONAL_VALUE = new Set(['S', 'u']);

/** Long options of `git commit` that take a value (`--opt v` or `--opt=v`). */
const LONG_WITH_VALUE = [
  'author',
  'cleanup',
  'date',
  'file',
  'fixup',
  'inter-hunk-context',
  'message',
  'pathspec-from-file',
  'reedit-message',
  'reuse-message',
  'squash',
  'template',
  'trailer',
  'unified',
];

/** Long options of `git commit` that take no value (or only `--opt=v`). */
const LONG_WITHOUT_VALUE = [
  'ahead-behind',
  'all',
  'allow-empty',
  'allow-empty-message',
  'amend',
  'branch',
  'dry-run',
  'edit',
  'gpg-sign',
  'include',
  'interactive',
  'long',
  'no-edit',
  'no-post-rewrite',
  'no-verify',
  'null',
  'only',
  'patch',
  'pathspec-file-nul',
  'porcelain',
  'post-rewrite',
  'quiet',
  'reset-author',
  'short',
  'signoff',
  'status',
  'untracked-files',
  'verbose',
  'verify',
];

const LONG_OPTIONS = [...LONG_WITH_VALUE, ...LONG_WITHOUT_VALUE];

/** What {@link analyzeCommitArgs} found in the `git commit` arguments. */
export interface CommitArgs {
  /**
   * Pathspecs: positional arguments, everything after `--`, and the
   * `--pathspec-from-file` option. With any of them, git commits only those
   * paths (`--only`) and leaves the rest of the index out.
   */
  pathspecs: string[];
  /** `-a` / `--all` is given (commit all changes to tracked files). */
  all: boolean;
  /** `--amend` is given. */
  amend: boolean;
}

/**
 * The long option that `name` (without `--`) means. git accepts a unique
 * prefix of a long option (`--mess` is `--message`). `no-x` is the negated
 * form of `x`. Returns undefined for an unknown or ambiguous name.
 */
function resolveLong(name: string): string | undefined {
  if (LONG_OPTIONS.includes(name)) return name;
  const matches = LONG_OPTIONS.filter((o) => o.startsWith(name));
  if (matches.length === 1) return matches[0];
  if (name.startsWith('no-')) {
    const positive = resolveLong(name.slice(3));
    return positive ? `no-${positive}` : undefined;
  }
  return undefined;
}

/**
 * Parse `git commit` arguments the same way git does, to find pathspecs and
 * the `-a` / `--amend` flags. An unknown option counts as a flag without a
 * value (git rejects it later). The negated form of an option (`--no-all`)
 * clears the flag.
 */
export function analyzeCommitArgs(args: readonly string[]): CommitArgs {
  const result: CommitArgs = { pathspecs: [], all: false, amend: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--') {
      result.pathspecs.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = resolveLong(arg.slice(2, eq < 0 ? undefined : eq));
      if (name === 'all') result.all = true;
      else if (name === 'no-all') result.all = false;
      else if (name === 'amend') result.amend = true;
      else if (name === 'no-amend') result.amend = false;
      const value =
        name && LONG_WITH_VALUE.includes(name)
          ? eq < 0
            ? args[++i]
            : arg.slice(eq + 1)
          : undefined;
      if (name === 'pathspec-from-file') {
        result.pathspecs.push(`--pathspec-from-file=${value ?? ''}`);
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      // A cluster of short options (`-am msg`): flags until one takes a value.
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j] as string;
        if (flag === 'a') result.all = true;
        if (SHORT_OPTIONAL_VALUE.has(flag)) break;
        if (SHORT_WITH_VALUE.has(flag)) {
          if (j === arg.length - 1) i++; // The value is the next argument.
          break;
        }
      }
      continue;
    }
    result.pathspecs.push(arg);
  }
  return result;
}
