import type { Priority } from '../../../core/types.ts';

const PRIORITY_COLORS: Record<Priority, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  none: 'bg-gray-500',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'None',
};

export function PriorityBadge({
  priority,
  onClick,
}: {
  priority: Priority;
  onClick?: () => void;
}) {
  const color = PRIORITY_COLORS[priority] ?? 'bg-gray-500';
  const label = PRIORITY_LABELS[priority] ?? priority;

  const inner = (
    <>
      <span className={`inline-block ml-2 w-2 h-2 rounded-full ${color}`} />
      {label}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center justify-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer hover:opacity-80"
      >
        {inner}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center justify-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
      {inner}
    </span>
  );
}
