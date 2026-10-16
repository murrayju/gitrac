import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IssueWatcher } from './watcher.ts';

/** A short poll interval keeps the tests fast. */
const POLL_MS = 100;

let dir: string;
let closedDir: string;
let watcher: IssueWatcher;
let emits = 0;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gitrac-watcher-test-'));
  closedDir = join(dir, '.issues', 'closed');
  // Only `.issues/`: git does not track the empty `.issues/closed/`.
  await mkdir(join(dir, '.issues'));
  emits = 0;
  watcher = new IssueWatcher(dir, { pollMs: POLL_MS });
  watcher.on('change', () => {
    emits++;
  });
});

afterEach(async () => {
  watcher.stop();
  await rm(dir, { recursive: true, force: true });
});

async function waitUntil(cond: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await Bun.sleep(20);
  }
}

/** Wait until the watcher is quiet: no new events and no pending emit. */
async function settle(): Promise<void> {
  let last = -1;
  while (last !== watcher.generation()) {
    last = watcher.generation();
    // Longer than one poll, so changes found by the poll are counted too.
    await Bun.sleep(Math.max(250, POLL_MS * 2));
  }
}

/** Write a file in `.issues/closed/` and expect an event and an emit. */
async function expectClosedChangeSeen(name: string): Promise<void> {
  await settle();
  const gen = watcher.generation();
  const before = emits;
  await writeFile(join(closedDir, name), 'x');
  await waitUntil(() => watcher.generation() > gen && emits > before);
}

describe('IssueWatcher', () => {
  test('sees changes in .issues/closed/ created after start()', async () => {
    watcher.start();
    expect(watcher.watchedDirCount()).toBe(1);
    await mkdir(closedDir);
    await waitUntil(() => watcher.watchedDirCount() === 2);
    await expectClosedChangeSeen('1-a.md');
    // Edits to a file that is already there are seen too.
    await expectClosedChangeSeen('1-a.md');
  });

  test('sees changes in .issues/closed/ that exists at start()', async () => {
    await mkdir(closedDir);
    watcher.start();
    expect(watcher.watchedDirCount()).toBe(2);
    await expectClosedChangeSeen('1-a.md');
  });

  test('keeps at most one .issues/closed/ watcher across recreations', async () => {
    watcher.start();
    for (let round = 0; round < 3; round++) {
      await mkdir(closedDir);
      await writeFile(join(closedDir, `${round}-a.md`), 'x');
      await waitUntil(() => watcher.watchedDirCount() === 2);
      await rm(closedDir, { recursive: true, force: true });
      await waitUntil(() => watcher.watchedDirCount() === 1);
    }
    await mkdir(closedDir);
    await waitUntil(() => watcher.watchedDirCount() === 2);
    await settle();
    expect(watcher.watchedDirCount()).toBe(2);
  });

  test('sees changes after .issues/closed/ is removed and created again', async () => {
    await mkdir(closedDir);
    watcher.start();
    await expectClosedChangeSeen('1-a.md');

    for (let round = 0; round < 3; round++) {
      await rm(closedDir, { recursive: true, force: true });
      await settle();
      await mkdir(closedDir);
      await expectClosedChangeSeen(`${round}-b.md`);
    }
  });

  test('start() twice does not add watchers', async () => {
    await mkdir(closedDir);
    watcher.start();
    watcher.start();
    expect(watcher.watchedDirCount()).toBe(2);
  });

  test('stop() closes the .issues/closed/ watcher', async () => {
    watcher.start();
    await mkdir(closedDir);
    await expectClosedChangeSeen('1-a.md');
    watcher.stop();
    expect(watcher.watchedDirCount()).toBe(0);
    const gen = watcher.generation();
    await writeFile(join(closedDir, '2-a.md'), 'x');
    await Bun.sleep(POLL_MS + 300);
    expect(watcher.generation()).toBe(gen);
  });
});
