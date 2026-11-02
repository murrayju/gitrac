import type { Command } from 'commander';
import { invalidInput, parseIssueIdArg } from '../../core/errors.ts';
import {
  type IssueRelationship,
  type Link,
  linkFromUrl,
} from '../../core/links.ts';
import { splitValues } from '../../core/query.ts';
import { linkIssue, unlinkIssue } from '../../service/links.ts';
import { resolveProjectOptions } from '../global-options.ts';
import { formatIssueDetail } from '../output.ts';
import { cliServiceContext, printWrittenIssue } from '../service-context.ts';

/** Collect a repeatable option's values (`-b 3 -b 4`). */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** One option per issue relationship. */
const RELATIONSHIP_OPTIONS: {
  relationship: IssueRelationship;
  flags: string;
  /** Commander's property name. */
  key: string;
  link: string;
  unlink: string;
}[] = [
  {
    relationship: 'blockedBy',
    flags: '-b, --blocked-by',
    key: 'blockedBy',
    link: 'Issue(s) this one is blocked by',
    unlink: 'Blocker(s) to remove',
  },
  {
    relationship: 'blocks',
    flags: '--blocks',
    key: 'blocks',
    link: 'Issue(s) this one blocks',
    unlink: 'Blocked issue(s) to remove',
  },
  {
    relationship: 'parent',
    flags: '--parent',
    key: 'parent',
    link: 'The parent issue: makes this one a sub-issue (replaces the old parent)',
    unlink: 'Clear the parent (or only this one)',
  },
  {
    relationship: 'child',
    flags: '--child',
    key: 'child',
    link: 'Make these issues its sub-issues',
    unlink: 'Sub-issue(s) to remove',
  },
  {
    relationship: 'duplicateOf',
    flags: '--duplicate-of',
    key: 'duplicateOf',
    link: 'The issue this one duplicates (replaces the old one; does not change the status, see close --duplicate-of)',
    unlink: 'Clear the original (or only this one)',
  },
  {
    relationship: 'duplicatedBy',
    flags: '--duplicated-by',
    key: 'duplicatedBy',
    link: 'Issue(s) that duplicate this one',
    unlink: 'Duplicate(s) to remove',
  },
  {
    relationship: 'related',
    flags: '--related',
    key: 'related',
    link: 'Related issue(s)',
    unlink: 'Related issue(s) to remove',
  },
];

/**
 * Relationships an issue has only one of (a new one replaces the old one):
 * their options take one ID, which `unlink` may leave out (= all).
 */
const SINGLE: ReadonlySet<IssueRelationship> = new Set([
  'parent',
  'duplicateOf',
]);

const RELATIONSHIP_FLAGS = RELATIONSHIP_OPTIONS.map(
  (o) => o.flags.split(', ').at(-1) as string,
).join(', ');

/** IDs of repeatable, comma-separated option values. */
function parseIds(values: string[], flag: string): number[] {
  const ids = splitValues(values).map(parseIssueIdArg);
  if (ids.length === 0) throw invalidInput(`${flag} needs an issue ID`);
  return ids;
}

type LinkOptions = Record<string, string[] | string | true | undefined> & {
  url?: string[];
  title?: string;
};

/** The links the `link` options ask for. */
function linksToAdd(options: LinkOptions): Link[] {
  const links: Link[] = [];
  for (const option of RELATIONSHIP_OPTIONS) {
    const values = options[option.key];
    if (values === undefined || values === true) continue;
    for (const id of parseIds([values].flat(), option.flags)) {
      links.push({ type: 'issue', relationship: option.relationship, id });
    }
  }
  const urls = options.url ?? [];
  if (options.title !== undefined && urls.length !== 1) {
    throw invalidInput('--title needs exactly one --url');
  }
  for (const url of urls) links.push(linkFromUrl(url, options.title));
  return links;
}

/** The `unlink` request entries the options ask for (see `parseLinkRequest`). */
function linksToRemove(options: LinkOptions): unknown[] {
  const entries: unknown[] = [];
  for (const { relationship, key, flags } of RELATIONSHIP_OPTIONS) {
    const value = options[key];
    if (value === undefined) continue;
    // `--parent` / `--duplicate-of` without an ID: all of them.
    if (value === true) {
      entries.push({ type: 'issue', relationship });
      continue;
    }
    const values = typeof value === 'string' ? [value] : value;
    for (const id of parseIds(values, flags)) {
      entries.push({ type: 'issue', relationship, id });
    }
  }
  for (const url of options.url ?? []) entries.push(linkFromUrl(url));
  return entries;
}

export function registerLinkCommands(program: Command): void {
  const link = program
    .command('link <id>')
    .description(
      'Link an issue to other issues (blocked by, parent, duplicate of, ...) and/or URLs. ' +
        'A link to another issue is stored on the dependent issue (the blocked one, the sub-issue, the duplicate; related: the higher ID), which can be the other issue. ' +
        'A GitHub pull request URL becomes a github-pr link. ' +
        'Exits 2 (nothing written) if a target is missing, the issue itself, or the link would create a cycle.',
    );
  for (const option of RELATIONSHIP_OPTIONS) {
    if (SINGLE.has(option.relationship)) {
      link.option(`${option.flags} <id>`, option.link);
    } else {
      link.option(
        `${option.flags} <ids>`,
        `${option.link}; comma-separated (repeatable)`,
        collect,
      );
    }
  }
  link
    .option('--url <url>', 'A URL to link (repeatable)', collect)
    .option('--title <title>', 'Title of the --url link')
    .action(async (idStr: string, options: LinkOptions) => {
      const globalOpts = await resolveProjectOptions(program);
      const id = parseIssueIdArg(idStr);
      const links = linksToAdd(options);
      if (links.length === 0) {
        throw invalidInput(
          `Nothing to link: give one of ${RELATIONSHIP_FLAGS}, --url`,
        );
      }
      const result = await linkIssue(
        cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
        id,
        { links },
      );
      if (!result.changed) {
        console.error(`Issue #${id} is already linked; nothing changed.`);
        console.log(formatIssueDetail(result.issue, globalOpts.output));
      }
    });

  const unlink = program
    .command('unlink <id>')
    .description(
      'Remove links from an issue. A link to another issue is removed whichever issue stores it.',
    );
  for (const option of RELATIONSHIP_OPTIONS) {
    if (SINGLE.has(option.relationship)) {
      unlink.option(`${option.flags} [id]`, option.unlink);
    } else {
      unlink.option(
        `${option.flags} <ids>`,
        `${option.unlink}; comma-separated (repeatable)`,
        collect,
      );
    }
  }
  unlink
    .option('--url <url>', 'A linked URL to remove (repeatable)', collect)
    .action(async (idStr: string, options: LinkOptions) => {
      const globalOpts = await resolveProjectOptions(program);
      const id = parseIssueIdArg(idStr);
      const entries = linksToRemove(options);
      if (entries.length === 0) {
        throw invalidInput(
          `Nothing to unlink: give one of ${RELATIONSHIP_FLAGS}, --url`,
        );
      }
      const result = await unlinkIssue(
        cliServiceContext(globalOpts, printWrittenIssue(globalOpts)),
        id,
        { links: entries },
      );
      if (!result.changed) {
        console.error(`Issue #${id} has no such links; nothing changed.`);
        console.log(formatIssueDetail(result.issue, globalOpts.output));
      }
    });
}
