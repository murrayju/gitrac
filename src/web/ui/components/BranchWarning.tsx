export function BranchWarning({
  branch,
  defaultBranch,
}: {
  branch: string;
  defaultBranch: string;
}) {
  return (
    <div className="bg-amber-900/60 border-b border-amber-700 px-4 py-2 text-sm text-amber-200">
      You are on branch <strong>{branch}</strong> (default:{' '}
      <strong>{defaultBranch}</strong>). Changes will be committed to this
      branch.
    </div>
  );
}
