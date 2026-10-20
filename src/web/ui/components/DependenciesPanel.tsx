import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import type { IssueRef } from '../../../core/dependencies.ts';
import { linkIssue, unlinkIssue } from '../api.ts';
import { useIssueDependencies } from '../hooks.ts';
import { blockedNotice, refHoverText } from '../lib/claimed-elsewhere.ts';
import {
  type ParsedIssueIds,
  parseIssueIds,
  parseSingleIssueId,
} from '../lib/issue-id-input.ts';
import { requestErrorReason } from '../lib/upload-error.ts';
import { FoundElsewhereBadge } from './FoundElsewhereBadge.tsx';
import { StatusBadge } from './StatusBadge.tsx';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">
      {children}
    </div>
  );
}

function RefItem({
  issueRef,
  onRemove,
  removeLabel,
  busy,
}: {
  issueRef: IssueRef;
  onRemove?: () => void;
  removeLabel?: string;
  busy?: boolean;
}) {
  return (
    <li className="group flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
      {issueRef.status === null ? (
        <span className="text-gray-500 truncate" title="Issue not found">
          #{issueRef.id} (missing)
        </span>
      ) : (
        <>
          <StatusBadge status={issueRef.status} />
          {/* An issue only elsewhere opens its read-only view. */}
          <Link
            to={`/issues/${issueRef.id}`}
            title={refHoverText(issueRef)}
            className={`min-w-0 flex-1 truncate hover:underline ${
              issueRef.resolved
                ? 'text-gray-500 line-through'
                : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            #{issueRef.id} {issueRef.title}
          </Link>
        </>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={removeLabel}
          title={removeLabel}
          className="ml-auto shrink-0 text-gray-400 hover:text-red-500 disabled:opacity-50 cursor-pointer bg-transparent border-none px-1"
        >
          ×
        </button>
      )}
      {/* On its own line, so the title keeps the narrow sidebar's width. */}
      {issueRef.foundElsewhere && (
        <span className="w-full">
          <FoundElsewhereBadge found={issueRef.foundElsewhere} />
        </span>
      )}
    </li>
  );
}

export function RefList({ title, refs }: { title: string; refs: IssueRef[] }) {
  if (refs.length === 0) return null;
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <ul className="space-y-1">
        {refs.map((ref) => (
          <RefItem key={ref.id} issueRef={ref} />
        ))}
      </ul>
    </div>
  );
}

/** A small "issue number" input that submits the parsed IDs. */
function AddLinkForm({
  placeholder,
  buttonLabel,
  ariaLabel,
  parse,
  busy,
  onSubmit,
}: {
  placeholder: string;
  buttonLabel: string;
  ariaLabel: string;
  parse: (text: string) => ParsedIssueIds;
  busy: boolean;
  /** Resolves true if the link was saved (the input is then cleared). */
  onSubmit: (ids: number[]) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parse(text);
    if (!parsed.ok) {
      setInputError(parsed.error);
      return;
    }
    setInputError(null);
    if (await onSubmit(parsed.ids)) setText('');
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1">
      <div className="flex gap-1">
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setInputError(null);
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={busy}
          className="min-w-0 flex-1 bg-white border border-gray-300 rounded px-1.5 py-0.5 text-xs text-gray-700 placeholder-gray-400 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 dark:placeholder-gray-600"
        />
        <button
          type="submit"
          disabled={busy || text.trim() === ''}
          className="shrink-0 px-2 py-0.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50 cursor-pointer dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {buttonLabel}
        </button>
      </div>
      {inputError && (
        <div className="text-xs text-red-500 mt-1" role="alert">
          {inputError}
        </div>
      )}
    </form>
  );
}

/**
 * An issue's links: parent, sub-issues, blockers and the issues it blocks.
 * Resolved (closed or missing) issues are struck through. An issue that
 * exists only in another worktree or on another branch shows where it is,
 * and links to its read-only view; as a blocker it blocks in any status
 * (its work is not here yet). The parent and the
 * blockers are stored on this issue, so they can be set and removed here
 * (via `POST /api/issues/:id/link` / `unlink`). Sub-issues and "blocks" are
 * derived from other issues and are read-only.
 */
export function DependenciesPanel({ issueId }: { issueId: number }) {
  const { dependencies: deps, refetch } = useIssueDependencies(issueId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!deps) return null;
  const { parent, children, blockedBy, blocks } = deps;
  const blocked = blockedNotice(blockedBy);

  /** Run a link change; show the server's message if it fails. */
  async function change(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(requestErrorReason(err));
      return false;
    } finally {
      setBusy(false);
      // The SSE event also triggers a refetch; do not wait for it.
      refetch();
    }
  }

  return (
    <div className="space-y-4 text-sm mt-4" data-testid="dependencies">
      {blocked && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          {blocked}
        </div>
      )}
      {error && (
        <div
          className="text-xs text-red-500 break-words"
          role="alert"
          data-testid="dependencies-error"
        >
          {error}
        </div>
      )}
      <div>
        <SectionTitle>Parent</SectionTitle>
        {parent ? (
          <ul>
            <RefItem
              issueRef={parent}
              busy={busy}
              removeLabel={`Clear parent #${parent.id}`}
              onRemove={() =>
                change(() => unlinkIssue(issueId, { parent: true }))
              }
            />
          </ul>
        ) : (
          <AddLinkForm
            placeholder="#12"
            buttonLabel="Set"
            ariaLabel="Parent issue number"
            parse={parseSingleIssueId}
            busy={busy}
            onSubmit={([id]) =>
              change(() => linkIssue(issueId, { parent: id }))
            }
          />
        )}
      </div>
      <RefList title="Sub-issues" refs={children} />
      <div>
        <SectionTitle>Blocked by</SectionTitle>
        {blockedBy.length > 0 && (
          <ul className="space-y-1">
            {blockedBy.map((ref) => (
              <RefItem
                key={ref.id}
                issueRef={ref}
                busy={busy}
                removeLabel={`Remove blocker #${ref.id}`}
                onRemove={() =>
                  change(() => unlinkIssue(issueId, { blockedBy: [ref.id] }))
                }
              />
            ))}
          </ul>
        )}
        <AddLinkForm
          placeholder="#12, #13"
          buttonLabel="Add"
          ariaLabel="Blocking issue numbers"
          parse={parseIssueIds}
          busy={busy}
          onSubmit={(ids) =>
            change(() => linkIssue(issueId, { blockedBy: ids }))
          }
        />
      </div>
      <RefList title="Blocks" refs={blocks} />
    </div>
  );
}
