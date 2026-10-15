import type { Command } from 'commander';
import yaml from 'js-yaml';
import { invalidInput } from '../../core/errors.ts';
import {
  MERGE_DRIVER_NAME,
  mergeDriverConfigValue,
  runMergeDriver,
} from '../../git/merge-driver.ts';
import { installMergeDriver } from '../../service/merge-driver.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { cliServiceContext } from '../service-context.ts';

/**
 * `gitrac merge-driver <base> <ours> <theirs> [path]`: the git merge driver
 * (git runs it as configured by `install-merge-driver`; not meant to be run
 * by hand). Writes the merge result to `<ours>` and exits 0 if it merged
 * cleanly, 1 if conflict markers were left.
 *
 * Unlike other commands it doesn't resolve the project root: it only touches
 * the files git hands it (relative to the cwd, which git sets to the work-tree
 * root).
 */
export function registerMergeDriverCommand(program: Command): void {
  program
    .command('merge-driver <base> <ours> <theirs> [path]')
    .description(
      'Git merge driver for issue files and config.yaml (run by git: %O %A %B %P). ' +
        'Writes the result to <ours>; exits 1 if conflicts remain.',
    )
    .option('--marker-size <n>', 'Conflict marker size (%L)', '7')
    .action(
      async (
        base: string,
        ours: string,
        theirs: string,
        path: string | undefined,
        options: { markerSize: string },
      ) => {
        const markerSize = Number.parseInt(options.markerSize, 10);
        if (!Number.isInteger(markerSize) || markerSize <= 0) {
          throw invalidInput(`Invalid marker size: ${options.markerSize}`);
        }
        const result = await runMergeDriver({
          base,
          ours,
          theirs,
          path,
          markerSize,
        });
        const name = path ?? ours;
        if (result.fallbackReason && result.kind !== 'text') {
          console.error(
            `gitrac merge-driver: could not merge ${name} structurally (${result.fallbackReason}); used a line-based merge.`,
          );
        }
        if (result.conflict) {
          // A conflict isn't an error: git reads the exit status and reports
          // the conflict itself.
          process.exitCode = 1;
        }
      },
    );
}

/** `gitrac install-merge-driver [--command <cmd>]`. */
export function registerInstallMergeDriverCommand(program: Command): void {
  program
    .command('install-merge-driver')
    .description(
      'Set up the gitrac git merge driver: writes .issues/.gitattributes and .issues/.gitignore (committed) ' +
        `and merge.${MERGE_DRIVER_NAME}.driver in the local git config (once per clone)`,
    )
    .option(
      '--command <cmd>',
      'Command git should run for gitrac (default: how gitrac was invoked, e.g. "gitrac")',
    )
    .action(async (options: { command?: string }) => {
      const globalOpts = await resolveProjectOptions(program);
      const result = await installMergeDriver(cliServiceContext(globalOpts), {
        command: options.command,
      });
      const driver = mergeDriverConfigValue(result.command);
      if (globalOpts.output !== 'human') {
        const out = { ...result, driver };
        console.log(
          globalOpts.output === 'json'
            ? JSON.stringify(out, null, 2)
            : yaml.dump(out).trimEnd(),
        );
        return;
      }
      const written = result.paths.join(', ');
      console.log(
        result.paths.length > 0
          ? `Wrote ${written}.`
          : '.issues/.gitattributes and .issues/.gitignore are up to date.',
      );
      console.log(`Set merge.${MERGE_DRIVER_NAME}.driver = ${driver}`);
      if (result.commit) {
        console.log(`Committed ${written}.`);
      }
    });
}
