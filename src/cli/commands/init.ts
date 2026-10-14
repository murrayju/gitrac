import type { Command } from 'commander';
import { initIssuesDir, readConfig } from '../../fs/issue-store.ts';
import {
  commitAndMaybePush,
  resolveProjectOptions,
  withMutationLock,
} from '../global-options.ts';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new .issues directory in the current git repo')
    .option('--force', 'Overwrite existing .issues directory')
    .action(async (options: { force?: boolean }) => {
      const globalOpts = await resolveProjectOptions(program, {
        requireInit: false,
      });
      const { dir } = globalOpts;

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
