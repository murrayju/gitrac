import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test';
import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GitracError } from '../core/errors.ts';
import { serializeIssue } from '../core/issue.ts';
import { statusDefinitions } from '../core/workflow.ts';
import {
  findIssueFile,
  listAllIssueFiles,
  readConfig,
  readIssue,
  writeConfig,
  writeIssue,
} from '../fs/issue-store.ts';
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
import { linkIssue, unlinkIssue } from './links.ts';
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
    config.statuses = statusDefinitions(['todo', 'done']);
    await writeConfig(fx.dir, config);
    const before = await snapshot();
    // The config itself is invalid (#57), so nothing gets as far as writing.
    const err = await rejection(createIssue(fx.context(), { title: 'A' }));
    expect((err as GitracError).code).toBe('invalid_config');
    expect((err as GitracError).message).toContain(
      'defaultStatus "backlog" is not a configured status (todo, done)',
    );
    expect(await snapshot()).toEqual(before);
  });

  test('does not touch config.yaml unless new labels are registered (#54)', async () => {
    const configPath = join(fx.dir, '.issues', 'config.yaml');
    const before = await Bun.file(configPath).text();
    const result = await createIssue(fx.context(), {
      title: 'A',
      labels: ['bug'],
    });
    expect(result.paths).toEqual([join('.issues', '1-a.md')]);
    expect(fx.commits[0]?.files).toEqual([join('.issues', '1-a.md')]);
    expect(await Bun.file(configPath).text()).toBe(before);
  });

  test('a legacy nextId in config.yaml is a lower bound and is left alone', async () => {
    const config = await readConfig(fx.dir);
    config.nextId = 10;
    await writeConfig(fx.dir, config);
    expect((await createIssue(fx.context(), { title: 'A' })).issue.id).toBe(10);
    expect((await readConfig(fx.dir)).nextId).toBe(10);
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

  test('a closed status is written into and committed from closed/ (#67)', async () => {
    const result = await createIssue(fx.context(), {
      title: 'Already done',
      status: 'done',
    });
    expect(result.issue).toMatchObject({ id: 1, status: 'done' });
    expect(result.paths).toEqual([
      join('.issues', 'closed', '1-already-done.md'),
    ]);
    expect(fx.commits[0]?.files).toEqual(result.paths);
    expect(await findIssueFile(fx.dir, 1)).toEqual({
      filename: '1-already-done.md',
      closed: true,
    });
    expect(await listAllIssueFiles(fx.dir)).toEqual(['1-already-done.md']);

    // An open status still goes into .issues/.
    const open = await createIssue(fx.context(), { title: 'B' });
    expect(open.paths).toEqual([join('.issues', '2-b.md')]);
  });

  test('creates closed/ if it is missing (e.g. a fresh clone) (#67)', async () => {
    await rm(join(fx.dir, '.issues', 'closed'), { recursive: true });
    const result = await createIssue(fx.context(), {
      title: 'A',
      status: 'cancelled',
    });
    expect(result.paths).toEqual([join('.issues', 'closed', '1-a.md')]);
    expect((await findIssueFile(fx.dir, 1))?.closed).toBe(true);
  });

  test('parallel creates in one process get distinct IDs (repo lock)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createIssue(fx.context(), { title: `Issue ${i}` }),
      ),
    );
    const ids = results.map((r) => r.issue.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
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
      join('.issues', '1-old-title.md'),
    ]);
    expect(fx.commits[0]?.message).toBe('issue: edit #1 New title');
    expect(await findIssueFile(fx.dir, 1)).toEqual({
      filename: '1-new-title.md',
      closed: false,
    });
  });

  test('a no-op writes nothing, keeps `updated`, makes no commit (#90)', async () => {
    const description = 'Intro\n\n```js\nconst a = 1;\n```';
    await updateIssue(fx.context(), 1, {
      description,
      labels: ['bug'],
      assignee: 'Ada',
    });
    const before = await snapshot();
    const stored = await readIssue(fx.dir, 1);
    fx.commits.length = 0;
    fx.written.length = 0;

    const result = await updateIssue(
      fx.context(),
      1,
      {
        title: 'Old title',
        status: stored.status,
        priority: stored.priority,
        assignee: ' Ada ',
        labels: ['bug'],
        // The empty paragraph the editor appends after a final code block
        description: `${description}\n\n`,
      },
      // A blank comment adds nothing
      { comment: '  ' },
    );
    expect(result.changed).toBe(false);
    expect(result.paths).toEqual([]);
    expect(result.commit).toBeNull();
    expect(result.issue).toEqual(stored);
    expect(result.issue.updated).toBe(stored.updated);
    expect(await snapshot()).toEqual(before);
    expect(fx.commits).toEqual([]);
    expect(fx.written).toEqual([]);

    // Nothing given at all is a no-op too
    expect((await updateIssue(fx.context(), 1, {})).changed).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  test('a no-op still honors the precondition', async () => {
    const err = await rejection(
      updateIssue(
        fx.context(),
        1,
        { title: 'Old title' },
        {
          precondition: () => {
            throw new Error('stale');
          },
        },
      ),
    );
    expect((err as Error).message).toBe('stale');
  });

  test('whitespace inside the description, label order and a comment are changes', async () => {
    await updateIssue(fx.context(), 1, {
      description: 'a\nb',
      labels: ['x', 'y'],
    });
    fx.commits.length = 0;
    const hardBreak = await updateIssue(fx.context(), 1, {
      description: 'a  \nb',
    });
    expect(hardBreak.changed).toBe(true);
    expect((await readIssue(fx.dir, 1)).description).toBe('a  \nb');
    const reordered = await updateIssue(fx.context(), 1, {
      labels: ['y', 'x'],
    });
    expect(reordered.changed).toBe(true);
    const commented = await updateIssue(
      fx.context(),
      1,
      { title: 'Old title' },
      { comment: 'note' },
    );
    expect(commented.changed).toBe(true);
    expect(commented.issue.comments).toHaveLength(1);
    expect(fx.commits).toHaveLength(3);
  });

  test('a real change keeps a description that only differs in whitespace', async () => {
    await updateIssue(fx.context(), 1, { description: 'Body' });
    const result = await updateIssue(fx.context(), 1, {
      priority: 'high',
      description: 'Body\n\n',
    });
    expect(result.changed).toBe(true);
    expect(result.issue.description).toBe('Body');
    expect(result.issue.priority).toBe('high');
  });

  test('a closed status moves the file into closed/', async () => {
    const result = await updateIssue(fx.context(), 1, { status: 'done' });
    expect(result.paths[0]).toBe(join('.issues', 'closed', '1-old-title.md'));
    expect(await findIssueFile(fx.dir, 1)).toEqual({
      filename: '1-old-title.md',
      closed: true,
    });
  });

  test('adds an optional comment by the identity, trimmed (blank: none)', async () => {
    const { issue } = await updateIssue(
      fx.context(),
      1,
      {},
      { comment: '  note \n' },
    );
    expect(issue.comments).toMatchObject([{ author: 'Ada', body: 'note' }]);

    const blank = await updateIssue(fx.context(), 1, {}, { comment: '  ' });
    expect(blank.issue.comments).toHaveLength(1);
  });

  test('"edit" verb; config.yaml only when labels were registered', async () => {
    const ctx = fx.context();
    const first = await updateIssue(ctx, 1, { priority: 'high' });
    expect(first.paths).toEqual([join('.issues', '1-old-title.md')]);
    expect(fx.commits[0]?.message).toBe('issue: edit #1 Old title');
    expect(fx.commits[0]?.files).toEqual([join('.issues', '1-old-title.md')]);

    const second = await updateIssue(ctx, 1, { labels: ['fresh'] });
    expect(second.paths).toContain(join('.issues', 'config.yaml'));
  });

  test('commits the assets the issue references', async () => {
    const result = await updateIssue(fx.context(), 1, {
      description:
        'See ![x](/.issues/assets/pic.png) and /.issues/assets/../config.yaml',
    });
    // Only plain asset filenames, never a path escaping .issues/assets/
    expect(result.paths).toEqual([
      join('.issues', '1-old-title.md'),
      join('.issues', 'assets', 'pic.png'),
    ]);
  });

  test('input is validated before the issue is loaded', async () => {
    let seen: StoredIssue | undefined;
    const precondition = (current: StoredIssue) => {
      seen = current;
      throw new Error('stale');
    };
    const invalid = await rejection(
      updateIssue(fx.context(), 1, { status: 'bogus' }, { precondition }),
    );
    expect(invalid).toBeInstanceOf(ValidationError);
    expect(seen).toBeUndefined();
    const missing = await rejection(
      updateIssue(fx.context(), 99, { status: 'bogus' }),
    );
    expect(missing).toBeInstanceOf(ValidationError);
  });

  test('the precondition runs before anything is written and can abort', async () => {
    const before = await snapshot();
    let seen: StoredIssue | undefined;
    const err = await rejection(
      updateIssue(
        fx.context(),
        1,
        { status: 'todo' },
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

  test('a missing issue is not_found; a malformed one invalid_issue', async () => {
    const missing = await rejection(updateIssue(fx.context(), 99, {}));
    expect((missing as GitracError).code).toBe('not_found');
    expect((missing as GitracError).message).toBe('Issue #99 not found');

    await writeFile(join(fx.dir, '.issues', '2-bad.md'), '---\n: [\n---\n');
    const bad = await rejection(updateIssue(fx.context(), 2, {}));
    expect((bad as GitracError).code).toBe('invalid_issue');
    expect((bad as GitracError).message).toStartWith(
      `Issue file ${join('.issues', '2-bad.md')} is malformed: invalid frontmatter`,
    );
    expect((bad as GitracError).details).toEqual({
      id: 2,
      file: join('.issues', '2-bad.md'),
    });
  });

  test('a file without frontmatter is invalid_issue and is left alone (not #NaN)', async () => {
    const path = join(fx.dir, '.issues', '3-plain.md');
    await writeFile(path, 'no frontmatter here\n');
    const before = await snapshot();
    for (const run of [
      () => updateIssue(fx.context(), 3, { title: 'x' }),
      () => addComment(fx.context(), 3, 'hi'),
      () => closeIssue(fx.context(), 3),
    ]) {
      const err = await rejection(run());
      expect((err as GitracError).code).toBe('invalid_issue');
      expect((err as GitracError).message).toBe(
        `Issue file ${join('.issues', '3-plain.md')} is malformed: no YAML frontmatter. Fix or remove it.`,
      );
    }
    expect(await snapshot()).toEqual(before);
    expect(fx.commits).toEqual([]);
  });

  test('a frontmatter id that does not match the file name is invalid_issue', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 4, title: 'Four' }));
    await rename(
      join(fx.dir, '.issues', '4-four.md'),
      join(fx.dir, '.issues', '5-four.md'),
    );
    const err = await rejection(updateIssue(fx.context(), 5, {}));
    expect((err as GitracError).code).toBe('invalid_issue');
    expect((err as GitracError).message).toContain(
      "frontmatter id 4 doesn't match the file name (#5)",
    );
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

  test('addComment trims the body; title in the message, referenced assets committed', async () => {
    const result = await addComment(fx.context(), 1, '  hello  ');
    expect(result.issue.comments.at(-1)).toMatchObject({
      author: 'Ada',
      body: 'hello',
    });
    expect(result.paths).toEqual([
      join('.issues', '1-has-comments.md'),
      join('.issues', 'assets', 'pic.png'),
    ]);
    expect(fx.commits[0]?.message).toBe('issue: comment on #1 Has comments');
  });

  test('an explicit author overrides the identity', async () => {
    const result = await addComment(fx.context(), 1, 'hi', {
      author: 'Grace',
    });
    expect(result.issue.comments.at(-1)?.author).toBe('Grace');
  });

  test('a bad body is rejected before the issue is looked up', async () => {
    const err = await rejection(addComment(fx.context(), 99, '  '));
    expect((err as GitracError).code).toBe('invalid_input');
    const edit = await rejection(editComment(fx.context(), 99, 0, ''));
    expect((edit as GitracError).code).toBe('invalid_input');
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

    const deleted = await deleteComment(fx.context(), 1, 0);
    expect(deleted.issue.comments).toEqual([]);
    // Assets the issue still references are committed (never removed)
    expect(deleted.paths).toEqual([
      join('.issues', '1-has-comments.md'),
      join('.issues', 'assets', 'pic.png'),
    ]);
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

/** Write issue `id` under a filename that doesn't match its title. */
async function writeMisnamed(id: number, title: string, filename: string) {
  await writeFile(
    join(fx.dir, '.issues', filename),
    serializeIssue(makeIssue({ id, title })),
  );
}

describe('a file whose name does not match its title', () => {
  const stale = join('.issues', '1-old-title.md');
  const current = join('.issues', '1-new-title.md');

  beforeEach(async () => {
    await writeMisnamed(1, 'New title', '1-old-title.md');
  });

  test('addComment replaces it and commits the deletion', async () => {
    const result = await addComment(fx.context(), 1, 'hello');
    expect(result.paths).toEqual([current, stale]);
    expect(fx.commits[0]?.files).toEqual([current, stale]);
    expect(await listAllIssueFiles(fx.dir)).toEqual(['1-new-title.md']);
    expect((await readIssue(fx.dir, 1)).comments.at(-1)?.body).toBe('hello');
  });

  test('editComment / deleteComment replace it too', async () => {
    await addComment(fx.context(), 1, 'first');
    /** Move the issue back under the stale name. */
    const misname = () => rename(join(fx.dir, current), join(fx.dir, stale));

    await misname();
    const edited = await editComment(fx.context(), 1, 0, 'changed');
    expect(edited.paths).toEqual([current, stale]);
    expect(await listAllIssueFiles(fx.dir)).toEqual(['1-new-title.md']);

    await misname();
    const deleted = await deleteComment(fx.context(), 1, 0);
    expect(deleted.paths).toEqual([current, stale]);
    expect(await listAllIssueFiles(fx.dir)).toEqual(['1-new-title.md']);
    expect((await readIssue(fx.dir, 1)).comments).toEqual([]);
  });

  test('a comment on a closed issue stays in closed/', async () => {
    await rm(join(fx.dir, stale));
    await writeFile(
      join(fx.dir, '.issues', 'closed', '1-old-title.md'),
      serializeIssue(makeIssue({ id: 1, title: 'New title', status: 'done' })),
    );
    const result = await addComment(fx.context(), 1, 'late note');
    expect(result.paths).toEqual([
      join('.issues', 'closed', '1-new-title.md'),
      join('.issues', 'closed', '1-old-title.md'),
    ]);
    expect(await findIssueFile(fx.dir, 1)).toEqual({
      filename: '1-new-title.md',
      closed: true,
    });
  });
});

describe('duplicate files for one issue ID', () => {
  test('every mutation fails with duplicate_issue and writes nothing', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'One' }));
    await writeMisnamed(1, 'One', '1-one-copy.md');
    const before = await snapshot();
    for (const run of [
      () => addComment(fx.context(), 1, 'x'),
      () => updateIssue(fx.context(), 1, { title: 'Two' }),
      () => closeIssue(fx.context(), 1),
    ]) {
      const err = await rejection(run());
      expect(err).toBeInstanceOf(GitracError);
      expect(err).not.toBeInstanceOf(IssueUnreadableError);
      expect((err as GitracError).code).toBe('duplicate_issue');
      expect(
        ((err as GitracError).details?.files as string[]).toSorted(),
      ).toEqual([
        join('.issues', '1-one-copy.md'),
        join('.issues', '1-one.md'),
      ]);
    }
    expect(await snapshot()).toEqual(before);
    expect(fx.commits).toEqual([]);
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

  test('a bad reopen status is a ValidationError, reported before issue errors', async () => {
    // Closed issue: rejected either way
    await closeIssue(fx.context(), 1);
    const bad = await rejection(
      reopenIssue(fx.context(), 1, { status: 'done' }),
    );
    expect(bad).toBeInstanceOf(ValidationError);

    // Input first: a missing or open issue with a bad status is invalid_input
    const missing = await rejection(
      reopenIssue(fx.context(), 99, { status: 'bogus' }),
    );
    expect(missing).toBeInstanceOf(ValidationError);
    await reopenIssue(fx.context(), 1);
    const open = await rejection(
      reopenIssue(fx.context(), 1, { status: 'bogus' }),
    );
    expect(open).toBeInstanceOf(ValidationError);
  });
});

describe('line breaks and comment-header delimiters (#98)', () => {
  const BAD_AUTHORS = [
    'Ada\nLovelace',
    'Ada\rLovelace',
    'Ada \u2014 2026-01-01T00:00:00Z',
  ];

  test.each([
    [{ title: 'Two\nlines' }, 'Invalid title: must not contain line breaks'],
    [
      { title: 'A', assignee: 'alice\nbob' },
      'Invalid assignee: must not contain line breaks',
    ],
    [
      { title: 'A', labels: ['bug', 'x\r\ny'] },
      'Invalid labels: a label must not contain line breaks',
    ],
  ])('createIssue rejects %j and writes nothing', async (fields, message) => {
    const before = await snapshot();
    const err = await rejection(createIssue(fx.context(), fields));
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).errors).toEqual([message]);
    expect(await snapshot()).toEqual(before);
    expect(fx.events).toEqual([]);
  });

  test('updateIssue rejects a title, assignee or label with a line break', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Old' }));
    const before = await snapshot();
    for (const fields of [
      { title: 'New\ntitle' },
      { assignee: 'a\rb' },
      { labels: ['a\nb'] },
    ]) {
      const err = await rejection(updateIssue(fx.context(), 1, fields));
      expect((err as GitracError).code).toBe('invalid_input');
    }
    expect(await snapshot()).toEqual(before);
  });

  test.each(
    BAD_AUTHORS,
  )('createIssue rejects the author %j', async (author) => {
    const before = await snapshot();
    const err = await rejection(
      createIssue(fx.context(), { title: 'A' }, { author }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as GitracError).code).toBe('invalid_input');
    expect((err as GitracError).message).toStartWith('Invalid author');
    expect(await snapshot()).toEqual(before);
  });

  test.each(BAD_AUTHORS)('addComment rejects the author %j', async (author) => {
    await writeIssue(fx.dir, makeIssue({ id: 1 }));
    const before = await snapshot();
    const err = await rejection(addComment(fx.context(), 1, 'hi', { author }));
    expect((err as GitracError).code).toBe('invalid_input');
    expect((err as GitracError).message).toStartWith('Invalid author');
    expect(await snapshot()).toEqual(before);
    // The author is checked before the issue is looked up.
    const missing = await rejection(
      addComment(fx.context(), 99, 'hi', { author }),
    );
    expect((missing as GitracError).code).toBe('invalid_input');
  });

  test.each(
    BAD_AUTHORS,
  )('an identity named %j cannot write a comment', async (name) => {
    const ctx = fx.context({ identity: async () => ({ name, email: '' }) });
    await writeIssue(fx.dir, makeIssue({ id: 1 }));
    const before = await snapshot();
    // Start each attempt only when it is awaited, so no rejection is left
    // unhandled and no write runs after the test ends.
    const attempts = [
      () => createIssue(ctx, { title: 'A' }),
      () => addComment(ctx, 1, 'hi'),
      () => updateIssue(ctx, 1, { priority: 'high' }, { comment: 'note' }),
      () => closeIssue(ctx, 1, { comment: 'bye' }),
    ];
    for (const attempt of attempts) {
      const err = await rejection(attempt());
      expect((err as GitracError).code).toBe('invalid_input');
      expect((err as GitracError).message).toStartWith('Invalid author');
    }
    expect(await snapshot()).toEqual(before);
    // Without a comment, the identity's name is not written, so it is fine.
    const updated = await updateIssue(ctx, 1, { priority: 'high' });
    expect(updated.issue.priority).toBe('high');
  });

  test('reopenIssue checks the comment author before the issue state', async () => {
    const ctx = fx.context({
      identity: async () => ({ name: 'A\nB', email: '' }),
    });
    await writeIssue(fx.dir, makeIssue({ id: 1 }));
    const err = await rejection(reopenIssue(ctx, 1, { comment: 'back' }));
    expect((err as GitracError).code).toBe('invalid_input');
  });

  test('a valid author round-trips through the comment header', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1 }));
    await addComment(fx.context(), 1, 'first', { author: 'Jean-Luc - Picard' });
    const issue = await readIssue(fx.dir, 1);
    expect(issue.description).toBe('A test issue description.');
    expect(issue.comments).toMatchObject([
      { author: 'Jean-Luc - Picard', body: 'first' },
    ]);
  });
});

describe('`updated` always increases (#94)', () => {
  const NOW = '2026-01-02T00:00:00.000Z';

  afterEach(() => {
    setSystemTime();
  });

  test('quick writes in the same millisecond get strictly later timestamps', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, title: 'Task' }));
    await writeIssue(fx.dir, makeIssue({ id: 2, title: 'Blocker' }));
    // Freeze the clock: every write below is in the same millisecond.
    setSystemTime(new Date(NOW));
    const ctx = fx.context();
    const writes: (() => Promise<{ issue: { updated: string } }>)[] = [
      () => updateIssue(ctx, 1, { title: 'Renamed' }),
      () => updateIssue(ctx, 1, {}, { comment: 'note' }),
      () => addComment(ctx, 1, 'hello'),
      () => editComment(ctx, 1, 0, 'edited'),
      () => deleteComment(ctx, 1, 0),
      () => linkIssue(ctx, 1, { blockedBy: [2] }),
      () => unlinkIssue(ctx, 1, { blockedBy: [2] }),
      () => closeIssue(ctx, 1),
      () => reopenIssue(ctx, 1),
    ];
    const stamps: string[] = [];
    for (const write of writes) stamps.push((await write()).issue.updated);
    expect(stamps[0]).toBe(NOW);
    for (let i = 1; i < stamps.length; i++) {
      expect(Date.parse(stamps[i] as string)).toBe(Date.parse(NOW) + i);
    }
    expect((await readIssue(fx.dir, 1)).updated).toBe(stamps.at(-1) ?? '');
  });

  test('a future-dated `updated` (clock skew) is still superseded', async () => {
    const future = '2026-01-02T00:05:00.000Z';
    await writeIssue(fx.dir, makeIssue({ id: 1, updated: future }));
    setSystemTime(new Date(NOW));
    const result = await addComment(fx.context(), 1, 'hello');
    expect(result.issue.updated).toBe('2026-01-02T00:05:00.001Z');
    // The comment keeps the same timestamp as `updated`.
    expect(result.issue.comments.at(-1)?.timestamp).toBe(result.issue.updated);
  });

  test('the close comment has the new `updated` timestamp', async () => {
    await writeIssue(fx.dir, makeIssue({ id: 1, updated: NOW }));
    setSystemTime(new Date(NOW));
    const result = await closeIssue(fx.context(), 1, { comment: 'done' });
    expect(result.issue.updated).toBe('2026-01-02T00:00:00.001Z');
    expect(result.issue.comments.at(-1)?.timestamp).toBe(result.issue.updated);
  });
});
