export function BranchWarning({
  branch,
  defaultBranch,
}: {
  branch: string;
  defaultBranch: string;
}) {
  return (
    <div className="bg-amber-900/60 border-b border-amber-700 px-4 py-2 text-sm text-amber-200">
      {/* `GET /api/git/status` reports a detached HEAD as branch "HEAD". */}
      {branch === 'HEAD' ? (
        <>HEAD is detached</>
      ) : (
        <>
          You are on branch <strong>{branch}</strong>
        </>
      )}{' '}
      (default: <strong>{defaultBranch}</strong>). Changes will be committed{' '}
      {branch === 'HEAD' ? 'on the detached HEAD' : 'to this branch'}.
    </div>
  );
}
