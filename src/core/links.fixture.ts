import type { IssueLink, IssueRelationship } from './links.ts';

/** Test helper: the issue links for each relationship's IDs, in order. */
export function issueLinks(
  byRelationship: Partial<Record<IssueRelationship, number | number[]>>,
): IssueLink[] {
  return Object.entries(byRelationship).flatMap(([relationship, ids]) =>
    [ids ?? []].flat().map((id) => ({
      type: 'issue' as const,
      relationship: relationship as IssueRelationship,
      id,
    })),
  );
}
