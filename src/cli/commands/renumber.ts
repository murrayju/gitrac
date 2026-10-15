import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import yaml from 'js-yaml';
import { GitracError, parseIssueIdArg } from '../../core/errors.ts';
import type { OutputFormat } from '../../core/types.ts';
import {
  type IssueRenumbering,
  type RenumberCandidate,
  type RenumberReference,
  renumberCandidates,
  renumberIssue,
} from '../../service/renumber.ts';
import { withHint } from '../errors.ts';
import {
  type GlobalOptions,
  resolveProjectOptions,
} from '../global-options.ts';
import { promptLine, stdinIsTTY } from '../prompt.ts';
import { cliServiceContext } from '../service-context.ts';

/** `gitrac renumber` options. */
export interface RenumberCliOptions {
  file?: string;
  force?: boolean;
  updateRefs?: boolean;
}

/** Terminal interaction, injectable for tests. */
export interface RenumberIO {
  /** Whether stdin is an interactive terminal (so we may ask). */
  isTTY: () => boolean;
  /** Ask a question (on stderr); resolves to the answer, or null on EOF. */
  prompt: (question: string) => Promise<string | null>;
}

const defaultIO: RenumberIO = {
  isTTY: stdinIsTTY,
  prompt: (question) => promptLine(question),
};

/**
 * `--file` as the service expects it: a path given relative to the cwd (or
 * absolute) that exists inside the project becomes repo-relative; anything
 * else (e.g. `.issues/12-a.md` copied from an error, run from a subdirectory,
 * or a bare filename) is passed through.
 */
export function resolveFileArg(root: string, file: string): string {
  const abs = resolve(file);
  const rel = relative(root, abs);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel) && existsSync(abs)) {
    return rel;
  }
  return file;
}

function referenceTags(r: RenumberReference, oldId: number): string {
  return [
    r.blockedBy && 'blockedBy',
    r.parent && 'parent',
    r.mentions && `mentions #${oldId}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Format a renumbering in the `-o` format. */
export function formatRenumbering(
  r: Pick<
    IssueRenumbering,
    'oldId' | 'newId' | 'issue' | 'from' | 'to' | 'references' | 'paths'
  >,
  format: OutputFormat,
): string {
  const data = {
    renumbered: true,
    oldId: r.oldId,
    newId: r.newId,
    from: r.from,
    to: r.to,
    issue: r.issue,
    references: r.references,
    paths: r.paths,
  };
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'yaml':
      return yaml.dump(data, { lineWidth: -1 });
    case 'human': {
      const lines = [
        `Renumbered #${r.oldId} -> #${r.newId}: ${r.issue.title}`,
        `  ${r.from} -> ${r.to}`,
      ];
      const updated = r.references.filter((ref) => ref.updated);
      const kept = r.references.filter((ref) => !ref.updated);
      const line = (ref: RenumberReference) =>
        `  #${ref.id}: ${ref.title} (${referenceTags(ref, r.oldId)})`;
      if (updated.length > 0) {
        lines.push(
          `Links to #${r.oldId} changed to #${r.newId} in:`,
          ...updated.map(line),
        );
      }
      if (kept.length > 0) {
        const anyLinks = kept.some((ref) => ref.blockedBy || ref.parent);
        lines.push(
          `Not changed — these reference #${r.oldId}, which may mean either issue; check them${anyLinks ? ' (--update-refs points blockedBy/parent links at the new ID)' : ''}:`,
          ...kept.map(line),
        );
      }
      return lines.join('\n');
    }
  }
}

/** Ask which of the duplicate files to renumber; returns its path. */
async function chooseFile(
  id: number,
  candidates: RenumberCandidate[],
  io: RenumberIO,
): Promise<string> {
  const lines = [
    `Issue #${id} has ${candidates.length} files:`,
    ...candidates.map(
      (c, i) =>
        `  ${i + 1}) ${c.path}${c.title === null ? '' : ` — ${c.title}`}`,
    ),
  ];
  // stderr, so `-o json` stdout stays a single JSON document.
  console.error(lines.join('\n'));
  const answer = (
    await io.prompt(`Renumber which file? [1-${candidates.length}]`)
  )?.trim();
  if (!answer) {
    throw new GitracError(
      'confirmation_required',
      `No file chosen; issue #${id} was not renumbered.`,
      { details: { id } },
    );
  }
  const n = Number(answer);
  const byNumber = Number.isInteger(n) ? candidates[n - 1] : undefined;
  if (byNumber) return byNumber.path;
  return answer;
}

/**
 * Renumber a file of issue `id` (see `renumberIssue`). With several files
 * and no `--file`, asks which one on a terminal, else fails with
 * `duplicate_issue` listing them. The prompt runs outside the repo lock;
 * the service re-checks the choice under it.
 */
export async function runRenumber(
  globalOpts: GlobalOptions,
  id: number,
  options: RenumberCliOptions,
  io: RenumberIO = defaultIO,
): Promise<IssueRenumbering> {
  let file =
    options.file === undefined
      ? undefined
      : resolveFileArg(globalOpts.dir, options.file);
  if (file === undefined && io.isTTY()) {
    const candidates = await renumberCandidates(globalOpts.dir, id);
    if (candidates.length > 1) file = await chooseFile(id, candidates, io);
  }
  return renumberIssue(cliServiceContext(globalOpts), id, {
    file,
    force: options.force,
    updateRefs: options.updateRefs,
    // Printed before committing, so it shows even if the commit fails.
    onRenumbered: (r) => console.log(formatRenumbering(r, globalOpts.output)),
  }).catch((err) => {
    throw withHint(err, {
      duplicate_issue: `Re-run as: gitrac renumber ${id} --file <path>.`,
      invalid_state: 'Use --force to renumber it anyway.',
    });
  });
}

export function registerRenumberCommand(program: Command): void {
  program
    .command('renumber <id>')
    .description(
      'Give an issue file a new ID (for duplicate IDs, e.g. two clones created the same one): ' +
        'renames the file, updates its id and commits. With several files for the ID, pick one with --file ' +
        '(asked on a terminal). References to the old ID are listed, not changed, unless --update-refs.',
    )
    .option(
      '-f, --file <path>',
      'The file to renumber (path as listed by duplicate_issue, or its filename)',
    )
    .option('--force', 'Renumber even if the ID is not duplicated')
    .option(
      '--update-refs',
      "Point other issues' blockedBy/parent links at the new ID",
    )
    .action(async (idStr: string, options: RenumberCliOptions) => {
      const globalOpts = await resolveProjectOptions(program);
      const id = parseIssueIdArg(idStr);
      await runRenumber(globalOpts, id, options);
    });
}
