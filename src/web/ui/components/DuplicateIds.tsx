import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  type DuplicateIssueId,
  type DuplicateResolution,
  resolveDuplicate,
} from '../api.ts';
import { useDuplicates } from '../hooks.ts';
import { errorText, renumberPlan } from '../lib/duplicates.ts';
import { relativeTime } from '../lib/time.ts';

const BUTTON =
  'rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50';

function idList(duplicates: DuplicateIssueId[]): string {
  return duplicates.map((d) => `#${d.id}`).join(', ');
}

/**
 * A banner above every page (except `/duplicates`) while several files have
 * the same issue ID, with a link to the page that fixes it.
 */
export function DuplicateIdsBanner() {
  const { duplicates } = useDuplicates();
  const location = useLocation();
  if (duplicates.length === 0 || location.pathname === '/duplicates') {
    return null;
  }
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200"
      data-testid="duplicate-ids-banner"
    >
      <span>
        Several files have the same issue ID ({idList(duplicates)}). These
        issues can't be opened or edited until each ID has one file.
      </span>
      <Link
        to="/duplicates"
        className="shrink-0 rounded border border-amber-400 px-2 py-0.5 font-medium hover:bg-amber-200 dark:border-amber-700 dark:hover:bg-amber-900"
      >
        Resolve
      </Link>
    </div>
  );
}

/**
 * `/duplicates`: every duplicated issue ID with its suggested renumbering,
 * a keeper choice per ID, an Apply button per ID and Apply all.
 */
export function DuplicateIdsPage() {
  const { duplicates, refetch } = useDuplicates();
  // The keeper the user picked, by ID (else the suggestion).
  const [keepers, setKeepers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DuplicateResolution[]>([]);

  async function apply(targets: DuplicateIssueId[]) {
    setBusy(true);
    setError(null);
    try {
      for (const duplicate of targets) {
        const result = await resolveDuplicate(
          duplicate.id,
          keepers[duplicate.id] ?? duplicate.keep,
        );
        setResults((previous) => [...previous, result]);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      refetch();
    }
  }

  return (
    <div className="p-6 max-w-4xl" data-testid="duplicate-ids-page">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold">Duplicate issue IDs</h1>
        {duplicates.length > 1 && (
          <button
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() => void apply(duplicates)}
          >
            Apply all
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Several files have the same ID, for example when two clones created an
        issue before they fetched each other. By default the oldest issue (by
        creation time) keeps the ID and each other one gets the next free ID.
        Pick another file to keep the ID if you want.
      </p>
      {results.length > 0 && (
        <ResolutionNotice results={results} onDismiss={() => setResults([])} />
      )}
      {error && <ErrorNotice message={error} />}
      {duplicates.length === 0 ? (
        <p className="text-sm text-gray-500">
          Every issue ID has one file.{' '}
          <Link to="/" className="text-blue-600 hover:underline">
            Back to issues
          </Link>
        </p>
      ) : (
        <div className="space-y-4">
          {duplicates.map((duplicate) => (
            <DuplicateIdResolver
              key={duplicate.id}
              duplicate={duplicate}
              keep={keepers[duplicate.id] ?? duplicate.keep}
              onKeepChange={(path) =>
                setKeepers((previous) => ({
                  ...previous,
                  [duplicate.id]: path,
                }))
              }
              busy={busy}
              onApply={() => void apply([duplicate])}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The issue view for an ID that several files have (`GET /api/issues/:id`
 * is a 409 then): its renumbering, to apply here.
 */
export function DuplicateIssueView({
  duplicate,
  onResolved,
}: {
  duplicate: DuplicateIssueId;
  onResolved: (result: DuplicateResolution) => void;
}) {
  const { refetch } = useDuplicates();
  const [keep, setKeep] = useState(duplicate.keep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      onResolved(await resolveDuplicate(duplicate.id, keep));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      refetch();
    }
  }

  return (
    <div className="p-6 max-w-4xl" data-testid="duplicate-issue">
      <h1 className="text-lg font-semibold mb-1">
        Issue #{duplicate.id} has {duplicate.files.length} files
      </h1>
      <p className="text-sm text-gray-500 mb-4">
        Give each issue its own ID to open it. By default the oldest issue (by
        creation time) keeps #{duplicate.id}.
      </p>
      {error && <ErrorNotice message={error} />}
      <DuplicateIdResolver
        duplicate={duplicate}
        keep={keep}
        onKeepChange={setKeep}
        busy={busy}
        onApply={() => void apply()}
      />
    </div>
  );
}

/**
 * One duplicated ID: its files, which one keeps the ID (a radio choice;
 * the suggestion is preselected), the new ID each other file gets, and
 * Apply.
 */
function DuplicateIdResolver({
  duplicate,
  keep,
  onKeepChange,
  busy,
  onApply,
}: {
  duplicate: DuplicateIssueId;
  keep: string;
  onKeepChange: (path: string) => void;
  busy: boolean;
  onApply: () => void;
}) {
  const plan = renumberPlan(duplicate, keep);
  const overridden = keep !== duplicate.keep;
  return (
    <section
      className="rounded border border-gray-200 dark:border-gray-800"
      data-testid={`duplicate-${duplicate.id}`}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-gray-800">
            <th className="px-3 py-2 font-medium">Keeps #{duplicate.id}</th>
            <th className="px-3 py-2 font-medium">Issue</th>
            <th className="px-3 py-2 font-medium">Created</th>
            <th className="px-3 py-2 font-medium">New ID</th>
          </tr>
        </thead>
        <tbody>
          {plan.map(({ file, newId }) => (
            <tr
              key={file.path}
              className="border-b last:border-b-0 border-gray-100 dark:border-gray-900"
            >
              <td className="px-3 py-2">
                <input
                  type="radio"
                  name={`keep-${duplicate.id}`}
                  aria-label={`${file.path} keeps #${duplicate.id}`}
                  checked={newId === null}
                  disabled={busy}
                  onChange={() => onKeepChange(file.path)}
                />
              </td>
              <td className="px-3 py-2">
                <div>
                  {file.title ?? (
                    <span className="text-red-500">Can't be parsed</span>
                  )}
                  {file.closed && (
                    <span className="ml-2 text-xs text-gray-500">(closed)</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 font-mono">
                  {file.path}
                </div>
              </td>
              <td
                className="px-3 py-2 text-gray-500 whitespace-nowrap"
                title={file.created ?? undefined}
              >
                {file.created ? relativeTime(file.created) : '-'}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {newId === null ? (
                  <span className="text-gray-500">keeps #{duplicate.id}</span>
                ) : (
                  <span>
                    #{duplicate.id} &rarr; #{newId}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between gap-4 px-3 py-2 border-t border-gray-200 dark:border-gray-800">
        <span className="text-xs text-gray-500">
          {overridden ? (
            <>
              You picked a file other than the oldest.{' '}
              <button
                type="button"
                className="text-blue-600 hover:underline"
                disabled={busy}
                onClick={() => onKeepChange(duplicate.keep)}
              >
                Use the suggestion
              </button>
              .
            </>
          ) : (
            'Suggested: the oldest keeps the ID.'
          )}{' '}
          New IDs are a preview: they are given when you apply.
        </span>
        <button
          type="button"
          className={BUTTON}
          disabled={busy}
          onClick={onApply}
        >
          {busy ? 'Applying\u2026' : 'Apply'}
        </button>
      </div>
    </section>
  );
}

/** What was renumbered, and the issues to check that used the old ID. */
export function ResolutionNotice({
  results,
  onDismiss,
}: {
  results: DuplicateResolution[];
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
      data-testid="duplicate-resolution"
    >
      <div className="flex items-start justify-between gap-4">
        <ul className="space-y-1">
          {results.flatMap((result) =>
            result.renumbered.map((r) => (
              <li key={r.to}>
                Renumbered #{r.oldId} &rarr;{' '}
                <Link to={`/issues/${r.newId}`} className="underline">
                  #{r.newId}
                </Link>
                : {r.title}
                {r.references.length > 0 && (
                  <div className="text-xs">
                    These issues link to or mention #{r.oldId}. Check which
                    issue they mean:{' '}
                    {/* An ID can have several files: list it once. */}
                    {[...new Set(r.references.map((ref) => ref.id))].map(
                      (refId, index) => (
                        <span key={refId}>
                          {index > 0 && ', '}
                          <Link to={`/issues/${refId}`} className="underline">
                            #{refId}
                          </Link>
                        </span>
                      ),
                    )}
                  </div>
                )}
              </li>
            )),
          )}
        </ul>
        <button
          type="button"
          className="text-xs hover:underline"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="mb-4 text-sm text-red-500">
      {message}
    </div>
  );
}
