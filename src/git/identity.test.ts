import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { ClaimUser } from '../core/claim.ts';
import { IdentityResolver, readGitIdentity } from './identity.ts';

describe('readGitIdentity', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gitrac-identity-'));
    await simpleGit(dir).init();
    await simpleGit(dir).addConfig('commit.gpgsign', 'false');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('reads user.name / user.email from the repo config', async () => {
    const git = simpleGit(dir);
    await git.addConfig('user.name', 'Ada Lovelace');
    await git.addConfig('user.email', 'ada@example.com');
    expect(await readGitIdentity(dir)).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
  });

  test('falls back to unknown when git cannot run there', async () => {
    expect(await readGitIdentity(join(dir, 'missing'))).toEqual({
      name: 'unknown',
      email: '',
    });
  });
});

describe('IdentityResolver', () => {
  function counter(users: ClaimUser[]) {
    let calls = 0;
    return {
      read: async () => users[Math.min(calls++, users.length - 1)] as ClaimUser,
      calls: () => calls,
    };
  }

  test('caches within maxAgeMs and re-reads after it', async () => {
    const src = counter([
      { name: 'A', email: 'a@x' },
      { name: 'B', email: 'b@x' },
    ]);
    let now = 1000;
    const r = new IdentityResolver('/x', {
      read: src.read,
      maxAgeMs: 100,
      now: () => now,
    });
    expect((await r.refresh()).name).toBe('A');
    now += 50;
    expect((await r.get()).name).toBe('A');
    expect(src.calls()).toBe(1);
    now += 100;
    expect((await r.get()).name).toBe('B');
    expect(src.calls()).toBe(2);
  });

  test('concurrent lookups share one read', async () => {
    const src = counter([{ name: 'A', email: '' }]);
    const r = new IdentityResolver('/x', { read: src.read });
    await Promise.all([r.get(), r.get(), r.refresh()]);
    expect(src.calls()).toBe(1);
  });

  test('an explicit author overrides git config', async () => {
    const src = counter([{ name: 'A', email: 'a@x' }]);
    const r = new IdentityResolver('/x', { read: src.read, author: ' Bob ' });
    expect(await r.get()).toEqual({ name: 'Bob', email: '' });
    expect(await r.refresh()).toEqual({ name: 'Bob', email: '' });
    expect(src.calls()).toBe(0);
  });
});
