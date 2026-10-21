import { describe, expect, test } from 'bun:test';
import { analyzeCommitArgs } from './git-commit-args.ts';

describe('analyzeCommitArgs', () => {
  test('no arguments: no pathspecs, no flags', () => {
    expect(analyzeCommitArgs([])).toEqual({
      pathspecs: [],
      all: false,
      amend: false,
    });
  });

  test('values of options are not pathspecs', () => {
    for (const args of [
      ['-m', 'fix it'],
      ['-mfix'],
      ['--message', 'fix'],
      ['--message=fix'],
      ['--mess', 'fix'],
      ['-F', 'msg.txt'],
      ['-C', 'HEAD'],
      ['-c', 'HEAD'],
      ['-t', 'tpl'],
      ['--author', 'A <a@b>'],
      ['--date', 'now'],
      ['--template', 'tpl'],
      ['--cleanup', 'strip'],
      ['--fixup', 'HEAD'],
      ['--squash', 'HEAD'],
      ['--trailer', 'Closes: #1'],
      ['--reuse-message', 'HEAD'],
      ['--reedit-message', 'HEAD'],
      ['--file', 'msg'],
      ['-sm', 'msg'],
      ['-S', '-m', 'msg'],
      ['-Skeyid', '-m', 'msg'],
      ['-v', '-q', '--no-verify', '--allow-empty', '-m', 'x'],
    ]) {
      expect({ args, pathspecs: analyzeCommitArgs(args).pathspecs }).toEqual({
        args,
        pathspecs: [],
      });
    }
  });

  test('positional arguments and everything after -- are pathspecs', () => {
    expect(analyzeCommitArgs(['-m', 'x', 'src/a.ts']).pathspecs).toEqual([
      'src/a.ts',
    ]);
    expect(analyzeCommitArgs(['-mx', 'a', 'b']).pathspecs).toEqual(['a', 'b']);
    expect(analyzeCommitArgs(['-m', 'x', '--', '-a']).pathspecs).toEqual([
      '-a',
    ]);
    expect(analyzeCommitArgs(['--amend', '.']).pathspecs).toEqual(['.']);
    // A flag without a value does not take the next argument.
    expect(analyzeCommitArgs(['-a', 'file']).pathspecs).toEqual(['file']);
    expect(analyzeCommitArgs(['--no-edit', 'file']).pathspecs).toEqual([
      'file',
    ]);
  });

  test('--pathspec-from-file counts as a pathspec', () => {
    expect(
      analyzeCommitArgs(['--pathspec-from-file', 'list']).pathspecs,
    ).toEqual(['--pathspec-from-file=list']);
    expect(analyzeCommitArgs(['--pathspec-from-file=list']).pathspecs).toEqual([
      '--pathspec-from-file=list',
    ]);
  });

  test('finds -a / --all, also in a cluster, and --amend', () => {
    expect(analyzeCommitArgs(['-a']).all).toBe(true);
    expect(analyzeCommitArgs(['-am', 'msg']).all).toBe(true);
    expect(analyzeCommitArgs(['--all']).all).toBe(true);
    expect(analyzeCommitArgs(['-a', '--no-all']).all).toBe(false);
    // The `a` in a message value is not a flag.
    expect(analyzeCommitArgs(['-ma']).all).toBe(false);
    expect(analyzeCommitArgs(['-m', '-a']).all).toBe(false);
    expect(analyzeCommitArgs(['--amend', '--no-edit']).amend).toBe(true);
    expect(analyzeCommitArgs(['--am']).amend).toBe(true);
    expect(analyzeCommitArgs(['-m', 'x']).amend).toBe(false);
  });
});
