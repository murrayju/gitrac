import type { Command } from 'commander';
import { initProject } from '../../service/config.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext } from '../service-context.ts';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new .issues directory in the current git repo')
    .option('--force', 'Overwrite existing .issues directory')
    .action(async (options: { force?: boolean }) => {
      const globalOpts = await resolveProjectOptions(program, {
        requireInit: false,
      });

      // Auto-commits if configured; respects --no-commit and --push / --no-push.
      const { commit } = await initProject(
        cliServiceContext(globalOpts, () =>
          console.log('Initialized .issues directory.'),
        ),
        { force: options.force },
      );
      if (commit) {
        console.log('Committed initial configuration.');
      }
    });
}
