import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import simpleGit from 'simple-git';
import {
  mergeConfigFiles,
  mergeIssueFiles,
  type TextMergeResult,
} from './conflict.ts';
import { getGitRoot } from './status.ts';

/**
 * gitrac's custom git merge driver: `gitrac merge-driver` merges issue files
 * and `config.yaml` structurally ({@link mergeIssueFiles},
 * {@link mergeConfigFiles}) and falls back to git's own line-based merge
 * (conflict markers) for anything it can't parse. Installed by `gitrac init`
 * and `gitrac install-merge-driver`: `.issues/.gitattributes` routes the files
 * to the `gitrac` driver, and the local git config defines it.
 */

/** The driver name used in `.gitattributes` (`merge=gitrac`). */
export const MERGE_DRIVER_NAME = 'gitrac';

/** Repo-relative path of the attributes file that selects the driver. */
export const GITATTRIBUTES_PATH = join('.issues', '.gitattributes');

/**
 * Lines `.issues/.gitattributes` must contain. Patterns are relative to
 * `.issues/`; without a slash they match at any depth (so `closed/` too).
 */
export const GITATTRIBUTES_LINES = [
  `*.md merge=${MERGE_DRIVER_NAME}`,
  `config.yaml merge=${MERGE_DRIVER_NAME}`,
] as const;

const GITATTRIBUTES_HEADER =
  '# Issue-aware merges for gitrac (see `gitrac install-merge-driver`).';

/** Default conflict-marker size (git's). */
export const DEFAULT_MARKER_SIZE = 7;

/** Labels for conflict markers (the driver doesn't learn branch names). */
const LABELS = { ours: 'ours', base: 'base', theirs: 'theirs' } as const;

/** How a path is merged. */
export type MergeKind = 'issue' | 'config' | 'text';

/**
 * Pick the merge for a repo-relative path (git's `%P`): `config` for
 * `.issues/config.yaml`, `issue` for `.issues/**\/*.md`, else `text`.
 * Without a path, guess from the content (frontmatter means an issue).
 */
export function mergeKindForPath(
  path: string | undefined,
  oursContent = '',
): MergeKind {
  if (!path) return /^---\r?\n/.test(oursContent) ? 'issue' : 'config';
  const parts = path.split(/[\\/]+/).filter((p) => p && p !== '.');
  if (parts[0] !== '.issues') return 'text';
  if (parts.length === 2 && parts[1] === 'config.yaml') return 'config';
  if (parts.length >= 2 && path.endsWith('.md')) return 'issue';
  return 'text';
}

async function runGitMergeFile(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(['git', 'merge-file', ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // Exit status: number of conflicts (capped at 127); negative (>127) = error.
  if (code > 127) {
    throw new Error(`git merge-file failed: ${stderr.trim() || code}`);
  }
  return { code, stdout, stderr };
}

/**
 * Line-based three-way merge of strings with `git merge-file` (conflict
 * markers in the result, like git's default merge).
 */
export async function gitMergeText(
  base: string,
  ours: string,
  theirs: string,
  markerSize = DEFAULT_MARKER_SIZE,
): Promise<TextMergeResult> {
  const tmp = await mkdtemp(join(tmpdir(), 'gitrac-merge-'));
  try {
    const files = {
      ours: join(tmp, 'ours'),
      base: join(tmp, 'base'),
      theirs: join(tmp, 'theirs'),
    };
    await Promise.all([
      writeFile(files.ours, ours),
      writeFile(files.base, base),
      writeFile(files.theirs, theirs),
    ]);
    const { code, stdout } = await runGitMergeFile([
      '-p',
      `--marker-size=${markerSize}`,
      '-L',
      LABELS.ours,
      '-L',
      LABELS.base,
      '-L',
      LABELS.theirs,
      files.ours,
      files.base,
      files.theirs,
    ]);
    return { text: stdout, conflict: code !== 0 };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Arguments git passes to the driver (`%O %A %B %P`, `%L`). */
export interface MergeDriverArgs {
  /** Common ancestor's version (`%O`). */
  base: string;
  /** Our version (`%A`); the result is written here. */
  ours: string;
  /** Their version (`%B`). */
  theirs: string;
  /** Repo-relative path of the merged file (`%P`). */
  path?: string;
  /** Conflict marker size (`%L`). */
  markerSize?: number;
}

/** What the driver did. */
export interface MergeDriverResult {
  kind: MergeKind;
  /** True if conflict markers were left (git should report a conflict). */
  conflict: boolean;
  /**
   * Why the structured merge was skipped and git's line merge used instead,
   * or null if it wasn't.
   */
  fallbackReason: string | null;
}

/**
 * Run the merge driver: merge `base`/`ours`/`theirs` and write the result to
 * `ours` (git's `%A`). Issue files and `config.yaml` are merged structurally;
 * if a version can't be parsed (or the path is something else), the files are
 * merged line by line with `git merge-file` exactly like git's default
 * driver, so conflicts are left as ordinary conflict markers and nothing is
 * lost. Relative paths resolve against the cwd (git runs drivers at the
 * work-tree root).
 */
export async function runMergeDriver(
  args: MergeDriverArgs,
): Promise<MergeDriverResult> {
  const markerSize = args.markerSize ?? DEFAULT_MARKER_SIZE;
  const paths = {
    base: resolve(args.base),
    ours: resolve(args.ours),
    theirs: resolve(args.theirs),
  };
  const [base, ours, theirs] = await Promise.all([
    readFile(paths.base, 'utf-8'),
    readFile(paths.ours, 'utf-8'),
    readFile(paths.theirs, 'utf-8'),
  ]);
  const kind = mergeKindForPath(args.path, ours);

  let fallbackReason: string | null = null;
  if (kind !== 'text') {
    try {
      if (kind === 'issue') {
        const result = await mergeIssueFiles(base, ours, theirs, (b, o, t) =>
          gitMergeText(b, o, t, markerSize),
        );
        await writeFile(paths.ours, result.content);
        return { kind, conflict: result.conflict, fallbackReason: null };
      }
      await writeFile(paths.ours, mergeConfigFiles(base, ours, theirs));
      return { kind, conflict: false, fallbackReason: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fallbackReason = message.split('\n')[0]?.trim() || 'parse error';
    }
  } else {
    fallbackReason = 'not a gitrac file';
  }

  // Plain line merge, in place, like git's built-in text driver.
  const { code } = await runGitMergeFile([
    `--marker-size=${markerSize}`,
    '-L',
    LABELS.ours,
    '-L',
    LABELS.base,
    '-L',
    LABELS.theirs,
    paths.ours,
    paths.base,
    paths.theirs,
  ]);
  return { kind, conflict: code !== 0, fallbackReason };
}

/** Quote a word for `sh` (as git runs the driver command line). */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word)
    ? word
    : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** The `merge.gitrac.driver` value for a gitrac command line. */
export function mergeDriverConfigValue(command: string): string {
  return `${command} merge-driver --marker-size %L %O %A %B %P`;
}

/** True when running as a `bun build --compile` binary. */
function isCompiledBinary(): boolean {
  return (
    Bun.main.startsWith('/$bunfs/') || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(Bun.main)
  );
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The command the driver config should run to reach this gitrac:
 *
 * - a compiled binary: `gitrac` if that is what `PATH` resolves to, else its
 *   absolute path;
 * - from source in a checkout that has the `./gitrac` wrapper at `root` (the
 *   gitrac repo itself): `./gitrac` (git runs drivers at the work-tree root,
 *   so this works in every worktree);
 * - from source elsewhere: `<bun> <index.ts>` with absolute paths.
 */
export function defaultMergeDriverCommand(root: string): string {
  if (isCompiledBinary()) {
    const onPath = Bun.which('gitrac');
    if (onPath && realpathOrSelf(onPath) === realpathOrSelf(process.execPath)) {
      return 'gitrac';
    }
    return shellQuote(process.execPath);
  }
  const main = resolve(Bun.main);
  if (dirname(main) === resolve(root) && existsSync(join(root, 'gitrac'))) {
    return './gitrac';
  }
  return `${shellQuote(process.execPath)} ${shellQuote(main)}`;
}

/**
 * Make sure `.issues/.gitattributes` routes issue files and config.yaml to
 * the gitrac driver, keeping anything else in the file. Returns true if the
 * file was written.
 */
export async function writeMergeAttributes(dir: string): Promise<boolean> {
  const file = join(dir, GITATTRIBUTES_PATH);
  let existing = '';
  try {
    existing = await readFile(file, 'utf-8');
  } catch {
    // missing: create it
  }
  const present = new Set(
    existing.split(/\r?\n/).map((l) => l.trim().split(/\s+/).join(' ')),
  );
  const missing = GITATTRIBUTES_LINES.filter((l) => !present.has(l));
  if (missing.length === 0) return false;
  const lines = existing
    ? [existing.replace(/\n?$/, '')]
    : [GITATTRIBUTES_HEADER];
  await writeFile(file, `${[...lines, ...missing].join('\n')}\n`);
  return true;
}

/**
 * Define the `gitrac` merge driver in the repository's local git config
 * (`merge.gitrac.name` / `merge.gitrac.driver`), shared by all worktrees.
 * Returns false (and does nothing) if `dir` isn't in a git work tree.
 */
export async function configureMergeDriver(
  dir: string,
  command: string,
): Promise<boolean> {
  try {
    if (!(await getGitRoot(dir))) return false;
  } catch {
    return false;
  }
  const git = simpleGit(dir);
  await git.addConfig(
    `merge.${MERGE_DRIVER_NAME}.name`,
    'gitrac issue-aware merge driver',
    false,
    'local',
  );
  await git.addConfig(
    `merge.${MERGE_DRIVER_NAME}.driver`,
    mergeDriverConfigValue(command),
    false,
    'local',
  );
  return true;
}
