import type { Status } from '../../../core/types.ts';

const STATUS_STYLES: Record<Status, string> = {
  backlog: 'bg-gray-700 text-gray-300',
  todo: 'bg-blue-900 text-blue-300',
  in_progress: 'bg-amber-900 text-amber-300',
  done: 'bg-green-900 text-green-300',
  cancelled: 'bg-red-900 text-red-300',
};

const STATUS_LABELS: Record<Status, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function StatusBadge({
  status,
  onClick,
}: {
  status: Status;
  onClick?: () => void;
}) {
  const style = STATUS_STYLES[status] ?? 'bg-gray-700 text-gray-300';
  const label = STATUS_LABELS[status] ?? status;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-block px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-80 ${style}`}
      >
        {label}
      </button>
    );
  }

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}
