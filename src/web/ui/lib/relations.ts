import type { IssueRelationship } from '../../../core/links.ts';

/**
 * The relations as the issue view shows them, in display order: the title
 * of the section that lists them, and the label of the choice that adds
 * one ("this issue is <choice> #id").
 */
export const RELATIONS: {
  relationship: IssueRelationship;
  title: string;
  choice: string;
}[] = [
  { relationship: 'parent', title: 'Parent', choice: 'Parent' },
  { relationship: 'child', title: 'Sub-issues', choice: 'Sub-issue' },
  { relationship: 'blockedBy', title: 'Blocked by', choice: 'Blocked by' },
  { relationship: 'blocks', title: 'Blocks', choice: 'Blocks' },
  {
    relationship: 'duplicateOf',
    title: 'Duplicate of',
    choice: 'Duplicate of',
  },
  {
    relationship: 'duplicatedBy',
    title: 'Duplicates',
    choice: 'Duplicated by',
  },
  { relationship: 'related', title: 'Related', choice: 'Related to' },
];

/** Relationships an issue has only one of: the input takes one ID. */
export const SINGLE_RELATIONSHIPS: ReadonlySet<IssueRelationship> = new Set([
  'parent',
  'duplicateOf',
]);
