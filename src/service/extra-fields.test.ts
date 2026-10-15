import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serializeIssue } from '../core/issue.ts';
import { findIssueFiles, readIssue, writeIssue } from '../fs/issue-store.ts';
import { claimIssue, unclaimIssue } from './claim.ts';
import { deleteIssue } from './delete.ts';
import {
  addComment,
  closeIssue,
  deleteComment,
  editComment,
  reopenIssue,
  updateIssue,
} from './issues.ts';
import { linkIssue, unlinkIssue } from './links.ts';
import { claimNextIssue } from './ready.ts';
import { renumberIssue } from './renumber.ts';
import {
  makeIssue,
  type ServiceFixture,
  serviceFixture,
} from './test-helpers.fixture.ts';

/**
 * Regression tests for #84: unknown frontmatter keys survive every service
 * operation verbatim (they go through parseIssue -> mutate -> serializeIssue).
 */

/** Hand-written unknown keys, in a form gitrac would never write itself. */
const EXTRA = [
  '# planning',
  'sprint: 2026-03-28',
  'estimate: 3   # points',
  'externalId: "GH-12"',
  'meta: {source: jira, tags: [a, b]}',
  'empty:',
].join('\n');

const EXTRA_VALUES = {
  sprint: '2026-03-28',
  estimate: 3,
  externalId: 'GH-12',
  meta: { source: 'jira', tags: ['a', 'b'] },
  empty: null,
};

let fx: ServiceFixture;

beforeEach(async () => {
  fx = await serviceFixture();
  const issue = serializeIssue(makeIssue({ id: 1, title: 'Task' }));
  await writeFile(
    join(fx.dir, '.issues', '1-task.md'),
    issue.replace(/^(updated: .*)$/m, `$1\n${EXTRA}`),
  );
  await writeIssue(fx.dir, makeIssue({ id: 2, title: 'Other' }));
});

afterEach(async () => {
  await fx.cleanup();
});

/** The frontmatter lines after `updated:` in issue #1's file (wherever it is). */
async function extraBlock(id = 1): Promise<string> {
  const [file] = await findIssueFiles(fx.dir, id);
  if (!file) throw new Error(`#${id} not found`);
  const content = await Bun.file(join(fx.dir, file.path)).text();
  const match = /^updated: .*\n([\s\S]*?)^---$/m.exec(content);
  return (match?.[1] ?? '').replace(/\n$/, '');
}

describe('unknown frontmatter keys through the service layer', () => {
  test('are exposed as `extra` and kept verbatim by every mutation', async () => {
    const ctx = fx.context();
    const steps: [string, () => Promise<unknown>][] = [
      [
        'update',
        () => updateIssue(ctx, 1, { title: 'Renamed', labels: ['x'] }),
      ],
      ['comment', () => addComment(ctx, 1, 'hello')],
      ['edit comment', () => editComment(ctx, 1, 0, 'edited')],
      ['delete comment', () => deleteComment(ctx, 1, 0)],
      ['claim', () => claimIssue(ctx, 1)],
      ['unclaim', () => unclaimIssue(ctx, 1)],
      ['link', () => linkIssue(ctx, 1, { blockedBy: [2] })],
      ['unlink', () => unlinkIssue(ctx, 1, { blockedBy: [2] })],
      ['close', () => closeIssue(ctx, 1)],
      ['reopen', () => reopenIssue(ctx, 1)],
      [
        'claim next',
        async () => {
          const next = await claimNextIssue(ctx, { sort: 'priority' });
          expect(next.issue?.id).toBe(1);
        },
      ],
    ];
    for (const [name, run] of steps) {
      await run();
      expect({ name, extra: await extraBlock() }).toEqual({
        name,
        extra: EXTRA,
      });
    }
    const issue = await readIssue(fx.dir, 1);
    expect(issue?.extra).toEqual(EXTRA_VALUES);
    expect(issue?.title).toBe('Renamed');
  });

  test('an `extra` field in update input is ignored (not editable)', async () => {
    const { issue } = await updateIssue(fx.context(), 1, {
      priority: 'high',
      extra: { estimate: 99, injected: true },
    });
    expect(issue.extra).toEqual(EXTRA_VALUES);
    expect(await extraBlock()).toBe(EXTRA);
  });

  test('survive renumbering and being unlinked by a deleted blocker', async () => {
    await linkIssue(fx.context(), 1, { blockedBy: [2] });
    await deleteIssue(fx.context(), 2);
    expect(await extraBlock()).toBe(EXTRA);
    expect((await readIssue(fx.dir, 1))?.blockedBy).toBeUndefined();

    const { issue } = await renumberIssue(fx.context(), 1, { force: true });
    expect(issue.id).not.toBe(1);
    expect(await extraBlock(issue.id)).toBe(EXTRA);
    expect(issue.extra).toEqual(EXTRA_VALUES);
  });
});
