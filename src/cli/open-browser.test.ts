import { describe, expect, test } from 'bun:test';
import {
  openBrowser,
  openerCommand,
  type SpawnedOpener,
  shouldOpenBrowser,
} from './open-browser.ts';

describe('shouldOpenBrowser (#115)', () => {
  const base = { open: true, isTTY: true, env: {} };

  test('opens by default in a terminal', () => {
    expect(shouldOpenBrowser(base)).toBe(true);
  });

  test('--no-open suppresses it', () => {
    expect(shouldOpenBrowser({ ...base, open: false })).toBe(false);
  });

  test('not when stdout is not a TTY', () => {
    expect(shouldOpenBrowser({ ...base, isTTY: false })).toBe(false);
  });

  test('not when CI is set', () => {
    expect(shouldOpenBrowser({ ...base, env: { CI: 'true' } })).toBe(false);
    expect(shouldOpenBrowser({ ...base, env: { CI: '1' } })).toBe(false);
  });

  test('not when GITRAC_NO_OPEN is set', () => {
    expect(shouldOpenBrowser({ ...base, env: { GITRAC_NO_OPEN: '1' } })).toBe(
      false,
    );
  });

  test('empty, 0 or false env values do not count', () => {
    for (const value of ['', '0', 'false']) {
      expect(
        shouldOpenBrowser({
          ...base,
          env: { CI: value, GITRAC_NO_OPEN: value },
        }),
      ).toBe(true);
    }
  });
});

describe('openerCommand', () => {
  const url = 'http://localhost:3000';

  test('per platform', () => {
    expect(openerCommand('linux', url)).toEqual(['xdg-open', url]);
    expect(openerCommand('darwin', url)).toEqual(['open', url]);
    expect(openerCommand('win32', url)).toEqual([
      'cmd',
      '/c',
      'start',
      '""',
      url,
    ]);
    expect(openerCommand('freebsd', url)).toEqual(['xdg-open', url]);
  });
});

describe('openBrowser', () => {
  const url = 'http://localhost:3001';

  function fake(exit: Promise<number>) {
    const calls: string[][] = [];
    let unrefs = 0;
    const spawn = (cmd: string[]): SpawnedOpener => {
      calls.push(cmd);
      return { exited: exit, unref: () => unrefs++ };
    };
    return { calls, spawn, unrefs: () => unrefs };
  }

  test('spawns the opener and does not wait for it', async () => {
    const f = fake(Promise.resolve(0));
    const notes: string[] = [];
    openBrowser(url, {
      platform: 'linux',
      spawn: f.spawn,
      warn: (m) => notes.push(m),
    });
    await Bun.sleep(0);
    expect(f.calls).toEqual([['xdg-open', url]]);
    expect(f.unrefs()).toBe(1);
    expect(notes).toEqual([]);
  });

  test('a missing opener prints a note and does not throw', () => {
    const notes: string[] = [];
    openBrowser(url, {
      platform: 'linux',
      spawn: () => {
        throw new Error('Executable not found in $PATH: "xdg-open"');
      },
      warn: (m) => notes.push(m),
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('could not open a browser');
    expect(notes[0]).toContain(url);
  });

  test('a failing opener prints a note', async () => {
    const f = fake(Promise.resolve(3));
    const notes: string[] = [];
    openBrowser(url, {
      platform: 'darwin',
      spawn: f.spawn,
      warn: (m) => notes.push(m),
    });
    await Bun.sleep(0);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('open exited with code 3');
  });
});
