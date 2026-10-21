import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createDefaultConfig, serializeConfig } from '../core/config.ts';
import {
  configureMergeDriver,
  shellQuote,
  writeMergeAttributes,
} from './merge-driver.ts';

/**
 * Temp repositories for sync tests: `work` (the repo under test) and
 * `peer` (another clone that pushes), with local bare repos as remotes.
 * Never uses the network.
 */
export interface RemotesFixture {
  base: string;
  /** The repository under test (branch `main`, pushed to `origin`). */
  work: string;
  /** Another clone of `origin`. */
  peer: string;
  /** Bare repo of the `origin` remote. */
  origin: string;
  /** Run git in `dir`; throws on failure; returns trimmed stdout. */
  git(dir: string, ...args: string[]): Promise<string>;
  /** Write `content` to `path` in `dir`, then commit everything. */
  commitFile(
    dir: string,
    path: string,
    content: string,
    message?: string,
  ): Promise<string>;
  /** Make a new bare repo and add it as remote `name` of `work`. */
  addRemote(name: string): Promise<string>;
  cleanup(): Promise<void>;
}

const INDEX_TS = resolve(import.meta.dir, '..', '..', 'index.ts');

async function run(dir: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd: dir,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${code}): ${err}`);
  }
  return out.trim();
}

async function configure(dir: string): Promise<void> {
  await run(dir, ['config', 'user.name', 'Test']);
  await run(dir, ['config', 'user.email', 'test@example.com']);
  await run(dir, ['config', 'commit.gpgsign', 'false']);
}

/**
 * Create the fixture. With `mergeDriver`, both clones have `.issues/` with
 * gitrac's merge driver installed (it runs this source tree).
 */
export async function remotesFixture(
  options: { mergeDriver?: boolean } = {},
): Promise<RemotesFixture> {
  const base = await mkdtemp(join(tmpdir(), 'gitrac-sync-'));
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  const peer = join(base, 'peer');
  await run(base, ['init', '-q', '--bare', '-b', 'main', origin]);
  await mkdir(work);
  await run(work, ['init', '-q', '-b', 'main']);
  await configure(work);
  await writeFile(join(work, 'README.md'), 'hello\n');
  if (options.mergeDriver) {
    await mkdir(join(work, '.issues'));
    await writeFile(
      join(work, '.issues', 'config.yaml'),
      serializeConfig(createDefaultConfig()),
    );
    await writeMergeAttributes(work);
  }
  await run(work, ['add', '-A']);
  await run(work, ['commit', '-q', '-m', 'initial']);
  await run(work, ['remote', 'add', 'origin', origin]);
  await run(work, ['push', '-q', '-u', 'origin', 'main']);
  await run(base, ['clone', '-q', origin, peer]);
  await configure(peer);
  if (options.mergeDriver) {
    const command = `${shellQuote(process.execPath)} ${shellQuote(INDEX_TS)}`;
    await configureMergeDriver(work, command);
    await configureMergeDriver(peer, command);
  }

  const fixture: RemotesFixture = {
    base,
    work,
    peer,
    origin,
    git: (dir, ...args) => run(dir, args),
    async commitFile(dir, path, content, message) {
      const file = join(dir, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
      await run(dir, ['add', '-A']);
      await run(dir, ['commit', '-q', '-m', message ?? `edit ${path}`]);
      return run(dir, ['rev-parse', 'HEAD']);
    },
    async addRemote(name) {
      const bare = join(base, `${name}.git`);
      await run(base, ['init', '-q', '--bare', '-b', 'main', bare]);
      await run(work, ['remote', 'add', name, bare]);
      return bare;
    },
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
  return fixture;
}
