import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitracError } from '../core/errors.ts';
import { readConfig } from '../fs/issue-store.ts';
import { initProject, updateAssignees, updateLabelColors } from './config.ts';
import { type ServiceFixture, serviceFixture } from './test-helpers.fixture.ts';

let fx: ServiceFixture;

beforeEach(async () => {
  fx = await serviceFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

async function rejection(promise: Promise<unknown>): Promise<GitracError> {
  try {
    await promise;
  } catch (err) {
    return err as GitracError;
  }
  throw new Error('expected the operation to fail');
}

describe('initProject', () => {
  test('creates .issues/ and commits config.yaml + .gitignore + .gitattributes', async () => {
    await rm(join(fx.dir, '.issues'), { recursive: true });
    const result = await initProject(fx.context());
    const paths = [
      join('.issues', 'config.yaml'),
      join('.issues', '.gitignore'),
      join('.issues', '.gitattributes'),
    ];
    expect(result.paths).toEqual(paths);
    expect(fx.commits[0]?.files).toEqual(paths);
    expect(
      await Bun.file(join(fx.dir, '.issues', '.gitattributes')).text(),
    ).toContain('*.md merge=gitrac');
    expect(
      (await Bun.file(join(fx.dir, '.issues', '.gitignore')).text()).split(
        '\n',
      ),
    ).toContain('drafts/');
    expect(result.commit).toBe('abc123');
    expect(fx.events).toEqual(['written:init', 'commit:init']);
    expect(fx.commits[0]).toMatchObject({
      issueId: null,
      message: 'issue: initialize issue tracker',
    });
  });

  test('an initialized repo is already_initialized unless forced', async () => {
    expect((await rejection(initProject(fx.context()))).code).toBe(
      'already_initialized',
    );
    await initProject(fx.context(), { force: true });
  });
});

describe('updateLabelColors', () => {
  test('merges colors and commits config.yaml', async () => {
    const result = await updateLabelColors(fx.context(), { bug: '#000000' });
    expect(result.config.labels.bug).toBe('#000000');
    expect((await readConfig(fx.dir)).labels.bug).toBe('#000000');
    expect(fx.commits[0]).toMatchObject({
      operation: 'label-colors',
      issueId: null,
      files: [join('.issues', 'config.yaml')],
      message: 'issue: update label colors',
    });
  });

  test('rejects a non-object with invalid_input', async () => {
    for (const labels of [null, [], 'red']) {
      const err = await rejection(updateLabelColors(fx.context(), labels));
      expect(err.code).toBe('invalid_input');
      expect(err.message).toBe('labels must be an object');
    }
    expect(fx.commits).toEqual([]);
  });
});

describe('updateAssignees', () => {
  test('replaces the list and commits config.yaml', async () => {
    const assignees = [{ name: 'Ada', email: 'ada@example.com' }];
    const result = await updateAssignees(fx.context(), assignees);
    expect(result.config.assignees).toEqual(assignees);
    expect((await readConfig(fx.dir)).assignees).toEqual(assignees);
    expect(fx.commits[0]?.message).toBe('issue: update assignees');
  });

  test('validates the entries', async () => {
    expect((await rejection(updateAssignees(fx.context(), {}))).message).toBe(
      'assignees must be an array',
    );
    const err = await rejection(
      updateAssignees(fx.context(), [{ name: 'Ada', email: ' ' }]),
    );
    expect(err.code).toBe('invalid_input');
    expect(err.message).toContain('non-empty "name" and "email"');
  });
});
