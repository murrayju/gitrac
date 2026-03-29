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

  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
      className={`inline-flex items-center gap-1.5 text-xs text-gray-300 ${
        onClick ? 'cursor-pointer hover:opacity-80' : ''
      }`}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
