import type { Command } from 'commander';
import { initIssuesDir, readConfig } from '../../fs/issue-store.ts';
import { getGitRoot } from '../../git/status.ts';
import {
  commitAndMaybePush,
  getGlobalOptions,
  withMutationLock,
} from '../global-options.ts';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new .issues directory in the current git repo')
    .option('--force', 'Overwrite existing .issues directory')
    .action(async (options: { force?: boolean }) => {
      const globalOpts = getGlobalOptions(program);
      const { dir } = globalOpts;

      // Verify we're in a git repo
      try {
        await getGitRoot(dir);
      } catch {
        console.error('Error: Not inside a git repository.');
        process.exit(1);
      }

      await withMutationLock(globalOpts, async () => {
        try {
          await initIssuesDir(dir, { force: options.force });
        } catch (err) {
          console.error(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }

        console.log('Initialized .issues directory.');

        // Auto-commit if configured (freshly created, so read config).
        // Respects --no-commit and --push / --no-push.
        try {
          const config = await readConfig(dir);
          const hash = await commitAndMaybePush(
            globalOpts,
            config,
            ['.issues/config.yaml'],
            `${config.git.commitPrefix} initialize issue tracker`,
          );
          if (hash) {
            console.log('Committed initial configuration.');
          }
        } catch {
          // Config read might fail, that's ok for init
        }
      });
    });
}
