import type { ClaimUser } from '../core/claim.ts';
import type { ServiceContext, WrittenChange } from '../service/context.ts';
import type { GlobalOptions } from './global-options.ts';
import { formatIssueDetail } from './output.ts';

/**
 * Resolve the current user: `--author` (name only) or git `user.name` /
 * `user.email`.
 */
export async function resolveClaimUser(
  globalOpts: GlobalOptions,
): Promise<ClaimUser> {
  if (globalOpts.author) {
    return { name: globalOpts.author, email: '' };
  }
  try {
    const { default: simpleGit } = await import('simple-git');
    const git = simpleGit(globalOpts.dir);
    return {
      name: (await git.getConfig('user.name')).value || 'unknown',
      email: (await git.getConfig('user.email')).value || '',
    };
  } catch {
    return { name: 'unknown', email: '' };
  }
}

/**
 * The service context for a CLI command: the resolved project root, the
 * `--author` / git identity, `--no-commit` and `--push` / `--no-push`, and
 * plain path-limited commits. `onWritten` runs once the files are written,
 * before committing (commands print their result there).
 */
export function cliServiceContext(
  globalOpts: GlobalOptions,
  onWritten?: (change: WrittenChange) => void,
): ServiceContext {
  return {
    dir: globalOpts.dir,
    identity: () => resolveClaimUser(globalOpts),
    noCommit: !globalOpts.commit,
    push: globalOpts.push,
    onWritten,
  };
}

/** `onWritten` hook that prints the written issue in the `-o` format. */
export function printWrittenIssue(
  globalOpts: GlobalOptions,
): (change: WrittenChange) => void {
  return ({ issue }) => {
    if (issue) console.log(formatIssueDetail(issue, globalOpts.output));
  };
}
