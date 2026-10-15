import type { Priority } from '../../../core/types.ts';
import { useWorkflow } from '../hooks.ts';
import { priorityDotStyle } from '../lib/workflow.ts';

/** A priority with a colored dot: label and color from the config. */
export function PriorityBadge({
  priority,
  onClick,
}: {
  priority: Priority;
  onClick?: () => void;
}) {
  const workflow = useWorkflow();
  const { className, style } = priorityDotStyle(workflow.source, priority);
  const label = workflow.priorityLabels[priority] ?? priority;

  const inner = (
    <>
      <span
        className={`inline-block ml-2 w-2 h-2 rounded-full ${className}`}
        style={style}
      />
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
