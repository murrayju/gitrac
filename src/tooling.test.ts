import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

// Guards that `./bun run typecheck` and `./bun run lint` cover every
// TypeScript file in the repo — not just `src/` (scripts/, index.ts,
// vite.config.ts, ...).

const repoRoot = resolve(import.meta.dir, '..');

/**
 * Whether `file` (repo-relative) is in a nested project: a directory below
 * the root with its own `tsconfig.json` (e.g. `video/`, which has its own
 * dependencies). That project type-checks it, not the root config.
 */
function inNestedProject(file: string): boolean {
  for (let dir = dirname(file); dir !== '.'; dir = dirname(dir)) {
    if (existsSync(resolve(repoRoot, dir, 'tsconfig.json'))) return true;
  }
  return false;
}

function trackedTsFiles(): string[] {
  const proc = Bun.spawnSync(['git', 'ls-files', '-z', '--', '*.ts', '*.tsx'], {
    cwd: repoRoot,
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return proc.stdout
    .toString()
    .split('\0')
    .filter((f) => f.length > 0 && !f.endsWith('.d.ts'));
}

describe('tooling coverage', () => {
  const files = trackedTsFiles();

  test('finds TypeScript files outside src/', () => {
    expect(files).toContain('index.ts');
    expect(files.some((f) => f.startsWith('scripts/'))).toBe(true);
  });

  test('tsconfig.json includes every tracked TypeScript file', () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      resolve(repoRoot, 'tsconfig.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
        },
      },
    );
    if (!parsed) throw new Error('could not parse tsconfig.json');
    const included = new Set(parsed.fileNames.map((f) => resolve(f)));
    const missing = files.filter(
      (f) => !inNestedProject(f) && !included.has(resolve(repoRoot, f)),
    );
    expect(missing).toEqual([]);
  });

  test('biome.json lints every tracked TypeScript file', async () => {
    const config = (await Bun.file(resolve(repoRoot, 'biome.json')).json()) as {
      files?: { includes?: string[] };
    };
    const includes = config.files?.includes;
    // No `files.includes` means Biome checks everything not git-ignored, and
    // tracked files aren't ignored.
    if (!includes) return;
    const positive = includes.filter((p) => !p.startsWith('!'));
    const negative = includes
      .filter((p) => p.startsWith('!'))
      .map((p) => p.replace(/^!+/, ''));
    const covered = (f: string) =>
      positive.some((p) => new Bun.Glob(p).match(f)) &&
      !negative.some((p) => new Bun.Glob(p).match(f));
    expect(files.filter((f) => !covered(f))).toEqual([]);
  });
});
