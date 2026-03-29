import type { Command } from 'commander';
import { initIssuesDir, readConfig } from '../../fs/issue-store.ts';
import { commitIssueChange } from '../../git/operations.ts';
import { getGitRoot } from '../../git/status.ts';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new .issues directory in the current git repo')
    .option('--force', 'Overwrite existing .issues directory')
    .action(async (options: { force?: boolean }) => {
      const globalOpts = program.opts();
      const dir = globalOpts.dir || process.cwd();

      // Verify we're in a git repo
      try {
        await getGitRoot(dir);
      } catch {
        console.error('Error: Not inside a git repository.');
        process.exit(1);
      }

      try {
        await initIssuesDir(dir, { force: options.force });
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      console.log('Initialized .issues directory.');

      // Auto-commit if configured (freshly created, so read config)
      if (!globalOpts.noCommit) {
        try {
          const config = await readConfig(dir);
          if (config.git.autoCommit) {
            await commitIssueChange(
              dir,
              ['.issues/config.yaml'],
              `${config.git.commitPrefix} initialize issue tracker`,
            );
            console.log('Committed initial configuration.');
          }
        } catch {
          // Config read might fail, that's ok for init
        }
      }
    });
}
