import { Link } from 'react-router-dom';
import type { IssueRef } from '../../../core/dependencies.ts';
import { useIssueDependencies } from '../hooks.ts';
import { StatusBadge } from './StatusBadge.tsx';

function RefList({ title, refs }: { title: string; refs: IssueRef[] }) {
  if (refs.length === 0) return null;
  return (
    <div>
      <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
        {title}
      </div>
      <ul className="space-y-1">
        {refs.map((ref) => (
          <li key={ref.id} className="flex items-center gap-1.5 min-w-0">
            {ref.status === null ? (
              <span className="text-gray-500" title="Issue not found">
                #{ref.id} (missing)
              </span>
            ) : (
              <>
                <StatusBadge status={ref.status} />
                <Link
                  to={`/issues/${ref.id}`}
                  title={ref.title}
                  className={`truncate hover:underline ${
                    ref.resolved
                      ? 'text-gray-500 line-through'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  #{ref.id} {ref.title}
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Read-only view of an issue's links: parent, sub-issues, blockers and the
 * issues it blocks. Resolved (closed or missing) issues are struck through.
 * Edit links with `gitrac link` / `gitrac unlink`.
 */
export function DependenciesPanel({ issueId }: { issueId: number }) {
  const { dependencies: deps } = useIssueDependencies(issueId);
  if (!deps) return null;
  const { parent, children, blockedBy, blocks } = deps;
  if (
    !parent &&
    children.length === 0 &&
    blockedBy.length === 0 &&
    blocks.length === 0
  ) {
    return null;
  }
  return (
    <div className="space-y-4 text-sm mt-4" data-testid="dependencies">
      {deps.blocked && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          Blocked by an open issue
        </div>
      )}
      <RefList title="Parent" refs={parent ? [parent] : []} />
      <RefList title="Sub-issues" refs={children} />
      <RefList title="Blocked by" refs={blockedBy} />
      <RefList title="Blocks" refs={blocks} />
    </div>
  );
}
