import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitracError } from '../core/errors.ts';
import {
  findIssueFile,
  readConfig,
  readIssue,
  writeConfig,
  writeIssue,
} from '../fs/issue-store.ts';
import { CLI_POLICY, WEB_POLICY } from './context.ts';
import { IssueUnreadableError, ValidationError } from './errors.ts';
import {
  addComment,
  closeIssue,
  createIssue,
  deleteComment,
  editComment,
  reopenIssue,
  updateIssue,
} from './issues.ts';
import type { StoredIssue } from './load.ts';
import {
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

let fx: ServiceFixture;

beforeEach(async () => {
  fx = await serviceFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

/** Every file under .issues/, to assert an operation wrote nothing. */
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const root = join(fx.dir, '.issues');
  for (const entry of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[path] = await Bun.file(path).text();
  }
  return out;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the operation to fail');
}

describe('createIssue', () => {
  test('writes, registers labels, reports, then commits the issue + config', async () => {
    const result = await createIssue(fx.context(), {
      title: '  Fix login ',
      labels: ['brand-new'],
    });

    expect(result.issue).toMatchObject({
      id: 1,
      title: 'Fix login',
      status: 'backlog',
      createdBy: 'Ada',
      labels: ['brand-new'],
    });
    expect(result.paths).toEqual([
      join('.issues', '1-fix-login.md'),
      join('.issues', 'config.yaml'),
    ]);
    expect(result.commit).toBe('abc123');
    expect(result.config.labels['brand-new']).toBeDefined();
    expect((await readConfig(fx.dir)).labels['brand-new']).toBeDefined();
    expect(fx.events).toEqual(['written:create', 'commit:create']);
    expect(fx.commits[0]).toEqual({
      dir: fx.dir,
      operation: 'create',
      issueId: 1,
      files: result.paths,
      message: 'issue: create #1 Fix login',
    });
    expect((await readIssue(fx.dir, 1)).title).toBe('Fix login');
  });

  test('invalid fields throw a ValidationError and write nothing', async () => {
    const before = await snapshot();
    const err = await rejection(
      createIssue(fx.context(), { status: 'bogus', priority: 'nope' }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    const errors = (err as ValidationError).errors;
    expect(errors).toHaveLength(3); // title, status, priority
    expect((err as GitracError).code).toBe('invalid_input');
    expect((err as GitracError).details).toEqual({ errors });
    expect(await snapshot()).toEqual(before);
    expect(fx.events).toEqual([]);
  });

  test('an explicit author overrides the identity; a blank one is rejected', async () => {
    const { issue } = await createIssue(
      fx.context(),
      { title: 'A' },
      { author: ' Grace ' },
    );
    expect(issue.createdBy).toBe('Grace');

    const err = await rejection(
      createIssue(fx.context(), { title: 'B' }, { author: '  ' }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).errors).toEqual([
      'Invalid author: must be a non-empty string',
    ]);
  });

  test('a default status missing from the configured statuses is rejected', async () => {
    const config = await readConfig(fx.dir);
    config.statuses = ['todo', 'done'];
    await writeConfig(fx.dir, config);
    const err = await rejection(createIssue(fx.context(), { title: 'A' }));
    expect((err as ValidationError).errors[0]).toContain('Invalid status');
    expect((await readConfig(fx.dir)).nextId).toBe(1);
  });

  test('noCommit and git.autoCommit: false write without committing', async () => {
    await createIssue(fx.context({ noCommit: true }), { title: 'A' });
    const config = await readConfig(fx.dir);
    config.git.autoCommit = false;
    await writeConfig(fx.dir, config);
    const result = await createIssue(fx.context(), { title: 'B' });
    expect(result.commit).toBeNull();
    expect(fx.commits).toEqual([]);
    expect(fx.events).toEqual(['written:create', 'written:create']);
    expect(await findIssueFile(fx.dir, 2)).not.toBeNull();
  });

  test('uses loadConfig from the context', async () => {
    const config = await readConfig(fx.dir);
    config.defaultPriority = 'high';
    const { issue } = await createIssue(
      fx.context({ loadConfig: async () => config }),
      { title: 'A' },
    );
    expect(issue.priority).toBe('high');
  });

  test('parallel creates in one process get distinct IDs (repo lock)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createIssue(fx.context(), { title: `Issue ${i}` }),
      ),
    );
    const ids = results.map((r) => r.issue.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await readConfig(fx.dir)).nextId).toBe(7);
  });
});

describe('updateIssue', () => {
  beforeEach(async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Old title' }));
  });

  test('renames the file and commits new + old path', async () => {
    const result = await updateIssue(fx.context(), 1, { title: 'New title' });
    expect(result.paths).toEqual([
      join('.issues', '1-new-title.md'),
      join('.issues', 'config.yaml'),
      join('.issues', '1-old-title.md'),
    ]);
    expect(fx.commits[0]?.message).toBe('issue: edit #1 New title');
    expect(await findIssueFile(fx.dir, 1)).toEqual({
      filename: '1-new-title.md',
      closed: false,
    });
  });

  test('a closed status moves the file into closed/', async () => {
    const result = await updateIssue(fx.context(), 1, { status: 'done' });
    expect(result.paths[0]).toBe(join('.issues', 'closed', '1-old-title.md'));
    expect(await findIssueFile(fx.dir, 1)).toEqual({
      filename: '1-old-title.md',
      closed: true,
    });
  });

  test('adds an optional comment by the identity', async () => {
    const { issue } = await updateIssue(
      fx.context(),
      1,
      {},
      { comment: 'note' },
    );
    expect(issue.comments).toMatchObject([{ author: 'Ada', body: 'note' }]);
  });

  test('web policy: "update" verb, config only when labels were registered', async () => {
    const ctx = fx.context({ policy: WEB_POLICY });
    const first = await updateIssue(ctx, 1, { priority: 'high' });
    expect(first.paths).toEqual([join('.issues', '1-old-title.md')]);
    expect(fx.commits[0]?.message).toBe('issue: update #1 Old title');

    const second = await updateIssue(ctx, 1, { labels: ['fresh'] });
    expect(second.paths).toContain(join('.issues', 'config.yaml'));
  });

  test('the precondition runs before validation and can abort', async () => {
    const before = await snapshot();
    let seen: StoredIssue | undefined;
    const err = await rejection(
      updateIssue(
        fx.context(),
        1,
        { status: 'bogus' },
        {
          precondition: (current) => {
            seen = current;
            throw new Error('stale');
          },
        },
      ),
    );
    expect((err as Error).message).toBe('stale');
    expect(seen?.issue.title).toBe('Old title');
    expect(seen?.filename).toBe('1-old-title.md');
    expect(seen?.content).toContain('title: Old title');
    expect(await snapshot()).toEqual(before);
  });

  test('a missing issue is not_found; an unparsable one IssueUnreadableError', async () => {
    const missing = await rejection(updateIssue(fx.context(), 99, {}));
    expect((missing as GitracError).code).toBe('not_found');
    expect((missing as GitracError).message).toBe('Issue #99 not found');

    await writeFile(join(fx.dir, '.issues', '2-bad.md'), '---\n: [\n---\n');
    const bad = await rejection(updateIssue(fx.context(), 2, {}));
    expect(bad).toBeInstanceOf(IssueUnreadableError);
    expect((bad as IssueUnreadableError).id).toBe(2);
    expect((bad as GitracError).code).toBe('error');
  });
});

describe('comments', () => {
  beforeEach(async () => {
    await writeIssue(
      fx.dir,
      makeIssue({
        id: 1,
        title: 'Has comments',
        description: 'See ![x](/.issues/assets/pic.png)',
        comments: [
          { author: 'a', timestamp: '2025-01-01T00:00:00Z', body: 'first' },
        ],
      }),
    );
  });

  test('addComment trims the body and commits only the issue (CLI)', async () => {
    const result = await addComment(fx.context(), 1, '  hello  ');
    expect(result.issue.comments.at(-1)).toMatchObject({
      author: 'Ada',
      body: 'hello',
    });
    expect(result.paths).toEqual([join('.issues', '1-has-comments.md')]);
    expect(fx.commits[0]?.message).toBe('issue: comment on #1');
  });

  test('web policy: title in the message, referenced assets committed', async () => {
    const result = await addComment(
      fx.context({ policy: WEB_POLICY }),
      1,
      'hi',
      { author: 'Grace' },
    );
    expect(result.issue.comments.at(-1)?.author).toBe('Grace');
    expect(result.paths).toEqual([
      join('.issues', '1-has-comments.md'),
      join('.issues', 'assets', 'pic.png'),
    ]);
    expect(fx.commits[0]?.message).toBe('issue: comment on #1 Has comments');
  });

  test('addComment rejects an empty body or blank author with invalid_input', async () => {
    for (const [body, author] of [
      ['  ', undefined],
      [42, undefined],
      ['ok', ''],
    ] as const) {
      const err = await rejection(
        addComment(fx.context(), 1, body, { author }),
      );
      expect(err).toBeInstanceOf(GitracError);
      expect(err).not.toBeInstanceOf(ValidationError);
      expect((err as GitracError).code).toBe('invalid_input');
    }
  });

  test('editComment / deleteComment', async () => {
    const edited = await editComment(fx.context(), 1, 0, ' changed ');
    expect(edited.issue.comments[0]?.body).toBe('changed');
    expect(fx.commits[0]?.message).toBe(
      'issue: edit comment on #1 Has comments',
    );

    const deleted = await deleteComment(
      fx.context({ policy: WEB_POLICY }),
      1,
      0,
    );
    expect(deleted.issue.comments).toEqual([]);
    // Deleting never commits assets
    expect(deleted.paths).toEqual([join('.issues', '1-has-comments.md')]);
    expect(fx.commits[1]?.message).toBe(
      'issue: delete comment on #1 Has comments',
    );
  });

  test('an out-of-range comment index is not_found; a negative one invalid_input', async () => {
    const oob = await rejection(editComment(fx.context(), 1, 5, 'x'));
    expect((oob as GitracError).code).toBe('not_found');
    expect((oob as GitracError).message).toBe('Comment index out of bounds');
    const neg = await rejection(deleteComment(fx.context(), 1, -1));
    expect((neg as GitracError).code).toBe('invalid_input');
  });
});

describe('closeIssue / reopenIssue', () => {
  beforeEach(async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Work' }));
  });

  test('close moves to closed/ (done or cancelled) and commits both paths', async () => {
    const result = await closeIssue(fx.context(), 1, {
      cancelled: true,
      comment: 'bye',
    });
    expect(result.issue.status).toBe('cancelled');
    expect(result.issue.comments).toMatchObject([
      { author: 'Ada', body: 'bye' },
    ]);
    expect(result.paths).toEqual([
      join('.issues', 'closed', '1-work.md'),
      join('.issues', '1-work.md'),
    ]);
    expect(fx.commits[0]?.message).toBe('issue: close #1 Work');
  });

  test('closing a closed issue is invalid_state and writes nothing', async () => {
    await closeIssue(fx.context(), 1);
    const before = await snapshot();
    const err = await rejection(closeIssue(fx.context(), 1));
    expect((err as GitracError).code).toBe('invalid_state');
    expect(await snapshot()).toEqual(before);
  });

  test('reopen uses defaultStatus, or a requested open status', async () => {
    const config = await readConfig(fx.dir);
    config.defaultStatus = 'todo';
    await writeConfig(fx.dir, config);
    await closeIssue(fx.context(), 1);

    const reopened = await reopenIssue(fx.context(), 1);
    expect(reopened.issue.status).toBe('todo');
    expect(fx.commits.at(-1)?.message).toBe('issue: reopen #1 Work');
    expect(await findIssueFile(fx.dir, 1)).toEqual({
      filename: '1-work.md',
      closed: false,
    });

    await closeIssue(fx.context(), 1);
    const explicit = await reopenIssue(fx.context(), 1, {
      status: 'in_progress',
    });
    expect(explicit.issue.status).toBe('in_progress');
  });

  test('reopening an open issue is invalid_state', async () => {
    const err = await rejection(reopenIssue(fx.context(), 1));
    expect((err as GitracError).code).toBe('invalid_state');
  });

  test('a bad reopen status is a ValidationError; the policy decides precedence', async () => {
    // Closed issue: rejected either way
    await closeIssue(fx.context(), 1);
    const bad = await rejection(
      reopenIssue(fx.context(), 1, { status: 'done' }),
    );
    expect(bad).toBeInstanceOf(ValidationError);

    // CLI checks the status first; web checks the issue first
    const cli = await rejection(
      reopenIssue(fx.context({ policy: CLI_POLICY }), 99, { status: 'bogus' }),
    );
    expect((cli as GitracError).code).toBe('invalid_input');
    const web = await rejection(
      reopenIssue(fx.context({ policy: WEB_POLICY }), 99, { status: 'bogus' }),
    );
    expect((web as GitracError).code).toBe('not_found');
  });
});
