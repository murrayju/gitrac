import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configVersionWarning, rawConfigVersion } from '../core/config.ts';
import { migrateProject } from '../service/migrate.ts';
import type { GlobalOptions } from './global-options.ts';
import { cliServiceContext } from './service-context.ts';

/**
 * Run before every command on an initialized project: warn (on stderr) if
 * `config.yaml` is newer than this gitrac knows, else bring an older
 * `.issues/` up to date (`migrateProject`; with `migrate: false`, skip
 * that) and say so on stderr.
 */
export async function prepareProject(
  globalOpts: GlobalOptions,
  options: { migrate?: boolean } = {},
): Promise<void> {
  let content: string;
  try {
    content = await readFile(
      join(globalOpts.dir, '.issues', 'config.yaml'),
      'utf-8',
    );
  } catch {
    return;
  }
  const warning = configVersionWarning(rawConfigVersion(content));
  if (warning) {
    console.error(`Warning: ${warning}`);
    return;
  }
  if (options.migrate === false) return;
  const migration = await migrateProject(cliServiceContext(globalOpts));
  if (!migration) return;
  const files = migration.paths.length - 1;
  console.error(
    `Migrated .issues from version ${migration.from} to ${migration.to}` +
      ` (${files} issue file${files === 1 ? '' : 's'} rewritten` +
      `${migration.commit ? `, committed ${migration.commit.slice(0, 7)}` : ''}).`,
  );
}
